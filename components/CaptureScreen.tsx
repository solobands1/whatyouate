"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { MealLog, MealAnalysis } from "../lib/types";
import { fileToBase64, fileToThumbnailDataUrl, minutesBetween, formatApprox } from "../lib/utils";
import { coerceAnalysis, LOW_CONFIDENCE_THRESHOLD, safeFallbackAnalysis } from "../lib/ai/schema";
import Card from "./Card";
import { useAuth } from "./AuthProvider";
import { addMeal, addWorkout, endActiveWorkouts, getActiveWorkout } from "../lib/supabaseDb";
import { enqueueMeal } from "../lib/mealQueue";

export default function CaptureScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading } = useAuth();
  const type = (searchParams.get("type") ?? "food") as "food" | "workout-start" | "workout-end";
  const [file, setFile] = useState<File | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [restaurantNote, setRestaurantNote] = useState("");
  const [showRestaurantInput, setShowRestaurantInput] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<MealAnalysis | null>(null);
  const [meal, setMeal] = useState<MealLog | null>(null);
  const [status, setStatus] = useState<"idle" | "processing" | "refining" | "done">("idle");
  const [requireDone, setRequireDone] = useState(false);
  const [workoutDuration, setWorkoutDuration] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [correction, setCorrection] = useState("");
  const [quickOption, setQuickOption] = useState("");
  const [selectedChip, setSelectedChip] = useState<string>("");
  const [analysisError, setAnalysisError] = useState<string>("");
  const [isImproved, setIsImproved] = useState(false);
  const [showPrecisionModal, setShowPrecisionModal] = useState(false);
  const [precisionScanMode, setPrecisionScanMode] = useState<"label" | "packaging">("label");
  const packagingInputRef = useRef<HTMLInputElement | null>(null);
  const loadingMessages = [
    "Analyzing food…",
    "Estimating macros…",
    "Checking for branded match…"
  ];
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const redirectRef = useRef<number | null>(null);
  const [cameraMode, setCameraMode] = useState<"idle" | "live">("idle");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const canUseInAppCamera =
    !isIOS && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
    }
  }, [loading, user]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

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
          const restored = new File([blob], parsed.name ?? "capture.jpg", {
            type: parsed.type ?? blob.type ?? "image/jpeg"
          });
          setFile(restored);
        })
        .catch(() => {
          // Ignore restore errors.
        });
    } catch {
      // Ignore malformed storage.
    }
  }, [file]);

  useEffect(() => {
    if (!file || !user) return;
    if (type === "food") {
      handleAnalyze(file).catch(() => {
        setStatus("done");
        setAnalysisError("Couldn’t analyze that photo. Try again.");
      });
    } else {
      handleWorkout(file);
    }
  }, [file, type, user]);

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

  useEffect(() => {
    if (status !== "done") return;
    setRequireDone(true);
  }, [status]);

  useEffect(() => {
    if (status !== "processing" && status !== "refining") {
      setLoadingMessageIndex(0);
      return;
    }
    const interval = window.setInterval(() => {
      setLoadingMessageIndex((prev) => (prev + 1) % loadingMessages.length);
    }, 1200);
    return () => window.clearInterval(interval);
  }, [status, loadingMessages.length]);

  const buildResizedDataUrl = async (selected: File) => {
    const imageUrl = URL.createObjectURL(selected);
    const img = new Image();
    img.src = imageUrl;
    await new Promise((resolve, reject) => {
      img.onload = () => resolve(true);
      img.onerror = reject;
    });
    const maxSize = 512;
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

  const handleAnalyze = async (selected: File, hints?: string, packagingImage?: string) => {
    if (!user) return;
    setIsImproved(false);
    setStatus("processing");
    const [resized, thumb] = await Promise.all([
      buildResizedDataUrl(selected),
      fileToThumbnailDataUrl(selected)
    ]);
    setImageBase64(resized);
    const placeholder = safeFallbackAnalysis();
    const pendingMeal = await addMeal(user.id, placeholder, thumb);
    setMeal(pendingMeal);
    window.dispatchEvent(new Event("meals-updated"));
    enqueueMeal(pendingMeal.id, resized);
    if (redirectRef.current) window.clearTimeout(redirectRef.current);
    redirectRef.current = window.setTimeout(() => {
      router.push("/");
    }, 1600);
  };

async function startLiveCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  streamRef.current = stream;
  setCameraMode("live");
}

