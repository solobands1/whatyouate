"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Joyride, { CallBackProps, STATUS, type Step } from "react-joyride";
import { useRouter } from "next/navigation";
import type { MealLog, UserProfile, WorkoutSession } from "../lib/types";
import {
  MEALS_UPDATED_EVENT,
  PROFILE_UPDATED_EVENT,
  notifyWorkoutsUpdated
} from "../lib/dataEvents";
import { formatApprox, formatDateShort, todayKey } from "../lib/utils";
import { supabase } from "../lib/supabaseClient";
import "../lib/mealQueue";
import BarcodeScannerOverlay from "./BarcodeScannerOverlay";
import BottomNav from "./BottomNav";
import Card from "./Card";
import { useAuth } from "./AuthProvider";
import {
  addMeal,
  deleteMeal,
  deleteWorkout,
  getProfile,
  updateMeal,
} from "../lib/supabaseDb";
import { computeHomeMarkers, computeRecent } from "../lib/digestEngine";
import { useWorkout, WORKOUT_TYPE_OPTIONS } from "../hooks/useWorkout";
import { useMeals } from "../hooks/useMeals";

export default function HomeScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<UserProfile | undefined>();
  const [runTour, setRunTour] = useState(false);
  const [showTourGate, setShowTourGate] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [barcodeNotFound, setBarcodeNotFound] = useState(false);
  const [barcodeSuccess, setBarcodeSuccess] = useState(false);
  const [barcodeLookingUp, setBarcodeLookingUp] = useState(false);
  const [barcodeProduct, setBarcodeProduct] = useState<{
    name: string; brand: string; calories: number; protein: number;
    carbs: number; fat: number; valuePer: "serving" | "100g";
  } | null>(null);
  const [editRecents, setEditRecents] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    type: "meal" | "workout";
    id: string;
  } | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);
  const [visibleRecentCount, setVisibleRecentCount] = useState(6);

  const mountedRef = useRef(true);
  const recentSentinelRef = useRef<HTMLDivElement | null>(null);
  const foodInputRef = useRef<HTMLInputElement | null>(null);
  const realtimeRefreshRef = useRef<number | null>(null);

  const onError = useCallback((msg: string) => setLoadError(msg), []);

  const workout = useWorkout(user, onError, setEditRecents);
  const meals = useMeals(user, onError, setEditRecents);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoadingData(true);
    setLoadError(null);
    try {
      const [profileData] = await Promise.all([
        getProfile(user.id),
        workout.load(user.id),
        meals.load(user.id),
      ]);
      if (!mountedRef.current) return;
      setProfile(profileData ?? undefined);
    } catch (err) {
      console.error("[loadData] failed:", err);
      setLoadError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      if (mountedRef.current) setLoadingData(false);
    }
  }, [user, workout.load, meals.load]);

  const handleConfirmDelete = async () => {
    if (!pendingDelete || !user) return;
    setDeletingItem(true);
    const { type, id } = pendingDelete;
    try {
      if (type === "meal") {
        await deleteMeal(id, user.id);
        meals.setMeals((prev) => prev.filter((m) => m.id !== id));
        meals.setEditingMeal(null);
        setEditRecents(false);
      } else {
        await deleteWorkout(id, user.id);
        workout.setWorkouts((prev) => prev.filter((w) => w.id !== id));
        workout.setEditingWorkout(null);
        setEditRecents(false);
        notifyWorkoutsUpdated();
      }
    } catch (err) {
      console.error("[delete] FAILED", err);
      setLoadError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeletingItem(false);
      setPendingDelete(null);
    }
  };

  const handleFoodPhotoClick = () => {
    foodInputRef.current?.click();
  };

  const handleFoodFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(selected);
    });
    try {
      sessionStorage.setItem(
        "wya_pending_capture",
        JSON.stringify({ name: selected.name, type: selected.type, dataUrl })
      );
    } catch {
      // If storage fails, fall back to capture screen.
    }
    router.push("/capture?type=food&from=home");
  };

  const handleBarcodeDetected = async (barcode: string) => {
    if (!user) return;
    setBarcodeLookingUp(true);
    let res: Response;
    try {
      res = await fetch("/api/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode }),
      });
    } catch {
      setBarcodeLookingUp(false);
      setBarcodeNotFound(true);
      return;
    }
    setBarcodeLookingUp(false);
    if (!res.ok) {
      setBarcodeNotFound(true);
      return;
    }
    const product = await res.json();
    const name = String(product?.name ?? "").trim() || String(product?.brand ?? "").trim();
    if (!name) {
      setBarcodeNotFound(true);
      return;
    }
    const toVal = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    setBarcodeProduct({
      name,
      brand: String(product?.brand ?? "").trim(),
      calories: toVal(product?.calories),
      protein: toVal(product?.protein),
      carbs: toVal(product?.carbs),
      fat: toVal(product?.fat),
      valuePer: product?.valuePer === "100g" ? "100g" : "serving",
    });
  };

  const handleConfirmBarcodeProduct = async () => {
    if (!user || !barcodeProduct) return;
    const { name, brand, calories, protein, carbs, fat } = barcodeProduct;
    const analysis = {
      name,
      detected_items: [{ name, confidence_0_1: 1 }],
      estimated_ranges: {
        calories_min: calories, calories_max: calories,
        protein_g_min: protein, protein_g_max: protein,
        carbs_g_min: carbs, carbs_g_max: carbs,
        fat_g_min: fat, fat_g_max: fat,
      },
      micronutrient_signals: [],
      confidence_overall_0_1: 1,
      detected_brand: brand || null,
      detected_product: name,
      database_match_confidence_0_1: 1,
      precision_mode_available: false,
    } as any;
    setBarcodeProduct(null);
    try {
      const created = await addMeal(user.id, analysis);
      if (created?.id) {
        await updateMeal(created.id, analysis);
        const finishedMeal = { ...created, analysisJson: analysis, status: "done" as const };
        meals.setMeals((prev) => [finishedMeal, ...prev]);
      }
      setBarcodeSuccess(true);
      setTimeout(() => setBarcodeSuccess(false), 1500);
    } catch (err) {
      console.error("[barcode] save failed:", err);
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user, loadData]);

  useEffect(() => {
    setEditRecents(false);
  }, []);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener(PROFILE_UPDATED_EVENT, handler as EventListener);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, handler as EventListener);
  }, [user, loadData]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener(MEALS_UPDATED_EVENT, handler as EventListener);
    return () => window.removeEventListener(MEALS_UPDATED_EVENT, handler as EventListener);
  }, [user, loadData]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("meals-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meals" },
        (payload: any) => {
          const rowUserId = payload?.new?.user_id ?? payload?.old?.user_id;
          if (rowUserId !== user.id) return;
          if (realtimeRefreshRef.current) {
            window.clearTimeout(realtimeRefreshRef.current);
          }
          realtimeRefreshRef.current = window.setTimeout(() => {
            loadData();
          }, 250);
        }
      )
      .subscribe();

    return () => {
      if (realtimeRefreshRef.current) {
        window.clearTimeout(realtimeRefreshRef.current);
        realtimeRefreshRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [user, loadData]);

  useEffect(() => {
    if (!user) return;
    const key = `wya_walkthrough_${user.id}`;
    const seen = localStorage.getItem(key);
    const gateKey = `wya_walkthrough_gate_${user.id}`;
    const gateSeen = localStorage.getItem(gateKey);
    const activeKey = `wya_walkthrough_active_${user.id}`;
    const stageKey = `wya_walkthrough_stage_${user.id}`;
    const active = localStorage.getItem(activeKey) === "true";
    const stage = localStorage.getItem(stageKey) ?? "home";
    if (active && stage === "home") {
      setRunTour(true);
      setShowTourGate(false);
      return;
    }
    if (!seen && !active && !gateSeen) {
      localStorage.setItem(gateKey, "true");
      setShowTourGate(true);
    }
  }, [user]);

  const homeMarkers = useMemo(
    () => computeHomeMarkers(meals.meals, workout.workouts, profile),
    [meals.meals, workout.workouts, profile]
  );
  const completedWorkouts = useMemo(
    () => workout.workouts.filter((w) => w.endTs),
    [workout.workouts]
  );
  const recentItems = useMemo(() => {
    const result = computeRecent(meals.meals, completedWorkouts);
    console.log(`[recentItems] ${result.length} items:`);
    result.forEach((i, idx) => {
      if (i.type === "workout") {
        console.log(`  [${idx}] WORKOUT ${i.workout.id.slice(0,8)} sortTs=${i.ts} endTs=${i.workout.endTs} startTs=${i.workout.startTs}`);
      } else {
        console.log(`  [${idx}] MEAL    ${i.meal.id.slice(0,8)} sortTs=${i.ts}`);
      }
    });
    return result;
  }, [meals.meals, completedWorkouts]);

  const formatTitle = (value: string) =>
    value
      .split(" ")
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
      .join(" ");
  const formatClean = (min: number, max: number, unit = "") =>
    formatApprox(min, max, unit).replace(/^~/, "");
  const formatWorkoutDurationLines = (w: WorkoutSession) => {
    const endTs = w.endTs ?? Date.now();
    const rawMinutes = (endTs - w.startTs) / 60000;
    const minutes = rawMinutes < 1 ? 0 : Math.ceil(rawMinutes);
    if (minutes === 0) return { title: "Workout", detail: "<1 min" };
    if (minutes < 60) return { title: "Workout", detail: `${minutes} mins` };
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return { title: "Workout", detail: mins === 0 ? `${hours}h` : `${hours}h ${mins} mins` };
  };

  const formatDayLabel = (ts: number) => {
    const key = todayKey(new Date(ts));
    const today = todayKey();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = todayKey(yesterdayDate);
    if (key === today) return "Today";
    if (key === yesterday) return "Yesterday";
    return formatDateShort(ts);
  };

  const recentFiltered = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return recentItems.filter((item) => !item.ts || item.ts >= cutoff);
  }, [recentItems]);

  useEffect(() => {
    setVisibleRecentCount(6);
  }, [recentFiltered.length]);

  const groupedRecent = useMemo(() => {
    const groups: Array<{ label: string; meals: MealLog[]; workouts: WorkoutSession[] }> = [];
    recentFiltered.forEach((item) => {
      const label = formatDayLabel(item.ts);
      let group = groups.find((entry) => entry.label === label);
      if (!group) {
        group = { label, meals: [], workouts: [] };
        groups.push(group);
      }
      if (item.type === "meal") {
        group.meals.push(item.meal);
      } else {
        group.workouts.push(item.workout);
      }
    });
    return groups;
  }, [recentFiltered]);

  useEffect(() => {
    if (!recentSentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        setVisibleRecentCount((current) => {
          if (current >= recentFiltered.length) return current;
          return Math.min(current + 6, recentFiltered.length);
        });
      },
      { rootMargin: "120px" }
    );
    observer.observe(recentSentinelRef.current);
    return () => observer.disconnect();
  }, [recentFiltered.length]);

  if (!user) return null;

  const gentleTargetsDisplay = homeMarkers.gentleTargets ?? { calories: 2300, protein: 125 };
  const mealCount = homeMarkers.mealCount;

  const steps = [
    {
      target: '[data-tour="food-action"]',
      content: "Take photos. That's it.",
      disableBeacon: true
    },
    {
      target: '[data-tour="workout-markers"]',
      content: "We look at food and workout patterns over time.",
      disableBeacon: true
    },
    {
      target: '[data-tour="nav-summary"]',
      content: "No strict macros.",
      placement: "top" as const,
      disableBeacon: true
    },
    {
      target: "body",
      content: "Everything is approximate to keep things light.",
      disableBeacon: true
    }
  ] as Step[];

  const handleTourCallback = (data: CallBackProps) => {
    if (!user) return;
    const activeKey = `wya_walkthrough_active_${user.id}`;
    const stageKey = `wya_walkthrough_stage_${user.id}`;
    if (data.status === STATUS.SKIPPED) {
      localStorage.setItem(`wya_walkthrough_${user.id}`, "true");
      localStorage.removeItem(activeKey);
      localStorage.removeItem(stageKey);
      setRunTour(false);
      return;
    }
    if (data.type === "step:after" && data.index === steps.length - 1) {
      localStorage.setItem(activeKey, "true");
      localStorage.setItem(stageKey, "summary");
      setRunTour(false);
      router.push("/summary");
    }
  };

  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-surface">
      {typeof window !== "undefined" && (
        <Joyride
          steps={steps}
          run={runTour}
          continuous
          showSkipButton
          hideCloseButton
          disableOverlayClose
          scrollToFirstStep
          callback={handleTourCallback}
          locale={{
            skip: "Skip",
            back: "Back",
            last: "Next",
            close: "Skip"
          }}
          styles={{
            options: {
              primaryColor: "#6FA8FF",
              textColor: "#1F2937",
              backgroundColor: "#FFFFFF",
              arrowColor: "#FFFFFF"
            },
            buttonClose: {
              display: "none"
            },
            buttonSkip: {
              display: "block"
            }
          }}
        />
      )}
      {showTourGate && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="flex max-w-xs flex-col items-center gap-4 text-center">
            <div className="w-full px-5 py-1 text-center">
              <p className="text-[26px] font-semibold text-ink/80">
                Hey{" "}
                {profile?.firstName ||
                  (user as { user_metadata?: Record<string, string> })?.user_metadata?.first_name ||
                  "there"}
              </p>
            </div>
            <div className="space-y-1 text-sm text-ink/70">
              <p className="text-[15px] font-semibold text-ink/80">Thanks for joining!</p>
              <p>
                We help you log meals and workouts so you can spot patterns, get gentle nudges, and
                make small changes that add up over time. Take the walkthrough to get started.
              </p>
            </div>
            <button
              type="button"
              className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] ring-1 ring-white/40 transition hover:bg-primary/90"
              onClick={() => {
                if (!user) return;
                localStorage.setItem(`wya_walkthrough_active_${user.id}`, "true");
                localStorage.setItem(`wya_walkthrough_stage_${user.id}`, "home");
                setShowTourGate(false);
                setRunTour(true);
              }}
            >
              Start Walkthrough
            </button>
          </div>
        </div>
      )}
      {workout.showStartWorkoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink">Start workout</h2>
            <p className="mt-2 text-sm text-muted/70">
              {workout.activeWorkout
                ? "A workout is already in progress."
                : "Confirm you want to start your workout now."}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => workout.setShowStartWorkoutModal(false)}
              >
                Close
              </button>
              {!workout.activeWorkout && (
                <button
                  type="button"
                  className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90"
                  onClick={workout.handleStartWorkout}
                >
                  Start workout
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {workout.showEndWorkoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink">End workout</h2>
            <p className="mt-2 text-sm text-muted/70">
              {workout.activeWorkout ? "Confirm your workout details." : "No active workout in progress."}
            </p>
            {workout.activeWorkout && (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                    Workout type
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {WORKOUT_TYPE_OPTIONS.map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          workout.selectedWorkoutTypes.includes(type)
                            ? "border-primary/30 bg-primary/10 text-ink"
                            : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"
                        }`}
                        onClick={() => workout.toggleWorkoutType(type)}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                    Intensity
                  </p>
                  <div className="mt-2 flex gap-2">
                    {([
                      { value: "low", label: "Low" },
                      { value: "medium", label: "Medium" },
                      { value: "high", label: "High" }
                    ] as const).map((level) => (
                      <button
                        key={level.value}
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          workout.selectedIntensity === level.value
                            ? "border-primary/30 bg-primary/10 text-ink"
                            : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"
                        }`}
                        onClick={() => workout.setSelectedIntensity(level.value)}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => workout.setShowEndWorkoutModal(false)}
              >
                Close
              </button>
              {workout.activeWorkout && (
                <button
                  type="button"
                  disabled={workout.isEndingWorkout}
                  className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                  onClick={workout.handleEndWorkout}
                >
                  {workout.isEndingWorkout ? "Ending…" : "End workout"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {pendingDelete && !meals.editingMeal && !workout.editingWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink">Delete {pendingDelete.type}</h2>
            <p className="mt-2 text-sm text-muted/70">
              {pendingDelete.type === "meal"
                ? "Are you sure you want to delete this meal?"
                : "Are you sure you want to delete this workout?"}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => setPendingDelete(null)}
                disabled={deletingItem}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90"
                onClick={handleConfirmDelete}
                disabled={deletingItem}
              >
                {deletingItem ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 pt-6">
        <header className="mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink">
              WhatYouAt<span className="relative inline-block">e
                <span className="absolute -top-1 right-0 translate-x-[10px] text-[9px] font-semibold text-ink/60">
                  AI
                </span>
              </span>
            </h1>
            <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-semibold text-primary">
              BETA
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted/70">Take photos, get nudges, improve.</p>
          {mealCount === 0 && (
            <p className="mt-3 text-[11px] text-muted/60">
              All preview data will be replaced by real input once logging starts.
            </p>
          )}
          {loadError && <p className="mt-2 text-[11px] text-muted/60">{loadError}</p>}
        </header>

        {!loadingData && !profile && (
          <Card className="mt-4 border border-ink/5 bg-ink/5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink/70">Add profile for better estimates.</p>
              <Link href="/profile" className="text-xs font-semibold text-ink/70 underline">
                Add
              </Link>
            </div>
          </Card>
        )}

        <Card className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Today</p>
          <div className="mt-3 flex items-baseline justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/60">Calories</p>
              <p className="mt-1 text-2xl font-semibold">
                {formatClean(homeMarkers.todayTotals.calories_min, homeMarkers.todayTotals.calories_max)}
              </p>
              <p className="text-[10px] text-muted/50">approx.</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/60">Protein</p>
              <p className="mt-1 text-2xl font-semibold">
                {formatClean(
                  homeMarkers.todayTotals.protein_g_min,
                  homeMarkers.todayTotals.protein_g_max,
                  "g"
                )}
              </p>
              <p className="text-[10px] text-muted/50">approx.</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted/70">
            Suggested range
            <span className="text-muted/50">{mealCount > 0 ? "" : " (preview)"}</span>
            : {gentleTargetsDisplay.calories} kcal · {gentleTargetsDisplay.protein} g protein
          </p>
        </Card>

        <div className="mt-4 h-px w-full bg-ink/5" />
        <div className="mt-4 space-y-4">
          <input
            ref={foodInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handleFoodFileSelected}
          />
          <button
            type="button"
            data-tour="food-action"
            className="block w-full rounded-xl bg-primary px-5 py-4 text-center text-base font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] ring-1 ring-white/40 transition hover:bg-primary/90 active:scale-[0.98]"
            onClick={handleFoodPhotoClick}
          >
            Take Food Photo
          </button>
          <div className="mt-1 flex w-[92%] mx-auto">
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-2 rounded-l-xl rounded-r-none bg-primary px-3 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(15,23,42,0.14)] ring-1 ring-white/40 transition-all duration-150 hover:bg-primary/90 active:translate-y-[1px] active:shadow-[0_3px_10px_rgba(15,23,42,0.18)]"
              onClick={meals.openManualMealEntry}
            >
              <span>+</span>
              <span>Manual</span>
            </button>
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-2 rounded-r-xl rounded-l-none border-l border-white/30 bg-primary px-3 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(15,23,42,0.14)] ring-1 ring-white/40 transition-all duration-150 hover:bg-primary/90 active:translate-y-[1px] active:shadow-[0_3px_10px_rgba(15,23,42,0.18)]"
              onClick={() => setBarcodeOpen(true)}
            >
              <span>▦</span>
              <span>Barcode</span>
            </button>
          </div>
          <div className="mx-auto flex w-[84%] text-xs" data-tour="workout-markers">
            <button
              type="button"
              className="flex flex-1 items-center justify-center rounded-l-xl rounded-r-none border border-ink/15 bg-gradient-to-r from-white via-ink/5 to-white px-3 py-1.5 text-center font-normal text-ink/60 shadow-[0_8px_18px_rgba(15,23,42,0.12)] ring-1 ring-white/70 transition-all duration-150 hover:from-white hover:via-ink/10 hover:to-white active:translate-y-[1px] active:shadow-[0_3px_10px_rgba(15,23,42,0.16)]"
              onClick={() => workout.setShowStartWorkoutModal(true)}
            >
              Start Workout
            </button>
            <button
              type="button"
              className="flex flex-1 items-center justify-center rounded-r-xl rounded-l-none border border-ink/15 border-l-0 bg-gradient-to-r from-white via-ink/5 to-white px-3 py-1.5 text-center font-normal text-ink/60 shadow-[0_8px_18px_rgba(15,23,42,0.12)] ring-1 ring-white/70 transition-all duration-150 hover:from-white hover:via-ink/10 hover:to-white active:translate-y-[1px] active:shadow-[0_3px_10px_rgba(15,23,42,0.16)]"
              onClick={() => workout.setShowEndWorkoutModal(true)}
            >
              End Workout
            </button>
          </div>
          {workout.activeWorkout && (
            <p className="text-center text-[11px] text-muted/60">Workout in progress</p>
          )}
        </div>

        <Card className="mt-7">
          <div className="flex items-start justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Today</p>
            <div className="flex items-center gap-2">
              {editRecents && (
                <span className="inline-flex items-center rounded-full bg-yellow-200 px-2 py-0.5 text-[10px] font-semibold text-amber-900 shadow-[0_6px_14px_rgba(15,23,42,0.08)] ring-1 ring-yellow-100/60">
                  Editing
                </span>
              )}
              <button
                type="button"
                className="text-[11px] font-semibold text-ink/70 underline"
                onClick={() => setEditRecents((prev) => !prev)}
              >
                {editRecents ? "Done" : "Edit"}
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 text-[10px] font-semibold uppercase tracking-wide text-muted/60">
            <span className="col-span-2">Food</span>
            <span className="col-span-1 text-right">Workout</span>
          </div>
          <div className="mt-3 space-y-4 text-sm text-ink/80">
            {groupedRecent.slice(0, 3).map((group) => (
              <div key={group.label}>
                {group.label !== "Today" && (
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                    {group.label}
                  </p>
                )}
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-2">
                    {group.meals.map((meal) => (
                      <div
                        key={`${meal.id}-${meal.calories}-${meal.protein}`}
                        onClick={() => {
                          if (editRecents) meals.openMealEditor(meal);
                        }}
                        className={`inline-flex w-full items-center justify-between rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-ink/80 ${editRecents ? "cursor-pointer animate-wiggle" : ""}`}
                      >
                        <span>
                          {meal.status === "processing" ? (
                            "Analyzing food…"
                          ) : (
                            <>
                              {(() => {
                                const displayName =
                                  meal.analysisJson?.name ??
                                  meal.analysisJson?.detected_items?.[0]?.name ??
                                  "Meal";
                                return formatTitle(displayName);
                              })()}{" "}
                              ·{" "}
                              {meal.calories
                                ? `${meal.calories} kcal`
                                : formatClean(
                                    meal.analysisJson.estimated_ranges.calories_min,
                                    meal.analysisJson.estimated_ranges.calories_max,
                                    "kcal"
                                  )}{" "}
                              ·{" "}
                              {meal.protein
                                ? `${meal.protein} g`
                                : formatClean(
                                    meal.analysisJson.estimated_ranges.protein_g_min,
                                    meal.analysisJson.estimated_ranges.protein_g_max,
                                    "g"
                                  )}
                            </>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="col-span-1 space-y-2 border-l border-ink/5 pl-2">
                    {group.workouts.map((w) => (
                      <div
                        key={w.id}
                        onClick={() => {
                          if (editRecents) workout.openWorkoutEditor(w);
                        }}
                        className={`flex w-full flex-col items-center justify-center rounded-full border border-ink/10 bg-ink/5 px-3 py-0.5 text-[11px] text-ink/70 leading-tight ${editRecents ? "cursor-pointer animate-wiggle-neutral" : ""}`}
                      >
                        <span className="font-semibold text-ink/70">
                          {formatWorkoutDurationLines(w).title}
                        </span>
                        <span className="-mt-0.5">{formatWorkoutDurationLines(w).detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {recentItems.length === 0 ? (
              mealCount === 0 && workout.workouts.length === 0 ? (
                <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-ink/80">
                  Example: Chicken bowl · 600 kcal · 40 g
                </div>
              ) : (
                <p className="text-muted/70">No food or workouts yet.</p>
              )
            ) : null}
          </div>
        </Card>
      </div>

      {meals.editingMeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            {pendingDelete?.type === "meal" ? (
              <>
                <h3 className="text-base font-semibold text-ink">Delete meal</h3>
                <p className="mt-2 text-sm text-muted/70">
                  Are you sure you want to delete this meal?
                </p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                    onClick={() => setPendingDelete(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90"
                    onClick={handleConfirmDelete}
                  >
                    {deletingItem ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-ink">
                  {meals.editingMeal.id ? "Edit Meal" : "Add Food"}
                </h2>

                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Name</p>
                    <input
                      className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      value={meals.editForm.name}
                      onChange={(e) => meals.setEditForm({ ...meals.editForm, name: e.target.value })}
                      placeholder="Food name"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Calories</p>
                    <input
                      className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      value={meals.editForm.calories}
                      onChange={(e) => meals.setEditForm({ ...meals.editForm, calories: e.target.value })}
                      placeholder="kcal"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Protein</p>
                    <input
                      className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      value={meals.editForm.protein}
                      onChange={(e) => meals.setEditForm({ ...meals.editForm, protein: e.target.value })}
                      placeholder="g"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Carbs</p>
                    <input
                      className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      value={meals.editForm.carbs}
                      onChange={(e) => meals.setEditForm({ ...meals.editForm, carbs: e.target.value })}
                      placeholder="g"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Fat</p>
                    <input
                      className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      value={meals.editForm.fat}
                      onChange={(e) => meals.setEditForm({ ...meals.editForm, fat: e.target.value })}
                      placeholder="g"
                      inputMode="numeric"
                    />
                  </div>
                </div>

                <div
                  className={`mt-5 flex items-center ${
                    meals.editingMeal.id ? "justify-between" : "justify-end"
                  }`}
                >
                  {meals.editingMeal.id ? (
                    <button
                      type="button"
                      className="text-sm text-red-600"
                      onClick={() => setPendingDelete({ type: "meal", id: meals.editingMeal!.id })}
                    >
                      Delete
                    </button>
                  ) : null}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                      onClick={() => {
                        meals.setEditingMeal(null);
                        setEditRecents(false);
                      }}
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      className={`rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 ${
                        meals.updatingMeal ? "opacity-70" : ""
                      }`}
                      onClick={meals.handleUpdateMeal}
                      disabled={meals.updatingMeal}
                    >
                      {meals.updatingMeal
                        ? meals.editingMeal.id
                          ? "Updating..."
                          : "Adding..."
                        : meals.editingMeal.id
                          ? "Update"
                          : "Add"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {workout.editingWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            {pendingDelete?.type === "workout" ? (
              <>
                <h2 className="text-base font-semibold text-ink">Delete workout</h2>
                <p className="mt-2 text-sm text-muted/70">
                  Are you sure you want to delete this workout?
                </p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                    onClick={() => setPendingDelete(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90"
                    onClick={handleConfirmDelete}
                  >
                    {deletingItem ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-ink">Edit workout</h2>
                <p className="mt-2 text-sm text-muted/70">Update your workout details.</p>

                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                      Duration
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        className="w-16 rounded-lg border border-ink/10 bg-white px-3 py-2 text-xs text-ink/80"
                        value={workout.workoutEditHours}
                        onChange={(e) => workout.setWorkoutEditHours(e.target.value)}
                        placeholder="0"
                      />
                      <span className="text-xs text-muted/70">hrs</span>
                      <input
                        className="w-16 rounded-lg border border-ink/10 bg-white px-3 py-2 text-xs text-ink/80"
                        value={workout.workoutEditMinutes}
                        onChange={(e) => workout.setWorkoutEditMinutes(e.target.value)}
                        placeholder="0"
                      />
                      <span className="text-xs text-muted/70">mins</span>
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                      Workout type
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {WORKOUT_TYPE_OPTIONS.map((type) => (
                        <button
                          key={type}
                          type="button"
                          className={`rounded-full border px-3 py-1 text-xs transition ${
                            workout.workoutEditTypes.includes(type)
                              ? "border-primary/30 bg-primary/10 text-ink"
                              : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"
                          }`}
                          onClick={() =>
                            workout.setWorkoutEditTypes((prev) =>
                              prev.includes(type)
                                ? prev.filter((item) => item !== type)
                                : [...prev, type]
                            )
                          }
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                      Intensity
                    </p>
                    <div className="mt-2 flex gap-2">
                      {([
                        { value: "low", label: "Low" },
                        { value: "medium", label: "Medium" },
                        { value: "high", label: "High" }
                      ] as const).map((level) => (
                        <button
                          key={level.value}
                          type="button"
                          className={`rounded-full border px-3 py-1 text-xs transition ${
                            workout.workoutEditIntensity === level.value
                              ? "border-primary/30 bg-primary/10 text-ink"
                              : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"
                          }`}
                          onClick={() =>
                            workout.setWorkoutEditIntensity(
                              workout.workoutEditIntensity === level.value ? "" : level.value
                            )
                          }
                        >
                          {level.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between">
                  <button
                    type="button"
                    className="text-sm text-red-600"
                    onClick={() => setPendingDelete({ type: "workout", id: workout.editingWorkout!.id })}
                  >
                    Delete
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                      onClick={() => {
                        workout.setEditingWorkout(null);
                        setEditRecents(false);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={`rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 ${
                        workout.updatingWorkout ? "opacity-70" : ""
                      }`}
                      onClick={workout.handleUpdateWorkout}
                      disabled={workout.updatingWorkout}
                    >
                      {workout.updatingWorkout ? "Updating..." : "Update"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Barcode looking up */}
      {barcodeLookingUp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 pointer-events-none">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-2xl">
            <svg className="h-8 w-8 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
        </div>
      )}

      {/* Barcode product confirmation */}
      {barcodeProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <p className="text-sm font-semibold text-ink">{barcodeProduct.name}</p>
            {barcodeProduct.brand && (
              <p className="text-xs text-muted/60">{barcodeProduct.brand}</p>
            )}
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Cal", value: barcodeProduct.calories },
                { label: "Protein", value: `${barcodeProduct.protein}g` },
                { label: "Carbs", value: `${barcodeProduct.carbs}g` },
                { label: "Fat", value: `${barcodeProduct.fat}g` },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-ink/5 px-2 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted/60">{label}</p>
                  <p className="mt-0.5 text-sm font-semibold text-ink">{value}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted/50">
              Per {barcodeProduct.valuePer === "100g" ? "100g" : "serving"}
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => setBarcodeProduct(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90"
                onClick={handleConfirmBarcodeProduct}
              >
                Add to day
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode not found */}
      {barcodeNotFound && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <p className="text-sm font-semibold text-ink">Product not found</p>
            <p className="mt-1 text-xs text-muted/70">This barcode isn&apos;t in our database. Try adding the meal manually.</p>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => setBarcodeNotFound(false)}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90"
                onClick={() => { setBarcodeNotFound(false); meals.openManualMealEntry(); }}
              >
                Add Manually
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode success */}
      {barcodeSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 pointer-events-none">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-primary shadow-2xl animate-circleImpact">
            <svg
              className="h-14 w-14 text-white animate-checkmark"
              viewBox="0 0 52 52"
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
            >
              <path d="M14 27 L22 35 L38 18" className="checkmark-path" />
            </svg>
          </div>
        </div>
      )}

      <BarcodeScannerOverlay
        open={barcodeOpen}
        onClose={() => setBarcodeOpen(false)}
        onDetected={handleBarcodeDetected}
      />
      <BottomNav current="home" />
    </div>
  );
}
