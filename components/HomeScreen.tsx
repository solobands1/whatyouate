"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Joyride, { CallBackProps, STATUS } from "react-joyride";
import { useRouter } from "next/navigation";
import type { MealLog, UserProfile, WorkoutSession } from "../lib/types";
import { formatApprox, formatDateShort, todayKey } from "../lib/utils";
import BottomNav from "./BottomNav";
import Card from "./Card";
import { useAuth } from "./AuthProvider";
import {
  addWorkout,
  deleteMeal,
  deleteWorkout,
  getActiveWorkout,
  getProfile,
  listMeals,
  listWorkouts,
  updateWorkout
} from "../lib/supabaseDb";
import { computeHomeMarkers, computeRecent } from "../lib/digestEngine";

export default function HomeScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | undefined>();
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [runTour, setRunTour] = useState(false);
  const [showTourGate, setShowTourGate] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showStartWorkoutModal, setShowStartWorkoutModal] = useState(false);
  const [showEndWorkoutModal, setShowEndWorkoutModal] = useState(false);
  const [activeWorkout, setActiveWorkout] = useState<WorkoutSession | null>(null);
  const [selectedWorkoutTypes, setSelectedWorkoutTypes] = useState<string[]>([]);
  const [selectedIntensity, setSelectedIntensity] = useState<"low" | "medium" | "high" | "">(
    ""
  );
  const mountedRef = useRef(true);
  const recentSentinelRef = useRef<HTMLDivElement | null>(null);
  const [visibleRecentCount, setVisibleRecentCount] = useState(6);
  const [editRecents, setEditRecents] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    type: "meal" | "workout";
    id: string;
  } | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);

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

  const loadData = async () => {
    if (!user) return;
    setLoadingData(true);
    setLoadError(null);
    try {
      const [profileData, mealsData, workoutsData, activeWorkoutData] = await Promise.all([
        getProfile(user.id),
        listMeals(user.id, 50),
        listWorkouts(user.id, 50),
        getActiveWorkout(user.id)
      ]);
      if (!mountedRef.current) return;
      setProfile(profileData ?? undefined);
      setMeals(mealsData);
      setWorkouts(workoutsData);
      setActiveWorkout(activeWorkoutData);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      if (!mountedRef.current) return;
      setLoadingData(false);
    }
  };

  const refreshActiveWorkout = async () => {
    if (!user) return;
    try {
      const current = await getActiveWorkout(user.id);
      if (!mountedRef.current) return;
      setActiveWorkout(current);
    } catch {
      // Silent: active workout is optional.
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeletingItem(true);
    try {
      if (pendingDelete.type === "meal") {
        await deleteMeal(pendingDelete.id);
      } else {
        await deleteWorkout(pendingDelete.id);
      }
      await loadData();
      window.dispatchEvent(new Event("meals-updated"));
    } catch {
      // Silent for now.
    } finally {
      setDeletingItem(false);
      setPendingDelete(null);
    }
  };

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  useEffect(() => {
    if (!showEndWorkoutModal) return;
    refreshActiveWorkout();
  }, [showEndWorkoutModal]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("profile-updated", handler as EventListener);
    return () => window.removeEventListener("profile-updated", handler as EventListener);
  }, [user]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("meals-updated", handler as EventListener);
    return () => window.removeEventListener("meals-updated", handler as EventListener);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const key = `wya_walkthrough_${user.id}`;
    const seen = localStorage.getItem(key);
    const activeKey = `wya_walkthrough_active_${user.id}`;
    const stageKey = `wya_walkthrough_stage_${user.id}`;
    const active = localStorage.getItem(activeKey) === "true";
    const stage = localStorage.getItem(stageKey) ?? "home";
    if (!seen && active && stage === "home") {
      setRunTour(true);
      setShowTourGate(false);
      return;
    }
    if (!seen && !active) {
      setShowTourGate(true);
    }
  }, [user]);

  // Keep walkthrough navigation to Next/Back/Skip only.

  const homeMarkers = useMemo(
    () => computeHomeMarkers(meals, workouts, profile),
    [meals, workouts, profile]
  );
  const recentItems = useMemo(() => computeRecent(meals, workouts), [meals, workouts]);

  const formatTitle = (value: string) =>
    value
      .split(" ")
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
      .join(" ");
  const formatClean = (min: number, max: number, unit = "") =>
    formatApprox(min, max, unit).replace(/^~/, "");
  const formatWorkoutDurationLines = (workout: WorkoutSession) => {
    const endTs = workout.endTs ?? Date.now();
    const rawMinutes = (endTs - workout.startTs) / 60000;
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

  const visibleRecent = useMemo(
    () => recentFiltered.slice(0, visibleRecentCount),
    [recentFiltered, visibleRecentCount]
  );

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
  const workoutTypeOptions = [
    "Walk",
    "Run",
    "Cycle",
    "Cardio",
    "Weights",
    "Calisthenics",
    "HIIT",
    "Yoga",
    "Pilates",
    "Swim",
    "Sport",
    "Stretching",
    "Other"
  ];

  const toggleWorkoutType = (type: string) => {
    setSelectedWorkoutTypes((prev) =>
      prev.includes(type) ? prev.filter((item) => item !== type) : [...prev, type]
    );
  };

  const handleStartWorkout = async () => {
    if (!user) return;
    if (activeWorkout) {
      setShowStartWorkoutModal(true);
      return;
    }
    try {
      const now = Date.now();
      const session = await addWorkout(user.id, now);
      setActiveWorkout(session);
      loadData();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to start workout");
    } finally {
      setShowStartWorkoutModal(false);
    }
  };

  const handleEndWorkout = async () => {
    if (!user) return;
    let workoutToEnd = activeWorkout;
    if (!workoutToEnd) {
      try {
        workoutToEnd = await getActiveWorkout(user.id);
        if (!mountedRef.current) return;
        setActiveWorkout(workoutToEnd);
      } catch {
        workoutToEnd = null;
      }
      if (!workoutToEnd) return;
    }
    try {
      const now = Date.now();
      const rawMinutes = (now - workoutToEnd.startTs) / 60000;
      const durationMin = rawMinutes < 1 ? 0 : Math.ceil(rawMinutes);
      await updateWorkout(
        workoutToEnd.id,
        now,
        durationMin,
        selectedWorkoutTypes,
        selectedIntensity || undefined
      );
      setActiveWorkout(null);
      setSelectedWorkoutTypes([]);
      setSelectedIntensity("");
      loadData();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to end workout");
    } finally {
      setShowEndWorkoutModal(false);
    }
  };

  const steps = [
    {
      target: '[data-tour="food-action"]',
      content: "Take photos. That’s it.",
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
      placement: "top",
      disableBeacon: true
    },
    {
      target: "body",
      content: "Everything is approximate to keep things light.",
      disableBeacon: true
    }
  ];

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
  return (
    <div className="min-h-screen bg-surface">
      <Joyride
        steps={steps}
        run={runTour}
        continuous
        showSkipButton
        hideCloseButton
        disableBeacon
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
      {showTourGate && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="flex max-w-xs flex-col items-center gap-4 text-center">
            <div className="w-full px-5 py-1 text-center">
              <p className="text-[26px] font-semibold text-ink/80">
                Hey {profile?.firstName || "there"}
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
      {showStartWorkoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink">Start workout</h2>
            <p className="mt-2 text-sm text-muted/70">
              {activeWorkout
                ? "A workout is already in progress."
                : "Confirm you want to start your workout now."}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => setShowStartWorkoutModal(false)}
              >
                Close
              </button>
              {!activeWorkout && (
                <button
                  type="button"
                  className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90"
                  onClick={handleStartWorkout}
                >
                  Start workout
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {showEndWorkoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink">End workout</h2>
            <p className="mt-2 text-sm text-muted/70">
              {activeWorkout ? "Confirm your workout details." : "No active workout in progress."}
            </p>
            {activeWorkout && (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                    Workout type
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {workoutTypeOptions.map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          selectedWorkoutTypes.includes(type)
                            ? "border-primary/30 bg-primary/10 text-ink"
                            : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"
                        }`}
                        onClick={() => toggleWorkoutType(type)}
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
                          selectedIntensity === level.value
                            ? "border-primary/30 bg-primary/10 text-ink"
                            : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"
                        }`}
                        onClick={() => setSelectedIntensity(level.value)}
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
                onClick={() => setShowEndWorkoutModal(false)}
              >
                Close
              </button>
              {activeWorkout && (
                <button
                  type="button"
                  className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90"
                  onClick={handleEndWorkout}
                >
                  End workout
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {pendingDelete && (
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
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 pt-6">
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
              Beta
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
          <Link
            href="/capture?type=food"
            data-tour="food-action"
            className="block w-full rounded-xl bg-primary px-5 py-4 text-center text-base font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] ring-1 ring-white/40 transition hover:bg-primary/90 active:scale-[0.98]"
          >
            Take Food Photo
          </Link>
          <div className="grid grid-cols-2 gap-3 text-xs" data-tour="workout-markers">
            <button
              type="button"
              className="block w-full rounded-xl border border-ink/5 bg-ink/5 px-3 py-1.5 text-center font-normal text-ink/60 transition hover:bg-ink/10 active:scale-[0.98]"
              onClick={() => setShowStartWorkoutModal(true)}
            >
              Start Workout
            </button>
            <button
              type="button"
              className="block w-full rounded-xl border border-ink/5 bg-ink/5 px-3 py-1.5 text-center font-normal text-ink/60 transition hover:bg-ink/10 active:scale-[0.98]"
              onClick={() => setShowEndWorkoutModal(true)}
            >
              End Workout
            </button>
          </div>
          {activeWorkout && (
            <p className="text-center text-[11px] text-muted/60">Workout in progress.</p>
          )}
        </div>

        <Card className="mt-7">
          <div className="flex items-start justify-between">
            <div />
            <button
              type="button"
              className="text-[11px] font-semibold text-ink/70 underline"
              onClick={() => setEditRecents((prev) => !prev)}
            >
              {editRecents ? "Done" : "Edit"}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 text-[10px] font-semibold uppercase tracking-wide text-muted/60">
            <span className="col-span-2">Food</span>
            <span className="col-span-1 text-right">Workout</span>
          </div>
          <div className="mt-3 space-y-4 text-sm text-ink/80">
            {groupedRecent.slice(0, 3).map((group) => (
              <div key={group.label}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                  {group.label}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-2">
                    {group.meals.map((meal) => (
                      <div
                        key={meal.id}
                        className="inline-flex w-full items-center justify-between rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-ink/80"
                      >
                        <span>
                          {formatTitle(meal.analysisJson.detected_items?.[0]?.name ?? "Meal")} ·{" "}
                          {formatClean(
                            meal.analysisJson.estimated_ranges.calories_min,
                            meal.analysisJson.estimated_ranges.calories_max,
                            "kcal"
                          )}{" "}
                          ·{" "}
                          {formatClean(
                            meal.analysisJson.estimated_ranges.protein_g_min,
                            meal.analysisJson.estimated_ranges.protein_g_max,
                            "g"
                          )}
                        </span>
                        {editRecents && (
                          <button
                            type="button"
                            className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-primary/20 text-[10px] text-ink/60"
                            onClick={() => setPendingDelete({ type: "meal", id: meal.id })}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="col-span-1 space-y-2 border-l border-ink/5 pl-2">
                    {group.workouts.map((workout) => (
                      <div
                        key={workout.id}
                        className="flex w-full flex-col items-center justify-center rounded-full border border-ink/10 bg-ink/5 px-3 py-0.5 text-[11px] text-ink/70 leading-tight"
                      >
                        <span className="font-semibold text-ink/70">
                          {formatWorkoutDurationLines(workout).title}
                        </span>
                        <span className="-mt-0.5">{formatWorkoutDurationLines(workout).detail}</span>
                        {editRecents && (
                          <button
                            type="button"
                            className="mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-ink/10 text-[10px] text-ink/60"
                            onClick={() => setPendingDelete({ type: "workout", id: workout.id })}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {recentItems.length === 0 ? (
              mealCount === 0 && workouts.length === 0 ? (
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

      <BottomNav current="home" />
    </div>
  );
}
