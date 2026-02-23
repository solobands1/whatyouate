"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Joyride, { CallBackProps, STATUS } from "react-joyride";
import { useRouter } from "next/navigation";
import type { MealLog, UserProfile } from "../../../lib/types";
import { summarizeWeek } from "../../../lib/summary";
import BottomNav from "../../../components/BottomNav";
import Card from "../../../components/Card";
import { useAuth } from "../../../components/AuthProvider";
import { getProfile, listMeals } from "../../../lib/supabaseDb";

const INSIGHT_NUTRIENTS = [
  "Iron",
  "Magnesium",
  "Vitamin D",
  "Fiber",
  "B12",
  "Calcium",
  "Potassium",
  "Omega-3",
  "Vitamin C",
  "Folate",
  "Niacin",
  "Riboflavin",
  "Thiamin",
  "Zinc",
  "Selenium",
  "Vitamin A",
  "Vitamin K",
  "Sodium"
];

function avgRangeMidpoint(mins: number[], maxes: number[]) {
  if (!mins.length || !maxes.length) return 0;
  const total = mins.reduce((sum, v) => sum + v, 0) + maxes.reduce((sum, v) => sum + v, 0);
  return Math.round(total / (mins.length + maxes.length));
}

function patternBarWidth(label: string) {
  if (label === "Low appearance") return "20%";
  if (label === "Emerging pattern") return "50%";
  return "85%";
}

const NUTRIENT_INFO: Record<string, string> = {
  "Energy, Protein & Fats":
    "This section summarizes your recent intake pattern. It uses the last 7 days of logged meals to estimate averages and show a gentle range. The range is meant to be flexible, not a strict target.",
  Iron: "Supports steady energy and daily stamina. It tends to show up in red meat, beans, lentils, and leafy greens. A stronger pattern can mean more of those foods are in your routine.",
  Magnesium: "Supports calm energy and recovery. Often found in nuts, seeds, beans, whole grains, and dark greens. A low appearance can mean fewer of those foods lately.",
  "Vitamin D": "Supports mood, energy, and overall balance. It can be harder to get from food alone, but fatty fish, eggs, and fortified foods help.",
  Fiber: "Supports digestion, fullness, and steady energy. It shows up with fruits, vegetables, beans, and whole grains.",
  B12: "Supports energy and focus. Common in animal foods and fortified options. Low appearance may simply mean fewer of those sources recently.",
  Calcium: "Supports steady strength and daily resilience. Often from dairy or fortified alternatives, plus some greens and beans.",
  Potassium: "Supports hydration balance and steady energy. Often found in fruits, vegetables, potatoes, and beans.",
  "Omega-3": "Supports brain and mood balance. Often from fatty fish, chia, flax, and walnuts.",
  "Vitamin C": "Supports recovery and vitality. Common in fruits, peppers, and many vegetables.",
  Folate: "Supports steady energy and overall balance. Often found in leafy greens, legumes, and fortified grains.",
  Niacin: "Supports energy use from food. Often present in meats, legumes, and whole grains.",
  Riboflavin: "Supports energy use from food. Found in dairy, eggs, almonds, and greens.",
  Thiamin: "Supports energy metabolism. Often found in whole grains, legumes, and seeds.",
  Zinc: "Supports recovery and everyday resilience. Found in meats, legumes, seeds, and whole grains.",
  Selenium: "Supports overall balance. Often in seafood, eggs, and grains.",
  "Vitamin A": "Supports vision and overall balance. Often found in colorful vegetables and some dairy foods.",
  "Vitamin K": "Supports everyday balance. Common in leafy greens and some vegetable oils.",
  Sodium: "Supports hydration balance. It often rises with prepared or salted foods—useful to notice patterns.",
  "Vitamin E": "Supports cell protection and steady recovery. Often found in nuts, seeds, and plant oils.",
  Copper: "Supports energy pathways and balance. Found in nuts, seeds, legumes, and whole grains.",
  "Vitamin B6": "Supports energy use and mood balance. Found in poultry, fish, potatoes, and bananas."
};

