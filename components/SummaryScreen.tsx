"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Joyride, { CallBackProps, STATUS, type Step } from "react-joyride";
import { useRouter } from "next/navigation";
import type { MealLog, UserProfile, WorkoutSession } from "../lib/types";
import { formatApprox, formatDateShort, todayKey } from "../lib/utils";
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
  const [expandedNudgeGroups, setExpandedNudgeGroups] = useState<Set<string>>(new Set());

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
    const messages = new Set<string>();
    const items: Array<{ id?: string; message: string; created_at?: string; isNew?: boolean }> = [];
    const todayDateKey = todayKey();
    nudges
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .forEach((nudge) => {
        // Skip DB nudges from today • visibleNotes (fresh compute) covers today's state
        const nudgeDayKey = todayKey(new Date(nudge.created_at));
        if (nudgeDayKey === todayDateKey) return;
        if (messages.has(nudge.message)) return;
        messages.add(nudge.message);
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
      if (messages.has(note.message)) return;
      messages.add(note.message);
      items.push({ message: note.message });
    });
    nutrientNotes.forEach((note) => {
      if (messages.has(note)) return;
      messages.add(note);
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
      content: "View your calorie and protein intake throughout the day.",
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

    const nudgeText = visibleNotes.map((n) => n.message).join(" ").toLowerCase();
    const nudgeIsProtein = nudgeText.includes("protein");
    const nudgeIsCalorie = nudgeText.includes("light") || nudgeText.includes("energy") || nudgeText.includes("intake") || nudgeText.includes("calorie") || nudgeText.includes("fuel");

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

    const nudgeText = visibleNotes.map((n) => n.message).join(" ").toLowerCase();
    const nudgeIsProtein = nudgeText.includes("protein");
    const nudgeIsCalorie = nudgeText.includes("light") || nudgeText.includes("energy") || nudgeText.includes("intake") || nudgeText.includes("calorie") || nudgeText.includes("fuel");

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



  useEffect(() => {
    if (!user || !nudgesLoadedRef.current || visibleNotes.length === 0) return;
    const existing = new Set(nudges.map((n) => n.message));
    const missing = visibleNotes.filter(
      (note) => !existing.has(note.message) && !savedThisSessionRef.current.has(note.message)
    );
    if (missing.length === 0) return;
    missing.forEach((note) => {
      savedThisSessionRef.current.add(note.message);
      addNudge(user.id, "awareness", note.message).catch(() => {
        // Silent: nudges are optional.
      });
    });
    pruneNudges(user.id).catch(() => {});
  }, [user, visibleNotes, nudges]);

  const getNudgeWhy = (type: ComputedNudge["type"], goal: string): string => {
    switch (type) {
      case "protein_low_critical":
        if (goal === "gain") return "Protein is the building block for nearly everything your body does • muscle growth, immune function, hormone production, even keeping your hair and skin healthy. When it's consistently this low, your body starts rationing, and building takes a back seat to just maintaining what you have.";
        if (goal === "lose") return "Protein is the most important thing to protect when you're in a deficit. It keeps you fuller longer, preserves muscle while you lose fat, and helps your metabolism stay active rather than slowing down to compensate.";
        return "Protein does a lot more than build muscle • it regulates hormones, supports your immune system, and keeps energy levels stable throughout the day. Getting it consistently right is one of the highest-leverage things you can do for your overall health.";
      case "protein_low":
        if (goal === "gain") return "Protein is what your body uses to repair and build after every session. A consistent shortfall means slower recovery, and over time that compounds • progress feels harder even when effort stays the same.";
        if (goal === "lose") return "Keeping protein up while you're cutting is one of the most effective levers you have. It keeps hunger more manageable, slows muscle loss, and means the weight that comes off is more likely to be fat than lean tissue.";
        return "Protein isn't just about muscle • it supports mood stability, immune health, and steady energy. Closing this gap doesn't need to be complicated, and most people notice the difference quickly once they do.";
      case "protein_close":
        if (goal === "gain") return "You're tracking really well • a small, consistent top-up each day is what separates steady progress from plateaus. The gap is small enough that closing it is more about habit than any big change.";
        return "You're nearly there, which is worth acknowledging. Finishing the job on protein means your body has everything it needs to function at its best • energy, immune support, and feeling good day to day.";
      case "calorie_low":
        if (goal === "gain") return "Your body needs a reliable surplus to grow • when intake runs consistently below target, it goes into maintenance mode and building stalls. It also affects your mood, focus, and hormonal balance more than most people realise.";
        if (goal === "lose") return "Being too far under your target for too long tends to backfire. Your metabolism adapts, energy crashes, and cravings spike • which makes the deficit harder to maintain. A slightly higher intake often leads to better, more sustainable results.";
        return "Consistently low intake affects more than just weight • it impacts energy, concentration, mood, and how well your body handles stress. Even a small consistent add can shift how you feel across the whole week.";
      case "calorie_high":
        if (goal === "lose") return "Small consistent surpluses compound more than people expect • 150 kcal over target each day adds up to over 1000 kcal across a week. The good news is you don't need big changes to shift the pattern, just consistent small ones.";
        return "Overall health is best supported by intake that stays in a reasonable range consistently, rather than large swings day to day. It's not urgent, but keeping an eye on the weekly pattern is worth the habit.";
      case "workout_fuel_low":
      case "training_fuel_low":
        return "When you're training regularly, your body's energy demands are higher than most people account for. Under-fuelling affects not just performance but also sleep quality, hormone balance, immune function, and how you feel between sessions • it's a health issue as much as a fitness one.";
      case "workout_missing":
        return "Tracking your sessions helps the app give you much more accurate intake targets. An active person who doesn't log workouts can end up with goals calibrated for a sedentary lifestyle • meaning the targets you're hitting might actually be lower than your body needs.";
      case "micronutrient":
        return "Micronutrients don't get the same attention as protein and calories, but they quietly shape a lot • energy levels, immune resilience, hormone regulation, and how well you sleep. When one shows up low consistently, it's usually a variety gap in your diet rather than anything serious, and it's easy to address.";
    }
  };

  const getNudgeBehavioralChips = (type: ComputedNudge["type"], goal: string): string[] => {
    switch (type) {
      case "protein_low_critical":
        return goal === "gain" ? ["+ protein at every meal", "+ protein snack"] : ["+ protein per meal", "+ protein snack"];
      case "protein_low":
        return ["+ protein at each meal", "+ protein snack"];
      case "protein_close":
        return ["+ small protein add"];
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
    }
  };

  const getNudgeAction = (type: ComputedNudge["type"], goal: string): string => {
    switch (type) {
      case "protein_low_critical":
        return goal === "gain"
          ? "Aim to include a solid protein source with every meal • not just dinner. Breakfast and lunch are where most people fall short. Even a small addition to each consistently adds up to a meaningful difference by the end of the week."
          : "Adding a protein-focused snack between two of your main meals tends to be the easiest change that actually sticks. It doesn't mean overhauling your diet • just plugging one consistent gap each day.";
      case "protein_low":
        return "Try making sure each meal has at least one clear protein source. It doesn't need to be a big change • pairing something with a protein hit at each sitting is usually enough to close a gap like this.";
      case "protein_close":
        return "You're close enough that one small addition on most days will get you there. A consistent habit is more important than a big one • even a small add at breakfast or as an afternoon snack tends to be enough.";
      case "calorie_low":
        return goal === "gain"
          ? "Try increasing the size of two or three existing meals rather than adding a whole new one • it's easier to sustain. A bit more at each sitting tends to compound better than trying to squeeze in extra meals."
          : "A small, balanced snack between two of your regular meals is usually the most sustainable fix. The goal is just to close the gap without adding stress or changing your whole routine.";
      case "calorie_high":
        return goal === "lose"
          ? "Focus on small consistent adjustments rather than big cuts • slightly smaller portions at a couple of meals, skipping an optional extra here and there. Small changes held consistently beat big ones that don't stick."
          : "No urgent action needed • just stay aware of portions over the next few days and let things even out naturally. You're likely fine across the week.";
      case "workout_fuel_low":
      case "training_fuel_low":
        return "Try eating a bit more on the days you train • even 200–300 kcal extra around your session makes a real difference to how you feel and how well you recover. It's one of the higher-return adjustments you can make.";
      case "workout_missing":
        return "Log your next session right after it finishes • it only takes about 20 seconds and immediately makes your intake targets more accurate. Do it a few times and it becomes automatic.";
      case "micronutrient":
        return "Try to add a food rich in this nutrient a few times this week • it doesn't need to be every day. The goal is just to start building variety, not to change everything at once. Check the suggestions below for ideas.";
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
        </header>

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
          <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Last 7 days</p>
          <div className="mt-3 space-y-2">
            {dayCount === 0 ? (
              <p className="text-sm text-muted/60">Log your first meal and I'll start building your picture.</p>
            ) : dayCount < 5 || mealCount < 10 ? (
              <p className="text-sm font-semibold text-ink/80">
                {Math.min(dayCount, 7)} of 7 days logged · still learning your patterns.
              </p>
            ) : (
              <>
                <p className="text-sm font-semibold text-ink/80">
                  {Math.min(dayCount, 7)} of 7 days logged · solid.
                </p>
                <p className="text-sm font-semibold text-ink/80">
                  {(() => {
                    const base = `Averaging ${avgWeekCalories} kcal · ${avgWeekProtein}g protein`;
                    if (!gentleTargetsDisplay?.calories || !avgWeekCalories) return `${base}.`;
                    if (avgWeekCalories > gentleTargetsDisplay.calories * 1.1) return `${base} · a bit high.`;
                    if (avgWeekCalories < gentleTargetsDisplay.calories * 0.9) return `${base} · a bit light.`;
                    return `${base} · looking steady.`;
                  })()}
                </p>
              </>
            )}
            {workoutSummary.count > 0 && (
              <p className="text-sm font-semibold text-ink/80">
                {workoutSummary.count} {workoutSummary.count === 1 ? "workout" : "workouts"} this week
                {workoutSummary.totalMinutes > 0 ? ` · ${workoutSummary.totalMinutes} min` : ""}
              </p>
            )}
          </div>
        </Card>

        <Card className="mt-6" data-tour="nudges-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Nudges</p>
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
              {visibleNotes.length > 0 ? (
                visibleNotes.map((nudge) => {
                  const goal = profile?.goalDirection ?? "maintain";
                  const why = getNudgeWhy(nudge.type, goal);
                  const action = getNudgeAction(nudge.type, goal);
                  const behavioralChips = getNudgeBehavioralChips(nudge.type, goal);
                  const showFoodChips = nudge.type !== "workout_missing" && nudge.type !== "calorie_high" && suggestions.length > 0;
                  const showChips = behavioralChips.length > 0 || showFoodChips;
                  return (
                    <div key={nudge.type} className="rounded-xl border border-primary/60 bg-primary/5 px-4 py-3 space-y-2.5">
                      <p className="text-sm font-medium text-ink/90">{nudge.message.replace(/[.]+$/, "")}</p>
                      {why && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted/50 mb-0.5">Why</p>
                          <p className="text-xs text-ink/70">{why}</p>
                        </div>
                      )}
                      {(action || showChips) && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted/50 mb-0.5">What to do</p>
                          {action && <p className="text-xs text-ink/70">{action}</p>}
                          {showChips && (
                            <div className="mt-4 flex flex-wrap gap-1.5">
                              {behavioralChips.map((chip) => (
                                <span
                                  key={chip}
                                  className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary/80"
                                >
                                  {chip}
                                </span>
                              ))}
                              {showFoodChips && suggestions.slice(0, 3).map((food) => (
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
              {/* Past nudges • per-group accordion, unchanged */}
              {groupedNudges.filter((g) => g.label !== "Today").map((group) => (
                <div key={group.label}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left transition hover:bg-ink/5"
                    onClick={() => setExpandedNudgeGroups((prev) => {
                      const next = new Set(prev);
                      next.has(group.label) ? next.delete(group.label) : next.add(group.label);
                      return next;
                    })}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/50">{group.label}</p>
                    <span className="text-[10px] text-muted/40">{expandedNudgeGroups.has(group.label) ? "↑" : "↓"}</span>
                  </button>
                  {expandedNudgeGroups.has(group.label) && (
                    <div className="mt-1.5 space-y-1.5">
                      {group.items.map((nudge) => (
                        <div
                          key={nudge.id ?? nudge.message}
                          className="rounded-lg bg-ink/5 px-3 py-2 text-xs text-muted/70"
                        >
                          {nudge.message.replace(/[.]+$/, "")}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>


      </div>

      <BottomNav current="summary" />
    </div>
  );
}