const stopCamera = () => {
  if (streamRef.current) {
    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }
  if (videoRef.current) {
    videoRef.current.srcObject = null;
  }
  setCameraMode("idle");
};

function openCamera() {
  setCameraMode("file");

  if (fileInputRef.current) {
    fileInputRef.current.click();
  }
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
    const captured = new File([blob], "capture.jpg", { type: "image/jpeg" });
    stopCamera();
    setFile(captured);
  };

  const handleWorkout = async (_selected: File) => {
    if (!user) return;
    setStatus("processing");
    const now = Date.now();
    if (type === "workout-start") {
      const session = await addWorkout(user.id, now);
      setWorkoutDuration(null);
      setStatus("done");
    } else {
      const active = await getActiveWorkout(user.id);
      if (active) {
        const durationMin = minutesBetween(active.startTs, now);
        await endActiveWorkouts(user.id, now);
        setWorkoutDuration(durationMin ?? null);
      } else {
        const durationMin = 45;
        await addWorkout(user.id, now - 45 * 60000);
        setWorkoutDuration(durationMin);
      }
      setStatus("done");
    }
  };

  const widenRangesIfLowConfidence = (input: MealAnalysis) => {
    if (input.confidence_overall_0_1 >= LOW_CONFIDENCE_THRESHOLD) return input;
    const ranges = input.estimated_ranges;
    const widen = (min: number, max: number, cap: number) => {
      const span = Math.max(10, max - min);
      return {
        min: Math.max(0, Math.round(min - Math.min(span * 0.2, cap))),
        max: Math.round(max + Math.min(span * 0.2, cap))
      };
    };
    const cals = widen(ranges.calories_min, ranges.calories_max, 120);
    const protein = widen(ranges.protein_g_min, ranges.protein_g_max, 8);
    const carbs = widen(ranges.carbs_g_min, ranges.carbs_g_max, 25);
    const fat = widen(ranges.fat_g_min, ranges.fat_g_max, 10);
    return {
      ...input,
      estimated_ranges: {
        calories_min: cals.min,
        calories_max: cals.max,
        protein_g_min: protein.min,
        protein_g_max: protein.max,
        carbs_g_min: carbs.min,
        carbs_g_max: carbs.max,
        fat_g_min: fat.min,
        fat_g_max: fat.max
      }
    };
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-surface">
      <div
        className={
          preview
            ? "relative h-screen w-screen overflow-hidden bg-black"
            : "mx-auto flex min-h-screen max-w-md flex-col px-5 pb-20 pt-7"
        }
      >

        {!file && (
          <div className="mt-6">
          <input
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
          {cameraMode === "live" ? (
            <div className="space-y-3">
              {process.env.NODE_ENV === "development" && (
                <p className="mb-2 text-[11px] text-muted/70">
                  camMode={cameraMode} stream={String(!!streamRef.current)} videoEl={String(!!videoRef.current)}
                </p>
              )}
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
          )}
          </div>
        )}

        {preview && (
          <div className="relative w-full">
            <img
              src={preview}
              alt="Preview"
              className="w-full object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white/80 to-transparent pointer-events-none" />

            <div className="absolute inset-0 flex items-center justify-center bg-white/30 backdrop-blur-[1.5px]">
              <div className="flex h-32 w-32 items-center justify-center rounded-full bg-primary shadow-2xl animate-circleImpact">
                <svg
                  className="h-16 w-16 text-white animate-checkmark"
                  viewBox="0 0 52 52"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                >
                  <path
                    d="M14 27 L22 35 L38 18"
                    className="checkmark-path"
                  />
                </svg>
              </div>
            </div>
          </div>
        )}
        {preview && (
          <div className="mt-6 flex flex-col items-center">
            <p className="text-lg font-semibold text-primary animate-fadeIn">
              Image Captured
            </p>
            <p className="mt-1 text-sm text-muted/70">
              Adding to your day…
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
