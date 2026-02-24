"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { MealLog, MealAnalysis } from "../lib/types";
import { fileToBase64, fileToThumbnailDataUrl, minutesBetween, formatApprox } from "../lib/utils";
import { coerceAnalysis, LOW_CONFIDENCE_THRESHOLD, safeFallbackAnalysis } from "../lib/ai/schema";
import Card from "./Card";
import { useAuth } from "./AuthProvider";
import { addMeal, addWorkout, getActiveWorkout, updateMeal, updateWorkout } from "../lib/supabaseDb";

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
    if (!file || !user) return;
    if (type === "food") {
      handleAnalyze(file).catch(() => {
        const fallback = safeFallbackAnalysis();
        setAnalysis(fallback);
        setStatus("done");
        setAnalysisError("Couldn’t analyze that photo. Try again.");
        addMeal(user.id, fallback).then((saved) => setMeal(saved));
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
    const response = await fetch("/api/analyze-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: resized,
        imageBase64Secondary: packagingImage ?? undefined,
        hints: hints ?? undefined
      })
    });
    if (!response.ok) {
      throw new Error("Analyze request failed");
    }
    const data = await response.json();
    const parsed = coerceAnalysis(data?.analysis);
    const adjusted =
      parsed.estimated_ranges.calories_min === parsed.estimated_ranges.calories_max
        ? parsed
        : widenRangesIfLowConfidence(parsed);
    setAnalysisError("");
    let savedMeal: MealLog | null = null;
    try {
      savedMeal = await addMeal(user.id, adjusted, thumb);
    } catch (err) {
      console.error("Meal insert failed", err);
    }
    if (!savedMeal) return;
    setMeal(savedMeal);
    setAnalysis(adjusted);
    setStatus("done");
    window.dispatchEvent(new Event("meals-updated"));
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

