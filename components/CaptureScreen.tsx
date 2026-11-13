"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fileToThumbnailDataUrl } from "../lib/utils";
import { notifyMealsUpdated } from "../lib/dataEvents";
import { useAuth } from "./AuthProvider";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { useAppData } from "./AppDataProvider";
import { addMeal, updateMealTs, uploadMealThumbnail, updateMealImageUrl } from "../lib/supabaseDb";
import { clampToToday, pendingAnalysis } from "../lib/firstMeal";
import MealTimeChip from "./MealTimeChip";
import { enqueueMeal } from "../lib/mealQueue";
import FoodCamera, { canUseInAppCamera, type FoodPhotoSource } from "./FoodCamera";

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
  const { setMeals } = useAppData();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const redirectRef = useRef<number | null>(null);
  const showTimePickerRef = useRef(false);
  const analyzeStartedRef = useRef(false);
  // Meal time handed over with the photo from the first-meal step (now, or about an hour ago,
  // always today). Null means now, as before.
  const captureTsRef = useRef<number | null>(null);
  // Sent from the first-meal step: go straight back instead of waiting on the "Adding To Your Day"
  // screen. (Every photo now saves the same all-zero placeholder while it analyses.)
  const firstMealRef = useRef(false);
  // The first-meal step's meal time, shown as a chip on the preview (today only, never later than
  // now). Null outside the step, where the photo is saved at the time it's taken, as before.
  const [firstMealTs, setFirstMealTs] = useState<number | null>(null);
  // The in-app camera, over this screen: Retake, or on arrival without a photo.
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoSource, setPhotoSource] = useState<FoodPhotoSource>("camera");
  // A photo handed over from Home is being read back; show nothing rather than "No photo selected".
  const [restoring, setRestoring] = useState(true);
  const [leaving, setLeaving] = useState(false);
  // Whether a photo was handed over, read once before the restore below consumes it.
  const arrivedWithPhotoRef = useRef<boolean | null>(null);
  if (arrivedWithPhotoRef.current === null && typeof window !== "undefined") {
    try { arrivedWithPhotoRef.current = !!sessionStorage.getItem("wya_pending_capture"); } catch { arrivedWithPhotoRef.current = false; }
  }
  const captureContainerRef = useRef<HTMLDivElement | null>(null);
  const [pendingMealId, setPendingMealId] = useState<string | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [mealDate, setMealDate] = useState(todayDateString);
  const [mealTime, setMealTime] = useState(nowTimeString);
  const [saveError, setSaveError] = useState(false);
  const [confirmingTime, setConfirmingTime] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [hint, setHint] = useState("");
  const kbInset = useKeyboardInset();
  const kbOpen = kbInset > 0;

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
    if (!raw) { setRestoring(false); return; }
    try {
      const parsed = JSON.parse(raw) as { name?: string; type?: string; dataUrl?: string; ts?: number; firstMeal?: boolean; source?: string };
      if (!parsed?.dataUrl) { setRestoring(false); return; }
      sessionStorage.removeItem("wya_pending_capture");
      setPhotoSource(parsed.source === "library" ? "library" : "camera");
      const ts = parsed.ts;
      captureTsRef.current =
        typeof ts === "number" && Number.isFinite(ts) && ts <= Date.now() && ts > Date.now() - 14 * 24 * 60 * 60 * 1000 ? ts : null;
      firstMealRef.current = parsed.firstMeal === true;
      if (firstMealRef.current) setFirstMealTs(clampToToday(captureTsRef.current ?? Date.now()));
      fetch(parsed.dataUrl)
        .then((res) => res.blob())
        .then((blob) => {
          setFile(new File([blob], parsed.name ?? "capture.jpg", {
            type: parsed.type ?? blob.type ?? "image/jpeg"
          }));
        })
        .catch(() => {})
        .finally(() => setRestoring(false));
    } catch {
      // Ignore malformed storage.
      setRestoring(false);
    }
  }, [file]);

  // Analysis is now triggered by the Analyze button, not automatically on file select.

  // Arriving without a photo handed over (opened directly, or reloaded after the photo was read):
  // open the camera rather than a dead end. Only on mount, so Cancel doesn't reopen it on the way out.
  useEffect(() => {
    if (!arrivedWithPhotoRef.current && canUseInAppCamera()) setCameraOpen(true);
  }, []);

  // Shrink the capture container to the area above the keyboard (native keyboard height via
  // useKeyboardInset; the photo absorbs the change). Cleared when the keyboard closes.
  useEffect(() => {
    const el = captureContainerRef.current;
    if (!el) return;
    if (kbInset > 0) {
      el.style.height = `calc(100% - ${kbInset}px)`;
      el.style.top = "0px";
    } else {
      el.style.height = "";
      el.style.top = "";
    }
  }, [kbInset]);

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
    // Nothing invented while it analyses: an empty placeholder the real analysis replaces (Home shows "Analyzing").
    const placeholder = pendingAnalysis();
    let pendingMeal;
    try {
      const ts = firstMealRef.current && firstMealTs != null ? clampToToday(firstMealTs) : captureTsRef.current ?? undefined;
      pendingMeal = await addMeal(user.id, placeholder, undefined, undefined, "processing", ts);
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
    setMeals((prev) => [{ ...pendingMeal, analysisJson: placeholder, status: "processing" as const }, ...prev]);
    notifyMealsUpdated();
    enqueueMeal(pendingMeal.id, resized, user.id, hintText || undefined);
    if (firstMealRef.current) {
      // The analysis carries on in the background (mealQueue); Home shows the "Analyzing" pill.
      router.push("/");
      return;
    }
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

  // Retake (or Take A Photo with nothing selected): the in-app camera, or the system camera where
  // getUserMedia doesn't exist.
  const openCamera = () => {
    try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch {}
    if (canUseInAppCamera()) setCameraOpen(true);
    else fileInputRef.current?.click();
  };

  const acceptPhoto = (selected: File, source: FoodPhotoSource) => {
    setFile(selected);
    setPhotoSource(source);
    setCameraOpen(false);
  };

  const closeCamera = () => {
    setCameraOpen(false);
    // Opened on arrival with nothing to go back to: leave, as Cancel does.
    if (!file) {
      setLeaving(true);
      router.push("/");
    }
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
        {/* The system camera, for Retake / Take A Photo where the in-app camera can't run. */}
        <input
          id="camera-file"
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            event.target.value = "";
            if (selected) acceptPhoto(selected, "camera");
          }}
        />

        {!file && !restoring && !cameraOpen && !leaving && (
          <div className="mt-6">
            <div className="flex flex-col items-center gap-3 pt-16">
              <p className="text-sm text-muted/60">No photo selected.</p>
              <button
                type="button"
                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] transition hover:bg-primary/90 active:scale-[0.98]"
                onClick={openCamera}
              >
                Take A Photo
              </button>
              <button
                type="button"
                className="text-sm font-semibold text-ink/60 underline"
                onClick={() => router.push("/")}
              >
                ← Back
              </button>
            </div>
          </div>
        )}

        {preview && !analyzed && (
          <div
            ref={captureContainerRef}
            className="fixed left-0 right-0 top-0 flex flex-col bg-surface"
            style={{ height: "100dvh", paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)", transition: "height 0.25s ease-out, top 0.25s ease-out" }}
          >
            {/* Cancel, Retake */}
            <div className="px-6 pb-3 flex-shrink-0 w-full max-w-sm mx-auto flex items-center justify-between">
              <button
                type="button"
                className="text-sm text-ink/50 underline"
                onClick={() => {
                  setLeaving(true);
                  setFile(null);
                  setHint("");
                  setAnalyzed(false);
                  analyzeStartedRef.current = false;
                  router.push("/");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm font-semibold text-primary transition active:opacity-60"
                onClick={openCamera}
                data-retake
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 17.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8.5a2 2 0 0 1 2-2h2.7l1.8-2.5h5l1.8 2.5H19a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="3.4" />
                </svg>
                {photoSource === "library" ? "Change Photo" : "Retake"}
              </button>
            </div>

            {/* Photo + hint centered in remaining space */}
            <div className="flex-1 min-h-0 flex flex-col px-6">
              <div
                className="relative mt-6 mx-auto rounded-2xl border-2 border-primary/60 overflow-hidden shadow-[0_0_24px_rgba(111,168,255,0.18)]"
                style={{ marginBottom: kbOpen ? "12px" : "0px", transition: "margin-bottom 0.25s ease-out" }}
              >
                <img
                  src={preview}
                  alt="Preview"
                  className="block"
                  style={{ maxWidth: "calc(100vw - 48px)", maxHeight: "55dvh", transition: "max-height 0.25s ease-out" }}
                />
              </div>

              {/* Hint — centered when keyboard hidden, pinned near keyboard when open */}
              <div
                className="flex-1 flex items-center"
                style={{ paddingBottom: kbOpen ? "0px" : "max(calc(env(safe-area-inset-bottom, 0px) + 20px), 44px)", transition: "padding-bottom 0.25s ease-out" }}
              >
                <div className="max-w-sm mx-auto w-full flex flex-col gap-3">
                  <div>
                    <input
                      type="text"
                      value={hint}
                      onChange={(e) => setHint(e.target.value)}
                      placeholder="e.g. Veggie Burger, Turkey Sandwich"
                      className="w-full rounded-xl border border-primary/40 bg-white px-4 py-3 text-sm text-ink/80 placeholder:text-ink/35 focus:outline-none focus:ring-1 focus:ring-primary/50"
                    />
                    <p className="mt-1.5 text-xs text-ink/40 text-center tracking-wide">Help your food get properly identified with a hint</p>
                  </div>
                  {firstMealTs != null && (
                    <div className="flex justify-center"><MealTimeChip value={firstMealTs} onChange={setFirstMealTs} /></div>
                  )}
                  <button
                    type="button"
                    className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] transition hover:bg-primary/90 active:scale-[0.98]"
                    onClick={handleAnalyzeTap}
                  >
                    {/* From the first-meal step it's saved straight away and analysed in the
                        background, same as Type It In there, so the same words. */}
                    {firstMealTs != null ? "Log It" : "Analyze"}
                  </button>
                </div>
              </div>
            </div>
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
                <div className="flex flex-col items-center gap-3">
                  <p className="text-base text-muted/70">Adding To Your Day</p>
                  <svg className="animate-spin text-primary/40" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="40 20" />
                  </svg>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <FoodCamera open={cameraOpen} onClose={closeCamera} onPhoto={acceptPhoto} />
    </div>
  );
}
