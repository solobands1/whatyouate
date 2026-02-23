"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Joyride, { CallBackProps, STATUS } from "react-joyride";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { MealLog, UserProfile, WorkoutSession } from "../lib/types";
import { formatApprox, formatDateShort, todayKey } from "../lib/utils";
import BottomNav from "./BottomNav";
import Card from "./Card";
import { useAuth } from "./AuthProvider";
import { addNudge, getProfile, listMeals, listNudges, listWorkouts } from "../lib/supabaseDb";
import { computeNudges, computeSummaryMarkers } from "../lib/digestEngine";
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
  const [loadingData, setLoadingData] = useState(true);
  const mountedRef = useRef(true);
  const [runSummaryTour, setRunSummaryTour] = useState(false);
  const [showNudgeInsights, setShowNudgeInsights] = useState(false);

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

  const loadData = () => {
    if (!user) return;
    setLoadingData(true);
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
        return Promise.all([getProfile(user.id), listMeals(user.id, 200), listWorkouts(user.id, 200)]);
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
  };

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const seen = localStorage.getItem(`wya_walkthrough_${user.id}`);
    const active = localStorage.getItem(`wya_walkthrough_active_${user.id}`) === "true";
    const stage = localStorage.getItem(`wya_walkthrough_stage_${user.id}`);
    if (!seen && active && stage === "summary") {
      const timer = window.setTimeout(() => setRunSummaryTour(true), 150);
      return () => window.clearTimeout(timer);
    }
  }, [user]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("meals-updated", handler as EventListener);
    return () => window.removeEventListener("meals-updated", handler as EventListener);
  }, [user]);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!showNudgeInsights) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [showNudgeInsights]);

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
  const suggestions = summaryMarkers.suggestions;
  const nutrientNotes = summaryMarkers.nutrientNotes;
  const fuelingState = summaryMarkers.fuelingState;
  const [nudgeViewCount, setNudgeViewCount] = useState(0);

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
    nudges
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .forEach((nudge) => {
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
      if (messages.has(note)) return;
      messages.add(note);
      items.push({ message: note });
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
      content: "Tap Insights for deeper guidance on today’s nudges.",
      disableBeacon: true
    },
    {
      target: '[data-tour="summary-info"]',
      content: (
        <div className="space-y-2">
          <p>If you see this symbol, click on it to learn more about that section.</p>
          <div className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-ink/10 text-xs font-semibold text-ink/70">
            i
          </div>
        </div>
      ),
      disableBeacon: true
    },
    {
      target: '[data-tour="dig-deeper"]',
      content: "Dig Deeper shows longer-term nutrient patterns.",
      disableBeacon: true
    }
  ];

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
      .map((meal) => meal.analysisJson.detected_items?.[0]?.name ?? "")
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
    const proteinHigh = avgWeekProtein > 0 && avgWeekProtein > proteinTarget * 1.1;
    const caloriesLow = caloriesTarget > 0 && avgWeekCalories < caloriesTarget * 0.85;
    const caloriesHigh = caloriesTarget > 0 && avgWeekCalories > caloriesTarget * 1.1;

    if (goal === "lose") {
      if (caloriesHigh) tips.push("Calories have been running higher than your goal.");
      if (proteinLow) tips.push("Protein has been trending a bit low lately.");
    } else if (goal === "gain") {
      if (caloriesLow) tips.push("Calories have been running lighter than your goal.");
      if (proteinLow) tips.push("Protein has been trending a bit low lately.");
    } else {
      if (caloriesLow) tips.push("Calories have been a little light lately.");
      if (caloriesHigh) tips.push("Calories have been a little high lately.");
      if (proteinLow) tips.push("Protein has been trending a bit low lately.");
    }

    if (tips.length === 0) tips.push("Your intake has been fairly steady lately.");

    return tips.slice(0, 2);
  }, [profile, gentleTargetsDisplay, avgWeekProtein, avgWeekCalories]);

  const smartAddOns = useMemo(() => {
    const tips: string[] = [];
    const goal = profile?.goalDirection ?? "maintain";
    const caloriesTarget = gentleTargetsDisplay.calories;
    const caloriesHigh = caloriesTarget > 0 && avgWeekCalories > caloriesTarget * 1.1;
    const caloriesLow = caloriesTarget > 0 && avgWeekCalories < caloriesTarget * 0.85;
    const proteinLow = avgWeekProtein > 0 && avgWeekProtein < gentleTargetsDisplay.protein * 0.85;

    if (goal === "lose") {
      if (caloriesHigh) tips.push("Reduce portions slightly or skip one side.");
      if (proteinLow) tips.push("Pair meals with a little more protein.");
    } else if (goal === "gain") {
      if (caloriesLow) tips.push("Add a side or a slightly larger portion.");
      if (proteinLow) tips.push("Pair meals with extra protein.");
    } else {
      if (caloriesHigh) tips.push("Reduce portions slightly to stay balanced.");
      if (caloriesLow) tips.push("Add a small side to stay balanced.");
      if (proteinLow) tips.push("Pair meals with more protein.");
    }

    if (tips.length === 0) tips.push("Keep portions steady and pair meals with protein.");

    return tips.slice(0, 2);
  }, [profile, gentleTargetsDisplay, avgWeekCalories, avgWeekProtein]);

  const foodIdeas = useMemo(() => {
    const ideas: string[] = [];
    const lower = recentFoods;
    const has = (terms: string[]) => lower.some((item) => terms.some((term) => item.includes(term)));
    const goal = profile?.goalDirection ?? "maintain";
    const caloriesTarget = gentleTargetsDisplay.calories;
    const caloriesHigh = caloriesTarget > 0 && avgWeekCalories > caloriesTarget * 1.1;
    const caloriesLow = caloriesTarget > 0 && avgWeekCalories < caloriesTarget * 0.85;
    const proteinLow = avgWeekProtein > 0 && avgWeekProtein < gentleTargetsDisplay.protein * 0.85;

    const pushIf = (text: string) => {
      if (!ideas.includes(text)) ideas.push(text);
    };

    if (has(["burger", "cheeseburger", "hamburger", "sandwich", "sub"])) {
      if (goal === "lose" && caloriesHigh) pushIf("Swap fries for a side salad with your meal.");
      else if (goal === "gain" && caloriesLow) pushIf("Add fries or a side with your meal.");
      else pushIf("Add a side salad or veggies with your meal.");
    }
    if (has(["pizza"])) {
      if (goal === "lose" && caloriesHigh) pushIf("Try one less slice and add a salad.");
      else if (goal === "gain" && caloriesLow) pushIf("Add a protein side or another slice.");
      else pushIf("Add a protein side or salad.");
    }
    if (has(["pasta", "noodle", "ramen", "udon", "spaghetti"])) {
      pushIf(goal === "gain" ? "Add lean protein and a little extra portion." : "Add lean protein and veggies.");
    }
    if (has(["rice", "bowl", "poke", "bibimbap", "burrito", "taco"])) {
      pushIf(goal === "gain" ? "Add extra rice or beans." : "Add extra veggies or lean protein.");
    }
    if (has(["salad"])) {
      pushIf("Add a protein topper (chicken, beans, tuna).");
    }
    if (has(["smoothie", "shake"])) {
      pushIf(goal === "gain" ? "Add Greek yogurt or nut butter." : "Add protein or fiber.");
    }
    if (has(["breakfast", "oat", "cereal", "toast", "pancake", "waffle"])) {
      pushIf("Add eggs or Greek yogurt with your meal.");
    }
    if (has(["sushi", "roll", "sashimi"])) {
      pushIf("Add edamame or miso with your meal.");
    }
    if (has(["steak", "chicken", "salmon", "fish"])) {
      pushIf(goal === "gain" ? "Add a carb side with your meal." : "Add veggies with your meal.");
    }
    if (has(["fries", "chips"])) {
      pushIf(goal === "lose" ? "Swap for a side salad or fruit." : "Pair with a protein side.");
    }
    if (has(["dessert", "cookie", "cake", "ice cream", "donut"])) {
      pushIf(goal === "lose" ? "Keep dessert portion small." : "Pair with yogurt or milk after your meal.");
    }

    if (proteinLow) pushIf("Add Greek yogurt or a protein bar after your meal.");
    if (goal === "lose" && caloriesHigh) pushIf("Choose a smaller portion or skip one side.");
    if (goal === "gain" && caloriesLow) pushIf("Add a small carb side with your meal.");

    if (ideas.length === 0) {
      pushIf("Keep portions steady and add a balanced side with your meal.");
    }

    return ideas.slice(0, 3);
  }, [recentFoods, profile, gentleTargetsDisplay, avgWeekCalories, avgWeekProtein]);

  const formatSentenceList = (items: string[]) => {
    if (items.length === 0) return "";
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  };

  useEffect(() => {
    if (!user || !nudgesLoadedRef.current || visibleNotes.length === 0) return;
    const existing = new Set(nudges.map((n) => n.message));
    const missing = visibleNotes.filter((note) => !existing.has(note));
    if (missing.length === 0) return;
    missing.forEach((note) => {
      addNudge(user.id, "awareness", note).catch(() => {
        // Silent: nudges are optional.
      });
    });
  }, [user, visibleNotes, nudges]);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-surface">
      <Joyride
        steps={summaryTourSteps}
        run={runSummaryTour}
        continuous
        showSkipButton
        hideCloseButton
        disableBeacon
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
          <h1 className="text-2xl font-semibold text-ink">Summary</h1>
        </header>

        <Card data-tour="summary-today">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
              Today
            </p>
            <Link
              href="/summary/insights"
              data-tour="dig-deeper"
              className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white shadow-[0_6px_14px_rgba(15,23,42,0.14)] ring-1 ring-white/40 transition hover:bg-primary/90"
            >
              Dig Deeper
              <span className="text-[10px]">→</span>
            </Link>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/60">
                Calories
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {formatClean(
                  summaryMarkers.todayTotals.calories_min,
                  summaryMarkers.todayTotals.calories_max
                )}
              </p>
              <p className="text-[10px] text-muted/50">approx.</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/60">
                Protein
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {formatClean(
                  summaryMarkers.todayTotals.protein_g_min,
                  summaryMarkers.todayTotals.protein_g_max,
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
          <div className="mt-3 h-px w-full bg-ink/5" />
        </Card>

        <Card className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Last 7 days</p>
            <button
              type="button"
              data-tour="summary-info"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-ink/10 text-[10px] font-semibold text-ink/60"
              onClick={() => setShowNudgeInsights(true)}
            >
              i
            </button>
          </div>
          <div className="mt-3 space-y-2 text-xs text-muted/70">
            {dayCount > 0 ? (
              <p className="text-sm font-semibold text-ink/80">
                Logged: {Math.min(dayCount, 7)} of 7 days
              </p>
            ) : null}
            <p className="text-sm font-semibold text-ink/80">
              {dayCount >= 5 && mealCount >= 10
                ? `Average: ${avgWeekCalories} kcal · ${avgWeekProtein} g protein`
                : "Average: 0 kcal · 0 g protein"}
            </p>
            <p className="text-sm font-semibold text-ink/80">
              Workouts: {workoutSummary.count} sessions · {workoutSummary.totalMinutes} minutes
            </p>
            {dayCount === 0 && <p>No days logged yet.</p>}
          </div>
        </Card>

        <Card className="mt-6" data-tour="nudges-card">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Awareness Nudges</p>
            <button
              type="button"
              data-tour="insights-button"
              className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white shadow-[0_6px_14px_rgba(15,23,42,0.14)] ring-1 ring-white/40 transition hover:bg-primary/90"
              onClick={() => setShowNudgeInsights(true)}
            >
              Insights
              <span className="text-[10px]">→</span>
            </button>
          </div>
          <div className="mt-4 max-h-40 space-y-3 overflow-y-auto text-sm text-ink/90">
            {groupedNudges.length ? (
              groupedNudges.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted/60">
                    {group.label}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {group.items.map((nudge) => (
                      <div
                        key={nudge.id ?? nudge.message}
                        className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-ink/80"
                      >
                        <span>{nudge.message.replace(/[.]+$/, "")}</span>
                        {nudge.isNew && <span className="text-[10px] text-muted/60">new</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-muted/70">No nudges yet.</p>
            )}
          </div>
          {uniqueNudges.length === 0 && mealCount === 0 && (
            <div className="mt-2 inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs text-ink/80">
              Example: Protein looks a bit low today.
            </div>
          )}
          {uniqueNudges.length === 0 && (
            <p className="mt-2 text-[11px] text-muted/60">Nudges appear after a few meals.</p>
          )}
          {fuelingState === "under" && suggestions.length === 5 && (
            <div className="mt-4">
              <p className="text-sm text-ink/90">A small add may help.</p>
              <p className="text-xs uppercase tracking-wide text-muted/60">5 familiar ideas</p>
              <ul className="mt-2 space-y-1 text-sm text-ink/90">
                {suggestions.map((item) => (
                  <li key={item} className="rounded-xl bg-ink/5 px-3 py-2">{item}</li>
                ))}
              </ul>
            </div>
          )}

          
        </Card>

        {dayCount >= 5 && mealCount >= 10 && nutrientTrends.length > 0 && (
          <Card className="mt-6">
            <p className="text-[11px] uppercase tracking-wide text-muted/60">Nutrient Trends</p>
            <div className="mt-3 space-y-2 text-sm text-ink/80">
              {nutrientTrends.map((trend) => <p key={trend}>{trend}</p>)}
            </div>
          </Card>
        )}

      </div>

      <BottomNav current="summary" />

      {showNudgeInsights && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-ink">Today’s Nudge Insights</h2>
            <p className="mt-2 text-[13px] font-medium text-ink/80">
              We look at your recent meals, today’s intake, and your goal to surface the most consistent patterns.
            </p>
            <div className="mt-3 max-h-72 space-y-4 overflow-y-auto text-sm text-ink/80">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Insight</p>
                <ul className="mt-1 space-y-1">
                  {adaptiveInsight.map((tip) => (
                    <li key={tip}>• {tip.replace(/[.]+$/, "")}</li>
                  ))}
                </ul>
              </div>
              {smartAddOns.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                    Easy nudge
                  </p>
                  <p className="mt-1">
                    {smartAddOns[0]
                      ? `Something you can do is ${smartAddOns[0].replace(/[.]+$/, "").toLowerCase()}.`
                      : ""}
                    {smartAddOns[1]
                      ? ` You can also ${smartAddOns[1].replace(/[.]+$/, "").toLowerCase()}.`
                      : ""}
                  </p>
                </div>
              )}
              {foodIdeas.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                    Food ideas
                  </p>
                  <div className="mt-2 space-y-2">
                    {foodIdeas.map((idea) => (
                      <div
                        key={idea}
                        className="rounded-xl border border-ink/10 bg-ink/5 px-3 py-2 text-xs text-ink/80"
                      >
                        {idea.replace(/[.]+$/, "")}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              className="mt-4 w-full rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90"
              onClick={() => setShowNudgeInsights(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