const openCamera = async () => {
  if (!canUseInAppCamera) {
    fileInputRef.current?.click();
    return;
  }
  try {
    await startLiveCamera();
  } catch {
    fileInputRef.current?.click();
  }
};

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
        await updateWorkout(active.id, user.id, now, durationMin);
        setWorkoutDuration(durationMin ?? null);
      } else {
        const durationMin = 45;
        await addWorkout(user.id, now - 45 * 60000);
        setWorkoutDuration(durationMin);
      }
      setStatus("done");
    }
  };

  const summaryTitle = useMemo(() => {
    if (type === "food") return "Noted";
    return "Workout noted";
  }, [type]);

  const derivedQuickOptions = useMemo(() => {
    if (!analysis?.detected_items?.length) return [];
    const name = analysis.detected_items[0]?.name?.toLowerCase() ?? "";
    if (name.includes("burger")) return ["Beef", "Chicken", "Plant-based", "Turkey"];
    if (name.includes("pizza")) return ["Cheese", "Pepperoni", "Vegetable", "Chicken"];
    if (name.includes("taco") || name.includes("burrito")) return ["Beef", "Chicken", "Fish", "Vegetarian"];
    if (name.includes("salad")) return ["Chicken", "Fish", "Egg", "Vegetarian"];
    if (name.includes("sandwich")) return ["Turkey", "Chicken", "Beef", "Vegetarian"];
    if (name.includes("bowl")) return ["Chicken", "Beef", "Fish", "Vegetarian"];
    if (name.includes("pasta")) return ["Meat", "Chicken", "Seafood", "Vegetarian"];
    if (name.includes("sushi")) return ["Salmon", "Tuna", "Shrimp", "Vegetarian"];
    if (name.includes("yogurt")) return ["Dairy", "Non-dairy", "Added granola", "Plain"];
    if (name.includes("egg")) return ["Eggs", "Eggs + meat", "Vegetarian", "With toast"];
    return ["Mixed plate", "Sandwich", "Bowl", "Other"];
  }, [analysis]);

  const derivedDishCandidates = useMemo(() => {
    if (!analysis?.detected_items?.length) return [];
    const name = analysis.detected_items[0]?.name?.toLowerCase() ?? "";
    if (!name) return [];
    if (name.includes("fries")) return ["Poutine", "Loaded fries", "Side fries"];
    if (name.includes("sandwich") || name.includes("steak")) return ["Philly cheesesteak", "Steak sandwich"];
    if (name.includes("burger")) return ["Burger with fries", "Cheeseburger", "Burger bowl"];
    if (name.includes("pizza")) return ["Pepperoni pizza", "Cheese pizza", "Veggie pizza"];
    if (name.includes("taco") || name.includes("burrito")) return ["Burrito bowl", "Taco plate", "Loaded tacos"];
    if (name.includes("salad")) return ["Chicken salad", "Cobb salad", "Greek salad"];
    if (name.includes("pasta")) return ["Pasta with chicken", "Pasta with meat", "Veggie pasta"];
    if (name.includes("noodle") || name.includes("ramen")) return ["Ramen bowl", "Noodle bowl", "Stir-fry noodles"];
    if (name.includes("sushi")) return ["Salmon roll", "Tuna roll", "Sushi combo"];
    if (name.includes("bowl")) return ["Burrito bowl", "Poke bowl", "Rice bowl"];
    return [];
  }, [analysis]);

  const quickOptions =
    analysis?.confidence_overall_0_1 && analysis.confidence_overall_0_1 < LOW_CONFIDENCE_THRESHOLD
      ? (analysis.optional_quick_confirm_options?.length ? analysis.optional_quick_confirm_options : derivedQuickOptions)
      : [];

  const clarifyChips = useMemo(() => {
    if (!analysis?.confidence_overall_0_1 || analysis.confidence_overall_0_1 >= LOW_CONFIDENCE_THRESHOLD) {
      return [];
    }
    const name = analysis.detected_items?.[0]?.name?.toLowerCase() ?? "";
    if (name.includes("burger") || name.includes("sandwich") || name.includes("taco") || name.includes("burrito")) {
      return ["Beef", "Chicken", "Vegetarian", "Takeout"];
    }
    if (name.includes("salad") || name.includes("bowl")) {
      return ["Chicken", "Fish", "Vegetarian", "No dairy"];
    }
    if (name.includes("pizza")) {
      return ["Cheese", "Pepperoni", "Vegetable", "Takeout"];
    }
    return ["Vegetarian", "No dairy", "Takeout"];
  }, [analysis]);

  const handleSaveCorrection = async () => {
    if (!meal) return;
    await updateMeal(meal.id, analysis ?? safeFallbackAnalysis(), {
      note: quickOption || correction || undefined,
      chips: selectedChip ? [selectedChip] : []
    });
    setEditOpen(false);
    if (redirectRef.current) window.clearTimeout(redirectRef.current);
    router.push("/");
  };

  const handleInteract = () => {
    if (redirectRef.current) window.clearTimeout(redirectRef.current);
  };

  const reanalyzeMeal = async (hints?: string, packagingImage?: string) => {
    if (!meal || !imageBase64) return;
    setStatus("processing");
    const response = await fetch("/api/analyze-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64,
        imageBase64Secondary: packagingImage ?? undefined,
        hints: hints ?? undefined
      })
    });
    if (!response.ok) {
      setAnalysisError("Couldn’t refine that photo.");
      setStatus("done");
      return;
    }
    const data = await response.json();
    const parsed = coerceAnalysis(data?.analysis);
    const adjusted =
      parsed.estimated_ranges.calories_min === parsed.estimated_ranges.calories_max
        ? parsed
        : widenRangesIfLowConfidence(parsed);
    setAnalysisError("");
    setAnalysis(adjusted);
    await updateMeal(meal.id, adjusted, {
      note: quickOption || correction || restaurantNote || hints || undefined,
      chips: selectedChip ? [selectedChip] : hints ? [hints] : []
    });
    setStatus("done");
  };

  const handlePrecisionScan = async (selected: File, mode: "label" | "packaging") => {
    if (!user || !imageBase64) return;
    setStatus("refining");
    const packagingImageBase64 = await buildResizedDataUrl(selected);
    const hints =
      mode === "label"
        ? "Nutrition label provided. Prefer exact macro values and serving size."
        : "Packaging/front provided. Infer exact product name and SKU.";
    const response = await fetch("/api/analyze-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64,
        imageBase64Secondary: packagingImageBase64,
        hints
      })
    });
    if (!response.ok) {
      setAnalysisError("Couldn’t refine that photo.");
      setStatus("done");
      return;
    }
    const data = await response.json();
    const parsed = coerceAnalysis(data?.analysis);
    const adjusted =
      parsed.estimated_ranges.calories_min === parsed.estimated_ranges.calories_max
        ? parsed
        : widenRangesIfLowConfidence(parsed);
    setAnalysisError("");
    if (meal) {
      await updateMeal(meal.id, adjusted);
      setAnalysis(adjusted);
    } else {
      const savedMeal = await addMeal(user.id, adjusted);
      setMeal(savedMeal);
      setAnalysis(adjusted);
    }
    setIsImproved(true);
    setStatus("done");
    setShowPrecisionModal(false);
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
      <input
        ref={packagingInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const selected = event.target.files?.[0] ?? null;
          if (selected) handlePrecisionScan(selected, precisionScanMode);
        }}
      />
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-20 pt-7">
        <Link href="/" className="text-sm font-semibold text-ink underline">← Back</Link>

        <div className="mt-4">
          <h1 className="text-2xl font-semibold text-ink">
            {type === "food" ? "Food photo" : "Workout photo"}
          </h1>
          <p className="mt-2 text-sm text-muted/80">
            {type === "food" ? "Saved on capture." : "A quick moment."}
          </p>
        </div>

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
          ) : canUseInAppCamera ? (
            <button
              type="button"
              className="block w-full rounded-xl bg-primary px-5 py-4 text-center text-base font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] ring-1 ring-white/40 transition hover:bg-primary/90 active:scale-[0.98]"
              onClick={openCamera}
            >
              Open Camera
            </button>
          ) : (
            <>
              <label
                htmlFor="camera-file"
                className="block w-full rounded-xl bg-primary px-5 py-4 text-center text-base font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] ring-1 ring-white/40 transition hover:bg-primary/90 active:scale-[0.98]"
              >
                Open Camera
              </label>
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
            </>
          )}
          </div>
        )}

        {preview && (
          <Card className="mt-5 p-3">
            <img src={preview} alt="Preview" className="w-full rounded-xl object-cover" />
            {status === "done" && requireDone && (
              <>
                <button
                  className="mt-3 w-full rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white"
                  onClick={() => router.push("/")}
                >
                  Done
                </button>
                {analysis?.precision_mode_available && (
                  <button
                    className="mt-3 w-full rounded-xl bg-primary/80 px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary"
                    onClick={() => setShowPrecisionModal(true)}
                  >
                    Click to improve nutrition accuracy
                  </button>
                )}
                {analysis?.confidence_overall_0_1 &&
                  analysis.confidence_overall_0_1 < LOW_CONFIDENCE_THRESHOLD && (
                  <button
                    className="mt-3 w-full text-xs text-muted/70 underline"
                    onClick={() => setShowRestaurantInput((open) => !open)}
                  >
                    Add restaurant description (optional)
                  </button>
                )}
                {showRestaurantInput && (
                  <div className="mt-2">
                    <input
                      type="text"
                      value={restaurantNote}
                      onChange={(event) => setRestaurantNote(event.target.value)}
                      placeholder="e.g., McDonald’s"
                      className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    />
                    <button
                      className="mt-2 w-full rounded-xl bg-ink/5 px-3 py-2 text-xs font-semibold text-ink/80"
                      onClick={() => {
                        handleInteract();
                        if (restaurantNote.trim()) {
                          reanalyzeMeal(restaurantNote.trim());
                          setShowRestaurantInput(false);
                        }
                      }}
                    >
                      Apply
                    </button>
                  </div>
                )}
              </>
            )}
          </Card>
        )}

        {(status === "processing" || status === "refining") && (
          <Card className="mt-6">
            <p className="text-sm text-muted/80">
              {loadingMessages[loadingMessageIndex]}
            </p>
          </Card>
        )}

        {status === "done" && type !== "food" && (
          <Card className="mt-6">
            <p className="text-xs text-muted/70">{summaryTitle}</p>
            <p className="mt-2 text-sm text-ink/90">
              {workoutDuration ? `Workout session: ~${workoutDuration} minutes` : "Noted."}
            </p>
            {!preview && requireDone && (
              <button
                className="mt-3 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white"
                onClick={() => router.push("/")}
              >
                Done
              </button>
            )}
          </Card>
        )}

        {status === "done" && type === "food" && analysis && (
          <Card className="mt-6">
            <p className="text-xs text-muted/70">{summaryTitle}</p>
            {analysis.confidence_overall_0_1 < 0.2 &&
            (analysis.detected_items?.[0]?.name ?? "Meal") === "Meal" ? (
              <div className="mt-2">
                <p className="text-sm text-ink/80">Couldn’t analyze that photo.</p>
                <p className="mt-1 text-xs text-muted/70">Try another angle or a clearer meal photo.</p>
              </div>
            ) : (
              <>
                <p className="mt-2 text-lg font-semibold text-ink/90">
                  {analysis.detected_items?.[0]?.name ?? "Meal"}
                </p>
                <div className="mt-4 flex gap-6 text-sm text-muted">
                  <div>
                    <p className="text-base font-semibold text-ink/90">
                      {formatApprox(
                        analysis.estimated_ranges.calories_min,
                        analysis.estimated_ranges.calories_max
                      )}
                      {isImproved && (
                        <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          Improved
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted/60">Calories · approx.</p>
                  </div>
                  <div>
                    <p className="text-base font-semibold text-ink/90">
                      {formatApprox(
                        analysis.estimated_ranges.protein_g_min,
                        analysis.estimated_ranges.protein_g_max,
                        "g"
                      )}
                    </p>
                    <p className="text-[11px] text-muted/60">Protein · approx.</p>
                  </div>
                </div>
              </>
            )}

            {quickOptions.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-wide text-muted/60">Quick confirm (optional)</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {quickOptions.map((option) => (
                    <button
                      key={option}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${
                        quickOption === option ? "border-ink/20 bg-ink/10 text-ink/80" : "border-ink/10 text-ink/60"
                      }`}
                      onClick={() => {
                        handleInteract();
                        setQuickOption(option);
                        setCorrection("");
                        reanalyzeMeal(option);
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {derivedDishCandidates.length > 0 &&
              analysis?.confidence_overall_0_1 &&
              analysis.confidence_overall_0_1 < LOW_CONFIDENCE_THRESHOLD && (
                <div className="mt-4">
                  <p className="text-[10px] uppercase tracking-wide text-muted/60">
                    Possible dish (tap to refine)
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {derivedDishCandidates.map((candidate) => (
                      <button
                        key={candidate}
                        className="rounded-full border border-ink/10 px-3 py-1 text-xs font-medium text-ink/60"
                        onClick={() => {
                          handleInteract();
                          setCorrection(candidate);
                          reanalyzeMeal(candidate);
                        }}
                      >
                        {candidate}
                      </button>
                    ))}
                  </div>
                </div>
              )}

            {clarifyChips.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-wide text-muted/60">Clarify (optional)</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {clarifyChips.map((chip) => (
                    <button
                      key={chip}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${
                        selectedChip === chip ? "border-ink/20 bg-ink/10 text-ink/80" : "border-ink/10 text-ink/60"
                      }`}
                      onClick={() => {
                        handleInteract();
                        setSelectedChip(chip);
                        reanalyzeMeal(chip);
                      }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            )}

            

            {analysisError && (
              <p className="mt-3 text-xs text-muted/70">{analysisError}</p>
            )}

            {!preview && requireDone && (
              <>
                <button
                  className="mt-3 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white"
                  onClick={() => router.push("/")}
                >
                  Done
                </button>
                {analysis?.confidence_overall_0_1 &&
                  analysis.confidence_overall_0_1 < LOW_CONFIDENCE_THRESHOLD && (
                  <button
                    className="mt-3 text-xs text-muted/70 underline"
                    onClick={() => setShowRestaurantInput((open) => !open)}
                  >
                    Add restaurant description (optional)
                  </button>
                )}
                {showRestaurantInput && (
                  <div className="mt-2">
                    <input
                      type="text"
                      value={restaurantNote}
                      onChange={(event) => setRestaurantNote(event.target.value)}
                      placeholder="e.g., McDonald’s"
                      className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    />
                    <button
                      className="mt-2 rounded-xl bg-ink/5 px-3 py-2 text-xs font-semibold text-ink/80"
                      onClick={() => {
                        handleInteract();
                        if (restaurantNote.trim()) {
                          reanalyzeMeal(restaurantNote.trim());
                          setShowRestaurantInput(false);
                        }
                      }}
                    >
                      Apply
                    </button>
                  </div>
                )}
              </>
            )}
          </Card>
        )}
        {showPrecisionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-sm text-ink shadow-xl">
              <p className="text-base font-semibold">Improve Accuracy</p>
              <p className="mt-2 text-sm text-ink/80">
                {analysis?.detected_brand
                  ? "We detected a packaged item. You can scan the nutrition label for exact values."
                  : "You can adjust portion size or confirm the food type to tighten estimates."}
              </p>
              <div className="mt-4 space-y-3">
                <button
                  className="w-full rounded-xl border border-ink/10 bg-ink/5 px-4 py-2 text-xs font-semibold text-ink/70"
                  onClick={() => {
                    setPrecisionScanMode("label");
                    packagingInputRef.current?.click();
                    setShowPrecisionModal(false);
                  }}
                  disabled={status === "refining"}
                >
                  Scan nutrition label
                </button>
                <button
                  className="w-full rounded-xl border border-ink/10 bg-ink/5 px-4 py-2 text-xs font-semibold text-ink/70"
                  onClick={() => {
                    setPrecisionScanMode("packaging");
                    packagingInputRef.current?.click();
                    setShowPrecisionModal(false);
                  }}
                  disabled={status === "refining"}
                >
                  Scan packaging/front
                </button>
              </div>
              <button
                className="mt-4 w-full rounded-xl bg-ink/5 px-4 py-2 text-xs font-semibold text-ink/70"
                onClick={() => setShowPrecisionModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
