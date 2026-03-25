"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Joyride, { CallBackProps, STATUS, type Step } from "react-joyride";
import { useRouter } from "next/navigation";
import type { MealLog, UserProfile, WorkoutSession } from "../lib/types";
import { dayKeyFromTs, formatApprox, formatDateShort, todayKey } from "../lib/utils";
import BottomNav from "./BottomNav";
import Card from "./Card";
import { useAuth } from "./AuthProvider";
import { addNudge, getProfile, listMeals, listNudges, listWorkouts, LOCAL_MODE, pruneNudges } from "../lib/supabaseDb";
import { computeNudges, computeSummaryMarkers, type ComputedNudge } from "../lib/digestEngine";
import { MEALS_UPDATED_EVENT, PROFILE_UPDATED_EVENT, WORKOUTS_UPDATED_EVENT } from "../lib/dataEvents";
import { supabase } from "../lib/supabaseClient";

export default function SummaryScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | undefined>();
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [nudges, setNudges] = useState<Array<{ id: string; message: string; created_at: string }>>([]);
  const nudgesLoadedRef = useRef(false);
  const savedThisSessionRef = useRef<Set<string>>(new Set());
  const [loadingData, setLoadingData] = useState(true);
  const mountedRef = useRef(true);
  const [runSummaryTour, setRunSummaryTour] = useState(false);
  const [visibleNudgeGroupCount, setVisibleNudgeGroupCount] = useState(3);
  const [aiMessages, setAiMessages] = useState<Record<string, string>>({});
  // Capture unseen state before the mount effect clears it, so the bell stays on the card while reading
  const [nudgeCardIsNew] = useState(() => {
    try {
      const nudgeTs = parseInt(localStorage.getItem("wya_nudge_ts") ?? "0");
      const seenTs = parseInt(localStorage.getItem("wya_nudge_seen_ts") ?? "0");
      return nudgeTs > seenTs;
    } catch { return false; }
  });

  useEffect(() => {
    mountedRef.current = true;
    localStorage.setItem("wya_nudge_seen_ts", Date.now().toString());
    window.dispatchEvent(new Event("wya_nudge_update"));
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  const loadData = useCallback(() => {
    if (!user) return;
    setLoadingData(true);
    if (LOCAL_MODE) {
      Promise.all([getProfile(user.id), listMeals(user.id, 1000), listWorkouts(user.id, 200)])
        .then((result) => {
          const [profileData, mealsData, workoutsData] = result;
          if (!mountedRef.current) return;
          setProfile(profileData ?? undefined);
          setMeals(mealsData);
          setWorkouts(workoutsData);
        })
        .catch(() => {
          if (!mountedRef.current) return;
        })
        .finally(() => {
          if (!mountedRef.current) return;
          setLoadingData(false);
        });
    } else {
      supabase.auth
        .getSession()
        .then(({ data: sessionData }) => {
          if (!sessionData.session) {
            return supabase.auth.refreshSession().then((refreshed) => {
              if (!refreshed.data.session) {
                setLoadingData(false);
                return null;
              }
              return true;
            });
          }
          return true;
        })
        .then((ok) => {
          if (!ok) return null;
          return Promise.all([getProfile(user.id), listMeals(user.id, 1000), listWorkouts(user.id, 200)]);
        })
        .then((result) => {
          if (!result) return;
          const [profileData, mealsData, workoutsData] = result;
          if (!mountedRef.current) return;
          setProfile(profileData ?? undefined);
          setMeals(mealsData);
          setWorkouts(workoutsData);
        })
        .catch(() => {
          if (!mountedRef.current) return;
        })
        .finally(() => {
          if (!mountedRef.current) return;
          setLoadingData(false);
        });
    }

    listNudges(user.id, 100)
      .then((nudgesData) => {
        if (!mountedRef.current) return;
        setNudges(nudgesData as any);
        nudgesLoadedRef.current = true;
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setNudges([]);
        nudgesLoadedRef.current = true;
      });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user, loadData]);

  useEffect(() => {
    if (!user) return;
    const active = localStorage.getItem(`wya_walkthrough_active_${user.id}`) === "true";
    const stage = localStorage.getItem(`wya_walkthrough_stage_${user.id}`);
    if (active && stage === "summary") {
      const timer = window.setTimeout(() => setRunSummaryTour(true), 150);
      return () => window.clearTimeout(timer);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const handler = () => loadData();
    window.addEventListener(MEALS_UPDATED_EVENT, handler as EventListener);
    window.addEventListener(WORKOUTS_UPDATED_EVENT, handler as EventListener);
    window.addEventListener(PROFILE_UPDATED_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(MEALS_UPDATED_EVENT, handler as EventListener);
      window.removeEventListener(WORKOUTS_UPDATED_EVENT, handler as EventListener);
      window.removeEventListener(PROFILE_UPDATED_EVENT, handler as EventListener);
    };
  }, [user, loadData]);

  useEffect(() => {
    setHydrated(true);
  }, []);


  const summaryMarkers = useMemo(
    () => computeSummaryMarkers(meals, workouts, profile),
    [meals, workouts, profile]
  );
  const formatClean = (min: number, max: number, unit = "") =>
    formatApprox(min, max, unit).replace(/^~/, "");
  const visibleNotes = useMemo(
    () => computeNudges(meals, workouts, profile),
    [meals, workouts, profile]
  );
  const dayCount = summaryMarkers.dayCount;
  const mealCount = summaryMarkers.mealCount;
  const gentleTargetsDisplay = summaryMarkers.gentleTargets ?? { calories: 2300, protein: 125 };
  const workoutSummary = summaryMarkers.workoutSummary;
  const avgWeekCalories = summaryMarkers.avgWeekCalories;
  const avgWeekProtein = summaryMarkers.avgWeekProtein;
  const nutrientTrends = summaryMarkers.nutrientTrends;
  const nutrientNotes = summaryMarkers.nutrientNotes;
  const suggestions = summaryMarkers.suggestions;

  const last7Days = useMemo(() => {
    const loggedKeys = new Set(meals.map((m) => dayKeyFromTs(m.ts)));
    const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = dayKeyFromTs(d.getTime());
      return { key, label: dayLabels[d.getDay()], logged: loggedKeys.has(key), isToday: i === 6 };
    });
  }, [meals]);

  const weekHeadline = useMemo(() => {
    if (mealCount === 0) return null;
    const loggedThisWeek = last7Days.filter((d) => d.logged).length;
    const calTarget = summaryMarkers.gentleTargets?.calories;
    const proTarget = summaryMarkers.gentleTargets?.protein;
    const calOk = !calTarget || !avgWeekCalories || (avgWeekCalories >= calTarget * 0.9 && avgWeekCalories <= calTarget * 1.1);
    const proOk = !proTarget || !avgWeekProtein || avgWeekProtein >= proTarget * 0.85;
    if (loggedThisWeek >= 6 && calOk && proOk) return "Strong week across the board!";
    if (loggedThisWeek >= 5 && (calOk || proOk)) return "Solid week overall!";
    if (loggedThisWeek >= 5) return "Good effort this week!";
    if (loggedThisWeek >= 3) return "Building habits!";
    return "Getting started";
  }, [last7Days, mealCount, avgWeekCalories, avgWeekProtein, summaryMarkers.gentleTargets]);

  const weekObservations = useMemo(() => {
    const lines: string[] = [];
    const loggedThisWeek = last7Days.filter((d) => d.logged).length;
    if (loggedThisWeek > 0) {
      lines.push(loggedThisWeek === 7 ? "Logged every day this week!" : `${loggedThisWeek} of 7 days logged`);
    }
    if (mealCount >= 5 && avgWeekCalories > 0) {
      const calTarget = summaryMarkers.gentleTargets?.calories;
      if (calTarget) {
        const ratio = avgWeekCalories / calTarget;
        const status = ratio >= 0.9 && ratio <= 1.1 ? "on track" : ratio < 0.9 ? "a bit light" : "a bit high";
        lines.push(`Avg ${avgWeekCalories} kcal · ${status}`);
      } else {
        lines.push(`Avg ${avgWeekCalories} kcal`);
      }
      const proTarget = summaryMarkers.gentleTargets?.protein;
      if (avgWeekProtein > 0) {
        lines.push(proTarget ? `Avg ${avgWeekProtein}g protein · goal ${proTarget}g` : `Avg ${avgWeekProtein}g protein`);
      }
    }
    if (workoutSummary.count > 0) {
      const mins = workoutSummary.totalMinutes > 0 ? ` · ${workoutSummary.totalMinutes} min` : "";
      lines.push(`${workoutSummary.count} workout${workoutSummary.count !== 1 ? "s" : ""}${mins}${workoutSummary.count >= 3 ? "!" : ""}`);
    }
    return lines;
  }, [last7Days, mealCount, avgWeekCalories, avgWeekProtein, summaryMarkers.gentleTargets, workoutSummary]);

  const [nudgeViewCount, setNudgeViewCount] = useState(0);
  const [showTargetInfo, setShowTargetInfo] = useState(false);

  useEffect(() => {
    if (!user) return;
    const key = `wya_nudge_view_count_${user.id}`;
    const current = Number(localStorage.getItem(key) ?? 0) + 1;
    localStorage.setItem(key, String(current));
    setNudgeViewCount(current);
  }, [user]);

  const uniqueNudges = useMemo(() => {
    // Dedup by day+message so the same observation can appear on different days in history,
    // but duplicates within the same day are collapsed.
    const seenKeys = new Set<string>();
    const items: Array<{ id?: string; message: string; created_at?: string; isNew?: boolean }> = [];
    const todayDateKey = todayKey();
    nudges
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .forEach((nudge) => {
        // Skip DB nudges from today • visibleNotes (fresh compute) covers today's state
        const nudgeDayKey = todayKey(new Date(nudge.created_at));
        if (nudgeDayKey === todayDateKey) return;
        // Filter out retired nudge types that may still exist in DB history
        if (nudge.message.includes("you're just") && nudge.message.includes("away from your")) return;
        const key = `${nudgeDayKey}:${nudge.message}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        items.push({
          id: nudge.id,
          message: nudge.message,
          created_at: nudge.created_at,
          isNew:
            nudgeViewCount < 2 &&
            Date.now() - new Date(nudge.created_at).getTime() < 24 * 60 * 60 * 1000
        });
      });
    visibleNotes.forEach((note) => {
      if (seenKeys.has(note.message)) return;
      seenKeys.add(note.message);
      items.push({ message: note.message });
    });
    nutrientNotes.forEach((note) => {
      if (seenKeys.has(note)) return;
      seenKeys.add(note);
      items.push({ message: note });
    });
    return items;
  }, [nudges, visibleNotes, nutrientNotes, nudgeViewCount]);

  const groupedNudges = useMemo(() => {
    const groups: Array<{ label: string; items: typeof uniqueNudges }> = [];
    uniqueNudges.forEach((nudge) => {
      const ts = nudge.created_at ? new Date(nudge.created_at).getTime() : Date.now();
      const today = todayKey();
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterday = todayKey(yesterdayDate);
      const key = todayKey(new Date(ts));
      const label = key === today ? "Today" : key === yesterday ? "Yesterday" : formatDateShort(ts);
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.items.push(nudge);
      } else {
        groups.push({ label, items: [nudge] });
      }
    });
    return groups;
  }, [uniqueNudges]);

  const summaryTourSteps = [
    {
      target: '[data-tour="summary-today"]',
      content: "View your calories, protein, fats, and carbs throughout the day.",
      disableBeacon: true
    },
    {
      target: '[data-tour="nudges-card"]',
      content: "You get gentle nudges to help improve desired food, nutrient, and activity patterns.",
      disableBeacon: true
    },
    {
      target: '[data-tour="insights-button"]',
      content: "Tap ‘Why these?’ for deeper guidance on today’s nudges.",
      disableBeacon: true
    },
    {
      target: '[data-tour="dig-deeper"]',
      content: "Patterns shows longer-term nutrient patterns.",
      disableBeacon: true
    }
  ] as Step[];

  const handleSummaryTour = (data: CallBackProps) => {
    if (!user) return;
    if (data.status === STATUS.SKIPPED) {
      localStorage.setItem(`wya_walkthrough_${user.id}`, "true");
      localStorage.removeItem(`wya_walkthrough_active_${user.id}`);
      localStorage.removeItem(`wya_walkthrough_stage_${user.id}`);
      setRunSummaryTour(false);
      return;
    }
    if (data.type === "step:after" && data.index === summaryTourSteps.length - 1) {
      localStorage.setItem(`wya_walkthrough_active_${user.id}`, "true");
      localStorage.setItem(`wya_walkthrough_stage_${user.id}`, "insights");
      setRunSummaryTour(false);
      router.push("/summary/insights");
    }
  };

  const recentFoods = useMemo(() => {
    return meals
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .map((meal) => meal.analysisJson?.name ?? meal.analysisJson?.detected_items?.[0]?.name ?? "")
      .filter(Boolean)
      .slice(0, 8)
      .map((name) => name.toLowerCase());
  }, [meals]);

  const adaptiveInsight = useMemo(() => {
    const tips: string[] = [];
    const goal = profile?.goalDirection ?? "maintain";
    const proteinTarget = gentleTargetsDisplay.protein;
    const caloriesTarget = gentleTargetsDisplay.calories;
    const proteinLow = avgWeekProtein > 0 && avgWeekProtein < proteinTarget * 0.85;
    const caloriesLow = caloriesTarget > 0 && avgWeekCalories < caloriesTarget * 0.85;
    const caloriesHigh = caloriesTarget > 0 && avgWeekCalories > caloriesTarget * 1.1;

    const nudgeIsProtein = visibleNotes.some((n) =>
      n.type === "protein_low_critical" || n.type === "protein_low"
    );
    const nudgeIsCalorie = visibleNotes.some((n) =>
      n.type === "calorie_low" || n.type === "calorie_high" ||
      n.type === "workout_fuel_low" || n.type === "training_fuel_low"
    );

    if (nudgeIsProtein && !nudgeIsCalorie) {
      if (proteinLow && avgWeekProtein > 0)
        tips.push(`You've been averaging around ${avgWeekProtein}g of protein • your goal is closer to ${proteinTarget}g.`);
      else
        tips.push("Your protein intake has been fairly steady this week.");
      return tips.slice(0, 1);
    }
    if (nudgeIsCalorie && !nudgeIsProtein) {
      if (caloriesLow && avgWeekCalories > 0)
        tips.push(goal === "gain"
          ? `You've been averaging around ${avgWeekCalories} kcal • you're aiming for closer to ${caloriesTarget} kcal.`
          : `You've been eating around ${avgWeekCalories} kcal per day • a bit under your ${caloriesTarget} kcal range.`
        );
      else if (caloriesHigh && avgWeekCalories > 0)
        tips.push(`You've been averaging around ${avgWeekCalories} kcal • a bit over your ${caloriesTarget} kcal range.`);
      else
        tips.push("Your calorie intake has been fairly steady this week.");
      return tips.slice(0, 1);
    }

    if (goal === "lose") {
      if (caloriesHigh && avgWeekCalories > 0) tips.push(`Averaging around ${avgWeekCalories} kcal • a bit over your ${caloriesTarget} kcal goal.`);
      if (proteinLow && avgWeekProtein > 0) tips.push(`Protein is around ${avgWeekProtein}g • keeping it closer to ${proteinTarget}g helps preserve muscle while cutting.`);
    } else if (goal === "gain") {
      if (caloriesLow && avgWeekCalories > 0) tips.push(`Averaging around ${avgWeekCalories} kcal • a bit under your ${caloriesTarget} kcal goal.`);
      if (proteinLow && avgWeekProtein > 0) tips.push(`Protein is around ${avgWeekProtein}g • closer to ${proteinTarget}g supports muscle gain.`);
    } else {
      if (caloriesLow && avgWeekCalories > 0) tips.push(`Averaging around ${avgWeekCalories} kcal • a bit under your ${caloriesTarget} kcal range.`);
      else if (caloriesHigh && avgWeekCalories > 0) tips.push(`Averaging around ${avgWeekCalories} kcal • a bit over your ${caloriesTarget} kcal range.`);
      if (proteinLow && avgWeekProtein > 0) tips.push(`Protein is around ${avgWeekProtein}g • your goal is closer to ${proteinTarget}g.`);
    }

    if (tips.length === 0) {
      if (avgWeekCalories === 0 || avgWeekProtein === 0)
        tips.push("Log a few more meals to see your weekly pattern here.");
      else
        tips.push("Your intake has been pretty steady this week • keep it up.");
    }

    return tips.slice(0, 1);
  }, [profile, gentleTargetsDisplay, avgWeekProtein, avgWeekCalories, visibleNotes]);

  const isRestrictedSuggestion = useMemo(() => {
    const r = profile?.dietaryRestrictions ?? [];
    return (text: string) => {
      const lower = text.toLowerCase();
      if ((r.includes("Vegetarian") || r.includes("Vegan")) &&
        ["chicken", "tuna", "fish", "beef", "meat", "steak", "salmon", "turkey", "pork", "bacon"].some(w => lower.includes(w))) return true;
      if (r.includes("Vegan") &&
        ["yogurt", "milk", "cheese", "dairy", "egg", "butter", "cream", "whey"].some(w => lower.includes(w))) return true;
      if (r.includes("No dairy") &&
        ["yogurt", "milk", "cheese", "dairy", "butter", "cream", "whey"].some(w => lower.includes(w))) return true;
      if (r.includes("No nuts") &&
        ["nut", "almond", "cashew", "walnut", "peanut", "pecan", "pistachio"].some(w => lower.includes(w))) return true;
      if (r.includes("No shellfish") &&
        ["shrimp", "shellfish", "crab", "lobster", "clam", "oyster", "scallop"].some(w => lower.includes(w))) return true;
      if (r.includes("No pork") &&
        ["pork", "bacon", "ham", "prosciutto", "sausage"].some(w => lower.includes(w))) return true;
      return false;
    };
  }, [profile?.dietaryRestrictions]);

  const smartAddOns = useMemo(() => {
    const tips: string[] = [];
    const goal = profile?.goalDirection ?? "maintain";
    const caloriesTarget = gentleTargetsDisplay.calories;
    const caloriesHigh = caloriesTarget > 0 && avgWeekCalories > caloriesTarget * 1.1;
    const caloriesLow = caloriesTarget > 0 && avgWeekCalories < caloriesTarget * 0.85;
    const proteinLow = avgWeekProtein > 0 && avgWeekProtein < gentleTargetsDisplay.protein * 0.85;

    const nudgeIsProtein = visibleNotes.some((n) =>
      n.type === "protein_low_critical" || n.type === "protein_low"
    );
    const nudgeIsCalorie = visibleNotes.some((n) =>
      n.type === "calorie_low" || n.type === "calorie_high" ||
      n.type === "workout_fuel_low" || n.type === "training_fuel_low"
    );

    if (nudgeIsProtein && !nudgeIsCalorie) {
      if (proteinLow) tips.push(goal === "gain"
        ? "Try adding a solid protein source to each meal • it adds up faster than you'd think."
        : "Adding a small protein source to your next couple of meals should close the gap.");
      else tips.push("Keep pairing your meals with a protein source and you'll stay on track.");
      return tips.filter((tip) => !isRestrictedSuggestion(tip)).slice(0, 1);
    }
    if (nudgeIsCalorie && !nudgeIsProtein) {
      if (goal === "lose" && caloriesHigh) tips.push("Try slightly smaller portions or skip a side • small changes add up.");
      else if (goal === "gain" && caloriesLow) tips.push("Add a side or a slightly bigger portion • your body could use the extra fuel.");
      else if (caloriesHigh) tips.push("A slightly smaller portion here and there should keep things balanced.");
      else if (caloriesLow) tips.push("A small snack or extra side with one of your meals would help.");
      if (tips.length === 0) tips.push("Keep meals balanced and pair them with a protein source.");
      return tips.filter((tip) => !isRestrictedSuggestion(tip)).slice(0, 1);
    }

    if (goal === "lose") {
      if (caloriesHigh) tips.push("Try slightly smaller portions or skip one side • small changes add up.");
      if (proteinLow) tips.push("Pair your meals with a bit more protein • it helps with fullness too.");
    } else if (goal === "gain") {
      if (caloriesLow) tips.push("Add a side or a slightly larger portion • your body needs the fuel.");
      if (proteinLow) tips.push("Try adding a protein source to each meal • it adds up fast.");
    } else {
      if (caloriesHigh) tips.push("A slightly smaller portion here and there keeps things balanced.");
      if (caloriesLow) tips.push("A small snack or extra side with one of your meals would fill the gap.");
      if (proteinLow) tips.push("Pair your meals with a bit more protein • easy to slip in.");
    }

    if (tips.length === 0 && avgWeekCalories > 0) tips.push("Keep meals balanced and pair them with a solid protein source.");

    return tips.filter((tip) => !isRestrictedSuggestion(tip)).slice(0, 1);
  }, [profile, gentleTargetsDisplay, avgWeekCalories, avgWeekProtein, isRestrictedSuggestion, visibleNotes]);



  // Fetch AI-written nudge messages; cache per day per type so we only call once
  useEffect(() => {
    if (visibleNotes.length === 0 || !profile) return;
    const todayStr = todayKey();

    // Load any already-cached messages for today
    const cached: Record<string, string> = {};
    visibleNotes.forEach((note) => {
      const val = localStorage.getItem(`wya_ai_nudge_${todayStr}_${note.type}`);
      if (val) cached[note.type] = val;
    });
    if (Object.keys(cached).length > 0) setAiMessages((prev) => ({ ...prev, ...cached }));

    // Fetch missing ones in background
    const missing = visibleNotes.filter((note) => !cached[note.type]);
    if (missing.length === 0) return;

    missing.forEach(async (note) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch("/api/nudge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nudgeType: note.type,
            data: note.data,
            profile,
            recentFoods,
          }),
          signal: controller.signal,
        });
        if (!res.ok) return;
        const { message } = await res.json();
        if (!message?.trim()) return;
        localStorage.setItem(`wya_ai_nudge_${todayStr}_${note.type}`, message.trim());
        setAiMessages((prev) => ({ ...prev, [note.type]: message.trim() }));
      } catch {
        // Silently fall back to hardcoded message
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }, [visibleNotes, profile]);

  // Save nudges to DB once per day; uses AI message if ready, otherwise hardcoded fallback
  useEffect(() => {
    if (!user || !nudgesLoadedRef.current || visibleNotes.length === 0) return;
    const todayStr = todayKey();
    const existingToday = new Set(
      nudges.filter((n) => todayKey(new Date(n.created_at)) === todayStr).map((n) => n.message)
    );
    const toSave = visibleNotes.filter(
      (note) => !savedThisSessionRef.current.has(note.type)
    );
    if (toSave.length === 0) return;

    toSave.forEach((note) => {
      const message = aiMessages[note.type] ?? note.message;
      if (existingToday.has(message)) return;
      savedThisSessionRef.current.add(note.type);
      addNudge(user.id, "awareness", message).catch(() => {});
    });
    pruneNudges(user.id).catch(() => {});
  }, [user, visibleNotes, nudges, aiMessages]);

  const weeklyVariant = (variants: string[]): string => {
    const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
    return variants[week % variants.length];
  };

  const isVegan = profile?.dietaryRestrictions?.includes("Vegan") ?? false;
  const isVegetarian = isVegan || (profile?.dietaryRestrictions?.includes("Vegetarian") ?? false);
  const focusLongevity = (profile?.freeformFocus ?? "").toLowerCase().includes("longevity");

  const getNudgeWhy = (type: ComputedNudge["type"], goal: string): string => {
    switch (type) {
      case "protein_low_critical":
        if (isVegan) return weeklyVariant([
          "Plant-based protein needs a bit more planning to hit higher targets • combining sources matters more than each food individually.",
          "Getting enough protein on a vegan diet is doable but takes consistency • variety across legumes, tofu, tempeh, and seeds helps a lot.",
        ]);
        if (isVegetarian) return weeklyVariant([
          "Vegetarian protein sources are solid but often need a bit more volume to hit higher targets.",
          "Eggs, dairy, and legumes are your strongest protein levers • getting all three working consistently makes a big difference.",
        ]);
        if (goal === "gain") return weeklyVariant([
          "When protein is this low, your muscles can't fully recover and grow between sessions.",
          "Consistently short on protein means your training effort isn't fully converting to results.",
        ]);
        if (goal === "lose") return weeklyVariant([
          "Low protein in a deficit means more weight loss comes from muscle rather than fat.",
          "Protein preserves muscle and keeps hunger manageable • both matter a lot when cutting.",
        ]);
        return weeklyVariant([
          "Protein supports muscle maintenance, immune health, and steady energy throughout the day.",
          "Consistently low protein affects energy, mood, and how your body functions day to day.",
        ]);
      case "protein_low":
        if (isVegan) return weeklyVariant([
          "A small consistent protein gap on a plant-based diet is common • it usually comes down to volume and variety.",
          "Most vegan protein sources are lower per serving • stacking two or three sources at each meal closes the gap quickly.",
        ]);
        if (goal === "gain") return weeklyVariant([
          "A consistent protein shortfall limits recovery and slows progress more than most people realise.",
          "Even a small regular gap in protein compounds over time • your muscles need it to repair properly.",
        ]);
        if (goal === "lose") return weeklyVariant([
          "Keeping protein up while cutting helps preserve muscle and makes the deficit easier to sustain.",
          "Protein keeps you fuller and protects muscle • both matter a lot when you're trying to lose.",
        ]);
        return weeklyVariant([
          "Getting protein consistently right is one of the simplest ways to feel more energised through the week.",
          "Protein does a lot beyond muscle • energy, mood, and immune health all benefit from getting it right.",
        ]);
      case "calorie_low":
        if (goal === "gain") return weeklyVariant([
          "Your body needs a consistent surplus to build • running light on calories works directly against that.",
          "When intake stays below target, your body goes into maintenance mode and building slows or stalls.",
        ]);
        if (goal === "lose") return weeklyVariant([
          "Too far under your target for too long tends to backfire • metabolism adapts and energy crashes.",
          "A slightly higher intake often leads to better results than going too deep • your body responds better.",
        ]);
        return weeklyVariant([
          "Running consistently light affects energy, concentration, and how well you handle your week.",
          "Low intake has a bigger impact on mood and energy than most people expect.",
        ]);
      case "calorie_high":
        if (goal === "lose") return weeklyVariant([
          "Small consistent surpluses add up fast • even 150 kcal over target daily is over 1000 kcal across a week.",
          "The pattern across the week matters more than any single day • small adjustments make the difference.",
        ]);
        return weeklyVariant([
          "It's the consistent weekly pattern that shapes results • day to day variation is normal.",
          "Keeping an eye on the weekly trend is worth the habit • no single day matters that much.",
        ]);
      case "workout_fuel_low":
      case "training_fuel_low":
        return weeklyVariant([
          "Your body's energy demands go up more than most people account for on active days • under-fuelling slows recovery.",
          "Training on low fuel affects sleep, mood, and how you feel for days after • not just the session itself.",
        ]);
      case "workout_missing":
        return weeklyVariant([
          "Without logged sessions, your intake targets may be calibrated too low for what your body is actually doing.",
          "An active person who doesn't log workouts can end up with goals set for a sedentary lifestyle.",
        ]);
      case "micronutrient":
        if (focusLongevity) return weeklyVariant([
          "Micronutrients are especially relevant for long-term health outcomes • consistently low levels compound over years, not just days.",
          "For longevity goals, micronutrient adequacy matters as much as macros • the research on consistent variety is strong.",
        ]);
        return weeklyVariant([
          "Micronutrients quietly shape energy, mood, and recovery • easy to overlook but worth addressing.",
          "When a nutrient shows up low consistently, it's usually a variety gap • easy to fix with a few regular additions.",
        ]);
      case "fat_low":
        return weeklyVariant([
          "Dietary fat supports hormone production, brain health, and vitamin absorption • it's not just about calories.",
          "Healthy fats are essential for absorbing fat-soluble vitamins and keeping hormones balanced.",
        ]);
      case "on_track":
        return weeklyVariant([
          "Consistent logging is how patterns become clear. You're building real data here.",
          "Staying in range consistently is how real progress happens.",
          "Your numbers are looking balanced, and that's genuinely good work.",
          "This kind of consistency is what makes the nudges and patterns more accurate over time.",
        ]);
    }
  };

  const getNudgeBehavioralChips = (type: ComputedNudge["type"], goal: string): string[] => {
    switch (type) {
      case "protein_low_critical":
        return goal === "gain" ? ["+ protein at every meal", "+ protein snack"] : ["+ protein per meal", "+ protein snack"];
      case "protein_low":
        return ["+ protein at each meal", "+ protein snack"];
      case "calorie_low":
        return goal === "gain" ? ["+ larger portions", "+ side dish"] : ["+ small snack", "+ side dish"];
      case "calorie_high":
        return goal === "lose" ? ["smaller portions", "skip a side"] : ["watch portions"];
      case "workout_fuel_low":
      case "training_fuel_low":
        return ["+ pre-workout snack", "+ post-workout meal"];
      case "workout_missing":
      case "micronutrient":
        return [];
      case "fat_low":
        return ["+ healthy fats"];
      case "on_track":
        return [];
    }
  };

  const getNudgeAction = (type: ComputedNudge["type"], goal: string): string => {
    switch (type) {
      case "protein_low_critical":
        if (isVegan) return weeklyVariant([
          "Try stacking two plant-based protein sources at each meal • legumes + tofu, or edamame + tempeh.",
          "Adding a high-protein snack like edamame, roasted chickpeas, or a protein-fortified food between meals makes a real difference.",
        ]);
        if (isVegetarian) return weeklyVariant([
          "Focus on eggs, Greek yogurt, or cottage cheese at breakfast and lunch • those two meals are usually where vegetarian protein slips.",
          "Try adding a dairy or egg-based protein hit to at least two meals a day • it's the most reliable way to close the gap.",
        ]);
        if (goal === "gain") return weeklyVariant([
          "Add a protein source to every meal • breakfast and lunch are where most people fall short.",
          "Spreading protein across all three meals beats saving it for dinner • try adding it earlier in the day.",
        ]);
        return weeklyVariant([
          "Adding a protein-focused snack between two main meals is usually the change that sticks best.",
          "Focus on a protein hit at each meal rather than one big serving • more effective and keeps hunger down.",
        ]);
      case "protein_low":
        if (isVegan) return weeklyVariant([
          "A consistent plant-based protein add at each meal tends to compound quickly • tofu, tempeh, and lentils all work well.",
          "Try pairing a grain with a legume or soy source at your main meals • that combination reliably closes small gaps.",
        ]);
        return weeklyVariant([
          "Pairing each meal with a solid protein source is usually enough to close a gap like this.",
          "A small protein add at each meal tends to compound quickly • it doesn't need to be a big change.",
        ]);
      case "calorie_low":
        if (goal === "gain") return weeklyVariant([
          "Try bumping up two or three existing meals slightly rather than adding a whole new one.",
          "A bit more at each sitting tends to be easier to sustain than trying to squeeze in extra meals.",
        ]);
        return weeklyVariant([
          "A small balanced snack between two of your regular meals usually closes the gap without disrupting your routine.",
          "Adding something small and filling between meals tends to be the most sustainable fix.",
        ]);
      case "calorie_high":
        if (goal === "lose") return weeklyVariant([
          "Shaving slightly off portions across a couple of meals tends to be more sustainable than cutting foods out.",
          "Small consistent adjustments beat big restrictions • slightly less at two or three meals a day adds up.",
        ]);
        return weeklyVariant([
          "Keep an eye on portions over the next few days and see if things balance out naturally.",
          "Nothing urgent • just stay aware of portions and let the weekly pattern even out.",
        ]);
      case "workout_fuel_low":
      case "training_fuel_low":
        return weeklyVariant([
          "Try eating a bit more on the days you train • even a moderate add around your session makes a real difference.",
          "Adding a small calorie-dense snack around your workout tends to be the highest-return adjustment you can make.",
        ]);
      case "workout_missing":
        return weeklyVariant([
          "Log your next session right after it finishes • it takes 20 seconds and immediately improves your targets.",
          "Try logging sessions as you go • it shifts your intake targets to match what your body is actually doing.",
        ]);
      case "micronutrient":
        return weeklyVariant([
          "Try adding a food rich in this nutrient a few times this week • small consistent additions tend to stick best.",
          "Work it in a couple of times this week • gradual variety builds more naturally than big diet changes.",
        ]);
      case "fat_low":
        return weeklyVariant([
          "Try adding a source of healthy fat to a couple of meals • it doesn't need to be much to make a difference.",
          "Adding a small amount of healthy fat to meals helps absorb nutrients and keeps energy more stable.",
        ]);
      case "on_track":
        return "";
    }
  };

  if (!user) return null;

  if (loadingData) {
    return (
      <div className="min-h-screen bg-surface">
        <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 pt-7">
          <div className="mb-6 h-8 w-28 animate-pulse rounded-lg bg-ink/10" />
          <div className="mb-4 animate-pulse rounded-2xl bg-ink/10 p-5" style={{ height: 180 }} />
          <div className="animate-pulse rounded-2xl bg-ink/10 p-5" style={{ height: 140 }} />
        </div>
        <BottomNav current="summary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <Joyride
        steps={summaryTourSteps}
        run={runSummaryTour}
        continuous
        showSkipButton
        hideCloseButton
        scrollToFirstStep
        callback={handleSummaryTour}
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
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 pt-7">
        <header className="mb-6" data-tour="summary-header">
          <h1 className="text-2xl font-semibold text-ink">Insights</h1>
          <p className="mt-1 text-sm text-muted/70">Daily snapshot and weekly insights at a glance</p>
        </header>

        {/* Unlock progress timeline — only shown until all milestones are reached (14 logged days) */}
        {dayCount < 14 && (() => {
          const nudgesUnlocked = mealCount >= 5;
          const patternsUnlocked = dayCount >= 5 && mealCount >= 5;
          const smartTargetsUnlocked = dayCount >= 7;
          const fullTrendsUnlocked = dayCount >= 14;
          const milestones = [
            { label: "First meal", sub: "", unlocked: mealCount >= 1 },
            { label: "Nudges", sub: nudgesUnlocked ? "" : `${5 - mealCount} more meal${5 - mealCount !== 1 ? "s" : ""}`, unlocked: nudgesUnlocked },
            { label: "Patterns", sub: patternsUnlocked ? "" : `${Math.max(0, 5 - dayCount)} more day${Math.max(0, 5 - dayCount) !== 1 ? "s" : ""}`, unlocked: patternsUnlocked },
            { label: "Smart targets", sub: smartTargetsUnlocked ? "" : `${7 - dayCount} more day${7 - dayCount !== 1 ? "s" : ""}`, unlocked: smartTargetsUnlocked },
            { label: "Full trends", sub: fullTrendsUnlocked ? "" : `${14 - dayCount} more day${14 - dayCount !== 1 ? "s" : ""}`, unlocked: fullTrendsUnlocked },
          ];
          return (
            <div className="mb-5">
              {/* Dot row — background line runs full width, dots sit on top */}
              <div className="relative flex items-center justify-between">
                <div className="absolute inset-x-0 top-[5px] h-px bg-ink/10" />
                {milestones.map((m) => (
                  <div key={m.label} className="relative z-10 flex flex-col items-center" style={{ width: "20%" }}>
                    <div className={`h-3 w-3 rounded-full ${m.unlocked ? "bg-primary/80" : "bg-ink/20"}`} />
                    <p className={`mt-1.5 text-center text-[10px] leading-tight ${m.unlocked ? "text-ink/70" : "text-muted/45"}`}>{m.label}</p>
                    {m.sub && <p className="mt-0.5 text-center text-[10px] leading-tight text-primary/60">{m.sub}</p>}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <Card data-tour="summary-today">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
              Today
            </p>
          </div>
          <div className="mt-5 flex items-baseline justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/60">Calories</p>
              <p className="mt-1 text-xl font-semibold">
                {formatClean(summaryMarkers.todayTotals.calories_min, summaryMarkers.todayTotals.calories_max)}
              </p>
              <p className="text-[10px] text-muted/50">approx.</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/60">Carbs</p>
              <p className="mt-1 text-xl font-semibold">
                {formatClean(summaryMarkers.todayTotals.carbs_g_min, summaryMarkers.todayTotals.carbs_g_max, "g")}
              </p>
              <p className="text-[10px] text-muted/50">approx.</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/60">Fats</p>
              <p className="mt-1 text-xl font-semibold">
                {formatClean(summaryMarkers.todayTotals.fat_g_min, summaryMarkers.todayTotals.fat_g_max, "g")}
              </p>
              <p className="text-[10px] text-muted/50">approx.</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/60">Protein</p>
              <p className="mt-1 text-xl font-semibold">
                {formatClean(summaryMarkers.todayTotals.protein_g_min, summaryMarkers.todayTotals.protein_g_max, "g")}
              </p>
              <p className="text-[10px] text-muted/50">approx.</p>
            </div>
          </div>
          {summaryMarkers.gentleTargets ? (
            <button
              type="button"
              className="mt-4 flex items-center gap-1 text-left text-xs text-muted/70"
              onClick={() => setShowTargetInfo((v) => !v)}
            >
              <span>Suggested range: {gentleTargetsDisplay.calories} kcal · {Math.round(gentleTargetsDisplay.calories * 0.50 / 4)}g carbs · {Math.round(gentleTargetsDisplay.calories * 0.30 / 9)}g fat · {gentleTargetsDisplay.protein}g protein</span>
            </button>
          ) : (
            <p className="mt-2 text-xs text-muted/70">Complete your profile for a personalized range</p>
          )}
          {showTargetInfo && (
            <p className="mt-1 text-[10px] text-muted/50">
              {mealCount >= 10 && profile?.weight
                ? "Based on your recent intake pattern, adjusted for your goal."
                : profile?.weight && profile?.activityLevel
                ? "Based on your weight, activity level, and goal."
                : "Standard estimate. Complete your profile to personalize."}
            </p>
          )}
          <div className="mt-3 h-px w-full bg-ink/5" />
        </Card>

        <Card className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">This week</p>

          {/* 7-day dot strip */}
          <div className="mt-3 flex items-start justify-between">
            {last7Days.map((day) => (
              <div key={day.key} className="flex flex-col items-center gap-1.5">
                <div className={`h-2.5 w-2.5 rounded-full ${day.logged ? "bg-primary/70" : "bg-ink/10"}`} />
                <p className={`text-[10px] ${day.isToday ? "font-semibold text-ink/60" : "text-muted/40"}`}>{day.label}</p>
              </div>
            ))}
          </div>

          {dayCount === 0 ? (
            <p className="mt-3 text-sm text-muted/60">Log your first meal and I'll start building your picture.</p>
          ) : (
            <>
              {weekHeadline && (
                <p className="mt-3 text-sm font-semibold text-ink/80">{weekHeadline}</p>
              )}
              <div className="mt-1.5 space-y-1">
                {weekObservations.map((line) => (
                  <p key={line} className="text-sm text-muted/60">{line}</p>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card className="mt-6" data-tour="nudges-card">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Nudges</p>
            {nudgeCardIsNew && (
              <span className="flex h-2 w-2 rounded-full bg-primary" />
            )}
          </div>
          {mealCount === 0 ? (
            <div className="mt-3 space-y-1">
              <p className="text-sm text-ink/70">Log a few meals and I’ll start learning your patterns.</p>
              <p className="text-xs text-muted/50">Nudges appear after 5 meals.</p>
            </div>
          ) : mealCount < 5 ? (
            <div className="mt-3 space-y-1">
              <p className="text-sm text-ink/70">Getting started · log {5 - mealCount} more meal{5 - mealCount !== 1 ? "s" : ""} and I’ll have my first read on your patterns.</p>
              <div className="mt-2 flex gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full ${i < mealCount ? "bg-primary/60" : "bg-ink/10"}`} />
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {/* Today’s nudges • driven directly from structured visibleNotes */}
              {groupedNudges.some((g) => g.label !== "Today") && (
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/50">Today</p>
              )}
              {visibleNotes.length > 0 ? (
                visibleNotes.map((nudge) => {
                  const goal = profile?.goalDirection ?? "maintain";
                  const why = getNudgeWhy(nudge.type, goal);
                  const action = getNudgeAction(nudge.type, goal);
                  const behavioralChips = getNudgeBehavioralChips(nudge.type, goal);
                  const showFoodChips = nudge.type !== "workout_missing" && nudge.type !== "calorie_high" && nudge.type !== "on_track" && suggestions.length > 0;
                  const showChips = behavioralChips.length > 0 || showFoodChips;
                  return (
                    <div key={nudge.type} className="rounded-xl border border-primary/60 bg-primary/5 px-4 py-3 space-y-2.5">
                      <p className="text-sm font-medium text-ink/90">{(aiMessages[nudge.type] ?? nudge.message).replace(/[.]+$/, "")}</p>
                      {why && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted/50 mb-0.5">{nudge.type === "on_track" ? "Keep it up" : "Why"}</p>
                          <p className="text-xs text-ink/70">{why}</p>
                        </div>
                      )}
                      {(action || showChips) && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted/50 mb-0.5">What to do</p>
                          {action && <p className="text-xs text-ink/70">{action}</p>}
                          {showChips && (
                            <div className="mt-4 space-y-1.5">
                              {behavioralChips.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {behavioralChips.map((chip) => (
                                    <span
                                      key={chip}
                                      className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary/80"
                                    >
                                      {chip}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {showFoodChips && (
                                <div className="flex flex-wrap gap-1.5">
                                  {suggestions.slice(0, 3).map((food) => (
                                    <span
                                      key={food}
                                      className="rounded-full border border-ink/10 bg-white px-2.5 py-0.5 text-[11px] text-ink/60"
                                    >
                                      {food}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-primary/60 bg-primary/5 px-4 py-3 space-y-1">
                  <p className="text-sm font-medium text-ink/90">
                    {profile?.weight ? "Intake is looking solid this week" : "Complete your profile for personalised nudges"}
                  </p>
                  <p className="text-xs text-ink/60">
                    {profile?.weight ? "Keep it up • consistency is what drives results." : "Add your weight and goal in Profile to get started."}
                  </p>
                </div>
              )}
              {/* Past nudges • flat date-grouped scroll, mirrors HomeScreen feed */}
              {groupedNudges.filter((g) => g.label !== "Today").slice(0, visibleNudgeGroupCount).map((group) => (
                <div key={group.label} className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/50">{group.label}</p>
                  {group.items.map((nudge) => (
                    <div
                      key={nudge.id ?? nudge.message}
                      className="rounded-lg bg-ink/5 px-3 py-2 text-xs text-muted/70"
                    >
                      {nudge.message.replace(/[.]+$/, "")}
                    </div>
                  ))}
                </div>
              ))}
              {visibleNudgeGroupCount < groupedNudges.filter((g) => g.label !== "Today").length && (
                <button
                  type="button"
                  className="mt-1 text-[11px] font-semibold text-ink/50 underline"
                  onClick={() => setVisibleNudgeGroupCount((prev) => prev + 3)}
                >
                  Show more
                </button>
              )}
            </div>
          )}
        </Card>


      </div>

      <BottomNav current="summary" />
    </div>
  );
}