export default function InsightsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | undefined>();
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [activeNutrient, setActiveNutrient] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const [runInsightsTour, setRunInsightsTour] = useState(false);

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
    Promise.all([getProfile(user.id), listMeals(user.id, 500)])
      .then(([profileData, mealsData]) => {
        if (!mountedRef.current) return;
        setProfile(profileData ?? undefined);
        setMeals(mealsData);
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setLoadingData(false);
      });
  };

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("meals-updated", handler as EventListener);
    window.addEventListener("profile-updated", handler as EventListener);
    return () => {
      window.removeEventListener("meals-updated", handler as EventListener);
      window.removeEventListener("profile-updated", handler as EventListener);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const seen = localStorage.getItem(`wya_walkthrough_${user.id}`);
    const active = localStorage.getItem(`wya_walkthrough_active_${user.id}`) === "true";
    const stage = localStorage.getItem(`wya_walkthrough_stage_${user.id}`);
    if (!seen && active && stage === "insights") {
      const timer = window.setTimeout(() => setRunInsightsTour(true), 150);
      return () => window.clearTimeout(timer);
    }
  }, [user]);

  const dayCount = useMemo(() => {
    const days = new Set(meals.map((meal) => new Date(meal.ts).toISOString().slice(0, 10)));
    return days.size;
  }, [meals]);

  const mealCount = meals.length;

  const weekSummary = useMemo(() => summarizeWeek(meals, 7), [meals]);

  const avgCalories = useMemo(() => {
    const mins = weekSummary.map((d) => d.totals.calories_min);
    const maxes = weekSummary.map((d) => d.totals.calories_max);
    return avgRangeMidpoint(mins, maxes);
  }, [weekSummary]);

  const avgProtein = useMemo(() => {
    const mins = weekSummary.map((d) => d.totals.protein_g_min);
    const maxes = weekSummary.map((d) => d.totals.protein_g_max);
    return avgRangeMidpoint(mins, maxes);
  }, [weekSummary]);

  const avgFat = useMemo(() => {
    const mins = weekSummary.map((d) => d.totals.fat_g_min);
    const maxes = weekSummary.map((d) => d.totals.fat_g_max);
    return avgRangeMidpoint(mins, maxes);
  }, [weekSummary]);

  const proteinPattern = useMemo(() => {
    if (profile?.weight) {
      const target = profile.weight * 1.6;
      if (avgProtein < target * 0.6) return "Low protein appearance";
      if (avgProtein < target * 0.9) return "Moderate protein pattern";
      return "Strong protein pattern";
    }
    if (avgProtein < 60) return "Low protein appearance";
    if (avgProtein < 100) return "Moderate protein pattern";
    return "Strong protein pattern";
  }, [avgProtein, profile?.weight]);

  const energyPattern = useMemo(() => {
    if (avgCalories < 1600) return "Light intake pattern";
    if (avgCalories < 2400) return "Moderate intake pattern";
    return "High intake pattern";
  }, [avgCalories]);

  const fatPattern = useMemo(() => {
    if (avgFat < 45) return "Lower fat appearance";
    if (avgFat < 80) return "Moderate fat pattern";
    return "Higher fat appearance";
  }, [avgFat]);

  const micronutrientPatterns = useMemo(() => {
    const signals = meals
      .filter((meal) => Date.now() - meal.ts <= 30 * 24 * 60 * 60 * 1000)
      .flatMap((meal) => meal.analysisJson.micronutrient_signals ?? []);

    const byNutrient = new Map<string, number>();
    for (const signal of signals) {
      const name = String(signal.nutrient || "").toLowerCase();
      byNutrient.set(name, (byNutrient.get(name) ?? 0) + 1);
    }

    return INSIGHT_NUTRIENTS.map((nutrient) => {
      const key = nutrient.toLowerCase();
      const count = byNutrient.get(key) ?? 0;
      const ratio = mealCount ? count / mealCount : 0;
      let label = "Low appearance";
      if (ratio >= 0.3) label = "Strong pattern";
      else if (ratio >= 0.1) label = "Emerging pattern";
      return {
        name: nutrient,
        label,
        width: patternBarWidth(label)
      };
    });
  }, [meals, mealCount]);

  const hasEnoughData = dayCount >= 5 && mealCount >= 10;

  const gentleTargets = useMemo(() => {
    if (!profile || !hasEnoughData) return null;
    const goal = profile.goalDirection;
    const calNudge = goal === "gain" ? 0.05 : goal === "lose" ? -0.05 : 0;
    const suggestedCalories = Math.max(0, Math.round(avgCalories * (1 + calNudge)));
    const weight = profile.weight ?? 0;
    const proteinTarget = weight
      ? weight * (goal === "gain" ? 1.6 : goal === "lose" ? 1.2 : 1.4)
      : 0;
    const proteinNudge = proteinTarget
      ? avgProtein + Math.round((proteinTarget - avgProtein) * 0.1)
      : avgProtein;
    if (!suggestedCalories && !proteinNudge) return null;
    return { calories: suggestedCalories, protein: Math.round(proteinNudge) };
  }, [profile, hasEnoughData, avgCalories, avgProtein]);

  const gentleTargetsDisplay = gentleTargets ?? { calories: 2300, protein: 125 };
  const displayAvgCalories = hasEnoughData ? `${avgCalories}` : "2100";
  const displayAvgProtein = hasEnoughData ? `${avgProtein}g` : "120g";
  const displayAvgFat = hasEnoughData ? `${avgFat}g` : "65g";
  const displayEnergyPattern = hasEnoughData ? energyPattern : "Moderate intake pattern";
  const displayProteinPattern = hasEnoughData ? proteinPattern : "Moderate protein pattern";
  const displayFatPattern = hasEnoughData ? fatPattern : "Moderate fat pattern";
  const displayMicronutrients = hasEnoughData
    ? micronutrientPatterns
    : INSIGHT_NUTRIENTS.map((name) => ({
        name,
        label: "Emerging pattern",
        width: patternBarWidth("Emerging pattern")
      }));

  const insightsTourSteps = [
    {
      target: '[data-tour="insights-energy"]',
      content: "View your average macros updated over time to give you pattern insights.",
      disableBeacon: true
    },
    {
      target: '[data-tour="insights-micro"]',
      content:
        "Micronutrient patterns emerge over time as you log more meals to help you improve general health.",
      disableBeacon: true
    }
  ];

  const handleInsightsTour = (data: CallBackProps) => {
    if (!user) return;
    if (data.status === STATUS.SKIPPED) {
      localStorage.setItem(`wya_walkthrough_${user.id}`, "true");
      localStorage.removeItem(`wya_walkthrough_active_${user.id}`);
      localStorage.removeItem(`wya_walkthrough_stage_${user.id}`);
      setRunInsightsTour(false);
      return;
    }
    if (data.type === "step:after" && data.index === insightsTourSteps.length - 1) {
      localStorage.setItem(`wya_walkthrough_${user.id}`, "true");
      localStorage.removeItem(`wya_walkthrough_active_${user.id}`);
      localStorage.removeItem(`wya_walkthrough_stage_${user.id}`);
      localStorage.setItem(`wya_walkthrough_profile_${user.id}`, "true");
      setRunInsightsTour(false);
      router.push("/profile");
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-surface">
      <Joyride
        steps={insightsTourSteps}
        run={runInsightsTour}
        continuous
        showSkipButton
        hideCloseButton
        disableBeacon
        scrollToFirstStep
        callback={handleInsightsTour}
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
        <header className="mb-6" data-tour="insights-header">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-ink">Nutrient Patterns</h1>
              <p className="mt-1 text-sm text-muted/70">Based on foods logged over time.</p>
              {!hasEnoughData && (
                <div className="mt-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] text-amber-700">
                  Real data appears after a few more meals
                </div>
              )}
            </div>
            <button
              type="button"
              className="text-xs font-semibold text-ink/70 underline"
              onClick={() => router.push("/summary")}
            >
              Back
            </button>
          </div>
        </header>

        <Card data-tour="insights-energy">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-wide text-muted/70">Energy, Protein &amp; Fats</p>
              <button
                type="button"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-ink/10 text-[10px] font-semibold text-ink/60"
                onClick={() => setActiveNutrient("Energy, Protein & Fats")}
                aria-label="About energy, protein, and fats"
              >
                i
              </button>
            </div>
            <p className="text-[11px] uppercase tracking-wide text-muted/50">Last 7 days</p>
          </div>
          <div className="mt-4 space-y-3 text-sm text-ink/80">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/60">Average calories</p>
              <p className="mt-1 text-lg font-semibold">{displayAvgCalories}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/60">Average protein</p>
              <p className="mt-1 text-lg font-semibold">{displayAvgProtein}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/60">Average fats</p>
              <p className="mt-1 text-lg font-semibold">{displayAvgFat}</p>
            </div>
          </div>
          <div className="mt-3 h-px w-full bg-ink/5" />
          <p className="mt-3 text-xs text-muted/70">
            Suggested range
            <span className="text-muted/50">{mealCount > 0 ? "" : " (preview)"}</span>
            : {gentleTargetsDisplay.calories} kcal · {gentleTargetsDisplay.protein} g protein · {displayAvgFat} fats
          </p>
        </Card>

        <Card className="mt-6" data-tour="insights-micro">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-muted/70" data-tour="insights-micro-title">
              Micronutrient Patterns
            </p>
            {mealCount === 0 && <p className="text-[11px] uppercase tracking-wide text-muted/50">Preview</p>}
          </div>
          <div className="mt-4 space-y-4">
            {displayMicronutrients.map((pattern, index) => (
              <div key={pattern.name} data-tour={index < 2 ? "insights-micro" : undefined}>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-ink/80">{pattern.name}</p>
                  <button
                    type="button"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-ink/10 text-[10px] font-semibold text-ink/60"
                    onClick={() => setActiveNutrient(pattern.name)}
                    aria-label={`About ${pattern.name}`}
                  >
                    i
                  </button>
                </div>
                <div className="mt-2 h-2 rounded-full border border-ink/5 bg-ink/5">
                  <div
                    className="h-2 rounded-full bg-primary/35"
                    style={{ width: pattern.width }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted/70">
            Based on nutrient signals detected in your logged meals. Shorter bars mean fewer appearances;
            longer bars mean stronger patterns over time. Use this as a gentle prompt to adjust food choices
            if you want to nudge a pattern.
          </p>
        </Card>
      </div>

      <BottomNav current="summary" />

      {activeNutrient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-ink">{activeNutrient}</p>
                <p className="mt-2 text-sm text-muted/70">
                  {NUTRIENT_INFO[activeNutrient] ?? "Supports steady energy and overall balance."}
                </p>
              </div>
              <button
                type="button"
                className="text-sm font-semibold text-ink/60"
                onClick={() => setActiveNutrient(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
