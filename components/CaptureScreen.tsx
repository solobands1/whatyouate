"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fileToThumbnailDataUrl } from "../lib/utils";
import { safeFallbackAnalysis } from "../lib/ai/schema";
import { notifyMealsUpdated } from "../lib/dataEvents";
import { useAuth } from "./AuthProvider";
import { addMeal, updateMealTs, uploadMealThumbnail, updateMealImageUrl } from "../lib/supabaseDb";
import { enqueueMeal } from "../lib/mealQueue";

function nowTimeString() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function minDateString(daysBack = 14) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateTimeToTs(dateStr: string, timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(h, m, 0, 0);
  // Don't allow future times
  if (d.getTime() > Date.now()) d.setTime(Date.now());
  return d.getTime();
}

export default function CaptureScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const redirectRef = useRef<number | null>(null);
  const showTimePickerRef = useRef(false);
  const analyzeStartedRef = useRef(false);
  const [cameraMode, setCameraMode] = useState<"idle" | "live" | "file">("idle");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [pendingMealId, setPendingMealId] = useState<string | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [mealDate, setMealDate] = useState(todayDateString);
  const [mealTime, setMealTime] = useState(nowTimeString);
  const [saveError, setSaveError] = useState(false);
  const [confirmingTime, setConfirmingTime] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [hint, setHint] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
  }, [loading, user]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Restore pending capture from sessionStorage (iOS PWA workaround)
  useEffect(() => {
    if (file || typeof window === "undefined") return;
    const raw = sessionStorage.getItem("wya_pending_capture");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { name?: string; type?: string; dataUrl?: string };
      if (!parsed?.dataUrl) return;
      sessionStorage.removeItem("wya_pending_capture");
      fetch(parsed.dataUrl)
        .then((res) => res.blob())
        .then((blob) => {
          setFile(new File([blob], parsed.name ?? "capture.jpg", {
            type: parsed.type ?? blob.type ?? "image/jpeg"
          }));
        })
        .catch(() => {});
    } catch {
      // Ignore malformed storage.
    }
  }, [file]);

  // Analysis is now triggered by the Analyze button, not automatically on file select.

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    openCamera();
  }, []);

  useEffect(() => {
    if (cameraMode !== "live") return;
    if (!videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    videoRef.current.onloadedmetadata = () => {
      videoRef.current?.play().catch(() => {});
    };
  }, [cameraMode]);

  const buildResizedDataUrl = async (selected: File) => {
    const imageUrl = URL.createObjectURL(selected);
    const img = new Image();
    img.src = imageUrl;
    await new Promise((resolve, reject) => {
      img.onload = () => resolve(true);
      img.onerror = reject;
    });
    const maxSize = 800;
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(imageUrl);
    let quality = 0.8;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    const maxBytes = 220 * 1024;
    const estimateBytes = (url: string) => Math.round((url.length * 3) / 4);
    while (estimateBytes(dataUrl) > maxBytes && quality > 0.6) {
      quality = Math.max(0.6, quality - 0.05);
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    return dataUrl;
  };

  const handleAnalyze = async (selected: File, hintText?: string) => {
    if (!user) return;
    const [resized, thumb] = await Promise.all([
      buildResizedDataUrl(selected),
      fileToThumbnailDataUrl(selected)
    ]);
    const placeholder = safeFallbackAnalysis();
    let pendingMeal;
    try {
      pendingMeal = await addMeal(user.id, placeholder);
    } catch {
      setSaveError(true);
      return;
    }
    // Upload thumbnail to Storage non-blocking — meal is already saved if this fails
    uploadMealThumbnail(user.id, pendingMeal.id, thumb).then((url) => {
      if (url) updateMealImageUrl(pendingMeal.id, user.id, url);
    });
    setPendingMealId(pendingMeal.id);
    setMealTime(nowTimeString());
    notifyMealsUpdated();
    enqueueMeal(pendingMeal.id, resized, user.id, hintText || undefined);
    if (redirectRef.current) window.clearTimeout(redirectRef.current);
    redirectRef.current = window.setTimeout(() => {
      if (!showTimePickerRef.current) router.push("/");
    }, 3200);
  };

  const handleAnalyzeTap = () => {
    if (!file || analyzeStartedRef.current) return;
    analyzeStartedRef.current = true;
    setAnalyzed(true);
    sessionStorage.removeItem("wya_pending_capture");
    handleAnalyze(file, hint.trim() || undefined).catch(() => {});
  };

  const handleChangeTime = () => {
    showTimePickerRef.current = true;
    if (redirectRef.current) {
      window.clearTimeout(redirectRef.current);
      redirectRef.current = null;
    }
    setShowTimePicker(true);
  };

  const handleConfirmTime = async () => {
    if (confirmingTime) return;
    setConfirmingTime(true);
    if (pendingMealId) {
      const ts = dateTimeToTs(mealDate, mealTime);
      await updateMealTs(pendingMealId, ts).catch(() => {});
    }
    router.push("/");
  };

  async function startLiveCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }
    });
    streamRef.current = stream;
    setCameraMode("live");
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraMode("idle");
  };

  function openCamera() {
    setCameraMode("file");
    if (fileInputRef.current) fileInputRef.current.click();
  }

  const captureFrame = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9)
    );
    if (!blob) return;
    stopCamera();
    setFile(new File([blob], "capture.jpg", { type: "image/jpeg" }));
  };

  if (loading) return <div className="min-h-screen bg-surface" />;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-surface">
      <div
        className={
          preview
            ? "flex h-screen w-screen flex-col items-center justify-center bg-surface"
            : "mx-auto flex min-h-screen max-w-md flex-col px-5 pb-20 safe-top"
        }
      >
        {!file && (
          <div className="mt-6">
            {cameraMode === "live" ? (
              <div className="space-y-3">
                <div className="relative h-64 w-full overflow-hidden rounded-xl bg-black">
                  <video
                    ref={videoRef}
                    id="live-video"
                    autoPlay
                    playsInline
                    muted
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="flex-1 rounded-xl bg-primary px-5 py-3 text-center text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] ring-1 ring-white/40 transition hover:bg-primary/90 active:scale-[0.98]"
                    onClick={captureFrame}
                  >
                    Capture
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border border-ink/10 bg-ink/5 px-4 py-3 text-sm font-semibold text-ink/70 transition hover:bg-ink/10"
                    onClick={stopCamera}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <input
                  id="camera-file"
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(event) => {
                    const selected = event.target.files?.[0] ?? null;
                    setFile(selected);
                  }}
                />
                <div className="flex flex-col items-center gap-2 pt-16">
                  <p className="text-sm text-muted/60">No photo selected.</p>
                  <button
                    type="button"
                    className="text-sm font-semibold text-ink/60 underline"
                    onClick={() => router.push("/")}
                  >
                    ← Back
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {preview && !analyzed && (
          <div className="flex flex-col flex-1 items-center px-6 pt-4 pb-6">
            {/* Cancel button top left */}
            <div className="w-full max-w-sm mb-4">
              <button
                type="button"
                className="text-sm text-ink/50 underline"
                onClick={() => {
                  setFile(null);
                  setHint("");
                  setAnalyzed(false);
                  analyzeStartedRef.current = false;
                  router.push("/");
                }}
              >
                Cancel
              </button>
            </div>

            {/* Photo card — no checkmark yet */}
            <div className="relative w-full max-w-sm rounded-2xl border-2 border-primary/60 overflow-hidden shadow-[0_0_24px_rgba(111,168,255,0.18)]">
              <img src={preview} alt="Preview" className="w-full object-cover" />
            </div>

            {/* Hint field + helper text */}
            <div className="w-full max-w-sm mt-5">
              <input
                type="text"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="Ex. Vegetarian, turkey sandwich"
                className="w-full rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink/80 placeholder:text-ink/35 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              <p className="mt-2 text-xs text-muted/60 px-1">Help your food get properly identified with a hint</p>
            </div>

            {/* Analyze button — pushed to bottom so it sits just above the keyboard */}
            <button
              type="button"
              className="mt-auto w-full max-w-sm rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] transition hover:bg-primary/90 active:scale-[0.98]"
              onClick={handleAnalyzeTap}
            >
              Analyze
            </button>
          </div>
        )}

        {preview && analyzed && (
          <div className="flex flex-col items-center justify-center flex-1 px-6 py-6 gap-6">
            {/* Photo card with checkmark overlay */}
            <div className="relative w-full max-w-sm rounded-2xl border-2 border-primary/60 overflow-hidden shadow-[0_0_24px_rgba(111,168,255,0.18)] -mt-10">
              <img src={preview} alt="Preview" className="w-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px]">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary shadow-xl animate-circleImpact">
                  <svg
                    className="h-10 w-10 text-white animate-checkmark"
                    viewBox="0 0 52 52"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="5"
                  >
                    <path d="M14 27 L22 35 L38 18" className="checkmark-path" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Text below card */}
            <div className="flex flex-col items-center gap-1 animate-fadeIn mt-14">
              <p className="text-xl font-semibold text-ink/70">Image Captured</p>
              {saveError ? (
                <div className="mt-2 flex flex-col items-center gap-2">
                  <p className="text-sm text-muted/70">Something went wrong. Please try again.</p>
                  <button
                    type="button"
                    className="text-sm font-semibold text-ink/60 underline"
                    onClick={() => router.push("/")}
                  >
                    ← Back
                  </button>
                </div>
              ) : showTimePicker ? (
                <div className="mt-3 flex flex-col items-center gap-3">
                  <p className="text-xs text-muted/70">When did you eat this?</p>
                  <input
                    type="date"
                    className="rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                    value={mealDate}
                    min={minDateString()}
                    max={todayDateString()}
                    onChange={(e) => setMealDate(e.target.value)}
                  />
                  <input
                    type="time"
                    className="rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                    value={mealTime}
                    max={mealDate === todayDateString() ? nowTimeString() : undefined}
                    onChange={(e) => setMealTime(e.target.value)}
                  />
                  <button
                    type="button"
                    className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                    onClick={handleConfirmTime}
                    disabled={confirmingTime}
                  >
                    {confirmingTime ? "Saving…" : "Done"}
                  </button>
                </div>
              ) : (
                <p className="text-base text-muted/70">Adding to Your Day</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
