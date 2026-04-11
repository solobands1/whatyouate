"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Joyride, { CallBackProps, STATUS, type Step } from "react-joyride";
import { useRouter } from "next/navigation";
import { summarizeLoggedDays, summarizeWeek } from "../lib/summary";
import { computeGentleTargets, normalizeWeightToKg, proteinTargetPerKg } from "../lib/digestEngine";
import BottomNav from "./BottomNav";
import Card from "./Card";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import { dayKeyFromTs } from "../lib/utils";
import { getRda, supplementToNutrient } from "../lib/rda";
import { suppName } from "../lib/types";
import { useTrialStatus } from "../hooks/useTrialStatus";
import { openUpgradeModal } from "./UpgradeModal";
import { triggerValueMoment } from "./ValueMomentSheet";
import { hasEnoughDataForPatterns, countLoggedDays } from "../lib/trial";
import { getFeelLogs, type FeelLog } from "../lib/supabaseDb";

const INSIGHT_NUTRIENTS = [
  "Iron",
  "B12",
  "Magnesium",
  "Zinc",
  "Vitamin D",
  "Calcium",
  "Omega-3",
  "Vitamin C",
  "Potassium",
  "Fiber"
];

function avgRangeMidpoint(mins: number[], maxes: number[]) {
  if (!mins.length || !maxes.length) return 0;
  const total = mins.reduce((sum, v) => sum + v, 0) + maxes.reduce((sum, v) => sum + v, 0);
  return Math.round(total / (mins.length + maxes.length));
}


const NUTRIENT_INFO: Record<string, string | string[]> = {
  "Macros": "Averages from your logged meals over the last 14 days, skipping any days you didn't log, so gaps don't drag the numbers down. Calories and protein have a suggested range based on your profile and goal. Carbs and fat are shown as observed patterns. No strict target.",
  Iron: "Iron carries oxygen in your blood. Low iron is one of the most common deficiencies and shows up as fatigue, brain fog, and feeling cold. Red meat and shellfish absorb best. Plant sources like lentils and spinach absorb better when eaten with vitamin C.",
  Magnesium: "Involved in over 300 body processes including sleep quality, muscle function, and blood sugar regulation. Many people fall short without knowing it. Best sources are pumpkin seeds, dark chocolate, almonds, black beans, and leafy greens.",
  "Vitamin D": "Critical for bone health, immune function, and mood. Food sources are limited to fatty fish, egg yolks, and fortified milk, and most people in northern climates don't get enough from food alone. Sunlight is the main source, and supplementation is often worth considering.",
  Fiber: "Feeds beneficial gut bacteria, slows digestion to keep you full, and helps regulate blood sugar and cholesterol. Most people eat far less than the recommended 25–38g/day. Best sources are legumes, whole grains, vegetables, and fruit with the skin on.",
  B12: "Supports energy, focus, and nervous system health. Found almost exclusively in animal products like meat, fish, eggs, and dairy, or in fortified foods like certain cereals and plant milks. Vegans and vegetarians are most at risk of low intake.",
  Calcium: "Essential for bone density, muscle contraction, and nerve signaling. Dairy is the most concentrated source, but kale, bok choy, tofu made with calcium sulfate, and fortified plant milks are solid alternatives. Vitamin D is needed to absorb it properly.",
  Potassium: "Regulates fluid balance, blood pressure, and muscle contractions including your heart. Most people don't get enough. Potatoes, sweet potatoes, avocados, and beans are all higher sources than the famous banana.",
  "Omega-3": "An essential fat your body can't produce on its own. It's critical for brain function, reducing inflammation, and heart health. Fatty fish like salmon, sardines, and mackerel are far more bioavailable than plant sources like flax and chia, which require conversion.",
  "Vitamin C": "Essential for collagen production, immune defense, and helps absorb iron from plant foods. Your body can't store it, so daily intake matters. Bell peppers, kiwi, broccoli, and strawberries are all higher sources than orange juice.",
  Folate: "Critical for cell division and DNA synthesis, and especially important before and during pregnancy. Also supports mood and energy. Best sources are lentils, chickpeas, asparagus, and leafy greens. The synthetic form in fortified foods absorbs more readily.",
  Niacin: "Helps convert food into energy and supports DNA repair. Deficiency is rare but can cause fatigue and skin issues. Chicken, tuna, salmon, and peanuts are among the richest sources.",
  Riboflavin: "Helps convert food into usable energy and supports antioxidant activity. Low intake can cause fatigue, mouth sores, and light sensitivity. Best sources are dairy, eggs, beef liver, almonds, and leafy greens.",
  Thiamin: "Helps your body turn carbohydrates into energy and is essential for nerve function. Deficiency is more likely in people who drink heavily or eat mostly refined carbs. Found in whole grains, pork, legumes, and nuts.",
  Zinc: "Needed for immune function, wound healing, taste and smell, and hormone health. Men need more than women. Red meat and shellfish (especially oysters) are the richest sources. Plant sources like legumes and seeds are less bioavailable.",
  Selenium: "A powerful antioxidant that supports thyroid function and immune health. Just 1–2 Brazil nuts a day covers your daily needs. Also found in seafood, eggs, and whole grains.",
  "Vitamin A": "Essential for night vision, skin health, and immune function. Found as retinol in liver and dairy, and as beta-carotene in orange and yellow vegetables and leafy greens. Eating fat with plant sources helps your body absorb it.",
  "Vitamin K": "Critical for blood clotting and bone mineralization. There are two forms: K1 comes from leafy greens, and K2 from fermented foods and animal products. K2 is specifically studied for bone and heart health.",
  Sodium: "Necessary for fluid balance and nerve signaling, but most people already get more than enough. It tends to be higher with processed, packaged, and restaurant foods. Worth noticing if it's consistently elevated.",
  "Vitamin E": "A fat-soluble antioxidant that protects cells from damage and supports immune function. Deficiency is rare but more common with very low-fat diets. Best sources are sunflower seeds, almonds, wheat germ, and avocado.",
  Copper: "Works with iron to form red blood cells and supports bone, immune, and nerve health. Deficiency can mimic iron deficiency anemia. Shellfish, liver, dark chocolate, nuts, and seeds are the best sources.",
  "Vitamin B6": "Involved in protein metabolism, neurotransmitter production (serotonin, dopamine), and immune function. Low levels can affect mood and energy. Found in poultry, fish, potatoes, bananas, and chickpeas. Chickpeas are one of the richest plant sources."
};


export default function InsightsScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { profile: ctxProfile, meals, loading: loadingData } = useAppData();
  const profile = ctxProfile ?? undefined;
  const trial = useTrialStatus();
  const [activeNutrient, setActiveNutrient] = useState<string | null>(null);
  const [barsReady, setBarsReady] = useState(false);
  const mountedRef = useRef(true);
  const [runInsightsTour, setRunInsightsTour] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [feelLogs, setFeelLogs] = useState<FeelLog[]>([]);

  useEffect(() => {
    if (!user) return;
    getFeelLogs(user.id, 30).then(setFeelLogs).catch(() => {});
  }, [user]);

  const feelLogsByDay = useMemo(() => {
    const SCORE: Record<string, number> = { energized: 4, good: 3, okay: 2, low: 1, drained: 0 };
    const map: Record<string, { avgScore: number; count: number }> = {};
    const grouped: Record<string, number[]> = {};
    for (const log of feelLogs) {
      const key = dayKeyFromTs(log.ts);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(SCORE[log.tag] ?? 2);
    }
    for (const [key, scores] of Object.entries(grouped)) {
      map[key] = { avgScore: scores.reduce((s, v) => s + v, 0) / scores.length, count: scores.length };
    }
    return map;
  }, [feelLogs]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (loadingData) { setBarsReady(false); return; }
    const t = setTimeout(() => setBarsReady(true), 60);
    return () => clearTimeout(t);
  }, [loadingData]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const active = localStorage.getItem(`wya_walkthrough_active_${user.id}`) === "true";
    const stage = localStorage.getItem(`wya_walkthrough_stage_${user.id}`);
    if (active && stage === "insights") {
      setIsDemoMode(true);
      const timer = window.setTimeout(() => setRunInsightsTour(true), 400);
      return () => window.clearTimeout(timer);
    }
  }, [user]);

  // Value moment: trigger the "your patterns are ready" sheet once per session
  // Only fires during an active trial — if expired, user will hit paywall instead
  useEffect(() => {
    if (loadingData || trial.isPro || trial.isFree) return;
    if (hasEnoughDataForPatterns(meals)) {
      const realMeals = meals.filter(
        (m) => m.analysisJson?.source !== "supplement" && m.status !== "failed"
      );
      triggerValueMoment({ mealCount: realMeals.length, dayCount: countLoggedDays(meals) });
    }
  }, [loadingData, meals, trial.isPro, trial.isFree]);

  // Only average over days that were actually logged — gaps and missed days don't deflate the numbers
  const weekSummary = useMemo(() => summarizeLoggedDays(meals, 14), [meals]);

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

  const avgCarbs = useMemo(() => {
    const mins = weekSummary.map((d) => d.totals.carbs_g_min);
    const maxes = weekSummary.map((d) => d.totals.carbs_g_max);
    return avgRangeMidpoint(mins, maxes);
  }, [weekSummary]);

  const avgFat = useMemo(() => {
    const mins = weekSummary.map((d) => d.totals.fat_g_min);
    const maxes = weekSummary.map((d) => d.totals.fat_g_max);
    return avgRangeMidpoint(mins, maxes);
  }, [weekSummary]);

  const proteinPattern = useMemo(() => {
    if (profile?.weight) {
      const weightKg = normalizeWeightToKg(profile.weight, profile.units);
      const target = weightKg * proteinTargetPerKg(profile);
      if (avgProtein < target * 0.6) return "Low protein appearance";
      if (avgProtein < target * 0.9) return "Moderate protein pattern";
      return "Strong protein pattern";
    }
    if (avgProtein < 60) return "Low protein appearance";
    if (avgProtein < 100) return "Moderate protein pattern";
    return "Strong protein pattern";
  }, [avgProtein, profile]);

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
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentMeals = meals.filter((meal) => meal.ts > cutoff);

    // Use unique logged days as denominator — fairer than meal count since
    // logging 3 meals in one day shouldn't penalise the ratio vs 1 meal days.
    const recentDayCount = new Set(recentMeals.map((m) => dayKeyFromTs(m.ts))).size;

    // Build per-nutrient daily totals from micronutrient_amounts (new meals)
    // and fall back to frequency detection for older meals without amounts.
    const rda = profile ? getRda(profile.sex, profile.age) : null;

    // amountTotalsByNutrient: nutrient key → sum of midpoint amounts across all recent meals
    const amountTotalsByNutrient = new Map<string, number>();
    // amountMealCountByNutrient: how many meals contributed an amount for this nutrient
    const amountMealCountByNutrient = new Map<string, number>();
    // daysByNutrient: fallback frequency tracking for meals without amounts
    const daysByNutrient = new Map<string, Set<string>>();

    for (const meal of recentMeals) {
      if (meal.analysisJson.source === "supplement") continue;
      const dayKey = dayKeyFromTs(meal.ts);
      const amounts = meal.analysisJson.micronutrient_amounts;

      if (amounts?.length) {
        for (const a of amounts) {
          const key = a.nutrient.toLowerCase();
          const midpoint = (a.amount_min + a.amount_max) / 2;
          amountTotalsByNutrient.set(key, (amountTotalsByNutrient.get(key) ?? 0) + midpoint);
          amountMealCountByNutrient.set(key, (amountMealCountByNutrient.get(key) ?? 0) + 1);
        }
      }

      // Always track frequency as fallback
      for (const signal of meal.analysisJson.micronutrient_signals ?? []) {
        if (signal.signal === "uncertain") continue;
        const name = String(signal.nutrient || "").toLowerCase();
        if (!daysByNutrient.has(name)) daysByNutrient.set(name, new Set());
        daysByNutrient.get(name)!.add(dayKey);
      }
    }

    // Compute supplement coverage per nutrient (dose vs RDA)
    const suppRatioByNutrient = new Map<string, number>();
    if (rda && profile?.dailySupplements?.length) {
      for (const entry of profile.dailySupplements) {
        // Multi-supplement: iterate each nutrient entry directly
        if (typeof entry !== "string" && entry.nutrients?.length) {
          for (const n of entry.nutrients) {
            // "ratio" unit: dose is already a 0–1 fraction of RDA (from % DV input)
            if (n.unit === "ratio") {
              suppRatioByNutrient.set(
                n.nutrient,
                (suppRatioByNutrient.get(n.nutrient) ?? 0) + n.dose
              );
              continue;
            }
            const mapped = supplementToNutrient(n.nutrient, n.dose, n.unit);
            if (!mapped) continue;
            const rdaVal = rda[mapped.nutrient];
            if (!rdaVal) continue;
            suppRatioByNutrient.set(
              mapped.nutrient,
              (suppRatioByNutrient.get(mapped.nutrient) ?? 0) + mapped.doseInRdaUnit / rdaVal
            );
          }
          continue;
        }
        // Single-nutrient supplement
        const name = suppName(entry);
        const dose = typeof entry === "string" ? undefined : entry.dose;
        const unit = typeof entry === "string" ? undefined : entry.unit;
        const mapped = supplementToNutrient(name, dose, unit);
        if (!mapped) continue;
        const rdaVal = rda[mapped.nutrient];
        if (!rdaVal) continue;
        suppRatioByNutrient.set(
          mapped.nutrient,
          (suppRatioByNutrient.get(mapped.nutrient) ?? 0) + mapped.doseInRdaUnit / rdaVal
        );
      }
    }

    return INSIGHT_NUTRIENTS.map((nutrient) => {
      const key = nutrient.toLowerCase();
      const rdaVal = rda ? rda[key] : null;

      // --- Food ratio ---
      // Prefer amount-based calculation; fall back to frequency
      let foodRatio = 0;
      let usingAmounts = false;

      if (rdaVal && amountTotalsByNutrient.has(key) && recentDayCount > 0) {
        // Average daily amount = total across all meals / number of logged days
        const avgDailyAmount = amountTotalsByNutrient.get(key)! / recentDayCount;
        foodRatio = avgDailyAmount / rdaVal;
        usingAmounts = true;
      } else if (recentDayCount > 0) {
        const days = daysByNutrient.get(key)?.size ?? 0;
        foodRatio = days / recentDayCount;
      }

      // --- Label ---
      let label = "Rarely detected";
      if (foodRatio >= 0.70) label = "Frequently detected";
      else if (foodRatio >= 0.45) label = "Building pattern";
      else if (foodRatio >= 0.20) label = "Sometimes detected";

      const rawSuppRatio = suppRatioByNutrient.get(key) ?? 0;
      const suppRatio = Math.min(1, rawSuppRatio);
      const combinedRatio = Math.min(1, foodRatio + rawSuppRatio);

      // Override label when combined coverage is strong
      if (rawSuppRatio > 0 && combinedRatio >= 0.80) {
        const overPct = Math.round((foodRatio + rawSuppRatio - 1) * 100);
        label = overPct > 5 ? `Well covered · ~${overPct}% over RDA` : "Well covered";
      } else if (usingAmounts && foodRatio >= 0.80) {
        const overPct = Math.round((foodRatio - 1) * 100);
        label = overPct > 5 ? `Well covered · ~${overPct}% over RDA` : "Well covered";
      }

      // Bar widths — proportional to actual contribution.
      // If combined >= 100% of RDA, fill the bar completely (100%) to clearly signal coverage.
      const clampedFoodRatio = Math.min(1, foodRatio);
      const rawTotal = clampedFoodRatio + suppRatio;
      const isFullyCovered = (foodRatio + rawSuppRatio) >= 1;
      const cappedTotal = isFullyCovered ? 1 : Math.min(0.96, rawTotal);
      const foodPct = rawTotal > 0 ? Math.round((clampedFoodRatio / rawTotal) * cappedTotal * 100) : 0;
      const suppPct = rawTotal > 0 && rawSuppRatio > 0 ? Math.round(cappedTotal * 100) - foodPct : 0;

      return {
        name: nutrient,
        label,
        foodPct,
        suppPct,
        hasSupplement: rawSuppRatio > 0,
        overRda: combinedRatio > 1,
        usingAmounts,
      };
    });
  }, [meals, profile]);

  const hasEnoughData = hasEnoughDataForPatterns(meals);

  // Delegate to the single source of truth in digestEngine
  const gentleTargets = useMemo(() => computeGentleTargets(meals, profile), [meals, profile]);

  const sparklineData = useMemo(() => {
    return summarizeWeek(meals, 7).map((d) => ({
      dateKey: d.dateKey,
      calories: Math.round((d.totals.calories_min + d.totals.calories_max) / 2),
      hasData: d.totals.calories_max > 0,
    }));
  }, [meals]);

  const sparklineLoggedCount = useMemo(
    () => sparklineData.filter((d) => d.hasData).length,
    [sparklineData]
  );

  const sparklineChart = useMemo(() => {
    const DAYS = 7;
    const W = 320, H = 72;
    const padL = 20, padR = 20, padT = 8, padB = 4;
    const cW = W - padL - padR;
    const cH = H - padT - padB;
    const target = gentleTargets?.calories;
    const vals = sparklineData.map((d) => (d.hasData ? d.calories : null));
    const maxVal = Math.max(...(vals.filter((v) => v !== null) as number[]), target ? target * 1.25 : 0, 1500);
    const xPos = (i: number) => padL + (i / (DAYS - 1)) * cW;
    const yPos = (v: number) => padT + cH - (v / maxVal) * cH;
    // Solid segments for completed days (indices 0–5, excluding today at index 6)
    const segments: string[] = [];
    let cur = "";
    for (let i = 0; i < DAYS - 1; i++) {
      const v = vals[i];
      if (v === null) {
        if (cur) { segments.push(cur); cur = ""; }
      } else {
        cur += cur ? ` L${xPos(i).toFixed(1)} ${yPos(v).toFixed(1)}` : `M${xPos(i).toFixed(1)} ${yPos(v).toFixed(1)}`;
      }
    }
    if (cur) segments.push(cur);
    // Dashed segment bridging yesterday → today (index 6) if today has data
    const todayVal = vals[DAYS - 1];
    let todaySegment: string | null = null;
    if (todayVal !== null) {
      let lastIdx = -1;
      for (let i = DAYS - 2; i >= 0; i--) { if (vals[i] !== null) { lastIdx = i; break; } }
      if (lastIdx >= 0) {
        todaySegment = `M${xPos(lastIdx).toFixed(1)} ${yPos(vals[lastIdx]!).toFixed(1)} L${xPos(DAYS - 1).toFixed(1)} ${yPos(todayVal).toFixed(1)}`;
      }
    }
    return {
      W, H,
      segments,
      todaySegment,
      // labelLeftPct mirrors the SVG xPos so labels always align with dots
      dots: vals.map((v, i) => ({
        x: xPos(i),
        y: v !== null ? yPos(v) : padT + cH,
        logged: v !== null,
        isToday: i === DAYS - 1,
        labelLeftPct: (xPos(i) / W) * 100,
      })),
      targetY1: target ? yPos(target * 1.15) : null,
      targetY2: target ? yPos(target * 0.85) : null,
      hasTarget: !!target,
      targetRectX: 0,
      targetRectW: W,
    };
  }, [sparklineData, gentleTargets]);

  const gentleTargetsDisplay = gentleTargets;
  const displayAvgCalories = hasEnoughData ? `${avgCalories}` : isDemoMode ? "1,840" : "—";
  const displayAvgProtein = hasEnoughData ? `${avgProtein}g` : isDemoMode ? "148g" : "—";
  const displayAvgCarbs = hasEnoughData ? `${avgCarbs}g` : isDemoMode ? "180g" : "—";
  const displayAvgFat = hasEnoughData ? `${avgFat}g` : isDemoMode ? "62g" : "—";
  const displayEnergyPattern = hasEnoughData ? energyPattern : "Moderate intake pattern";
  const displayProteinPattern = hasEnoughData ? proteinPattern : "Moderate protein pattern";
  const displayFatPattern = hasEnoughData ? fatPattern : "Moderate fat pattern";

  const displayMicronutrients = hasEnoughData
    ? micronutrientPatterns
    : [
        { name: "Iron",      label: "Sometimes detected",  foodPct: 38, suppPct: 0,  hasSupplement: false, overRda: false },
        { name: "B12",       label: "Well covered",        foodPct: 62, suppPct: 18, hasSupplement: true,  overRda: false },
        { name: "Magnesium", label: "Rarely detected",     foodPct: 12, suppPct: 0,  hasSupplement: false, overRda: false },
        { name: "Zinc",      label: "Building pattern",    foodPct: 50, suppPct: 0,  hasSupplement: false, overRda: false },
        { name: "Vitamin D", label: "Well covered",        foodPct: 45, suppPct: 40, hasSupplement: true,  overRda: false },
        { name: "Calcium",   label: "Frequently detected", foodPct: 74, suppPct: 0,  hasSupplement: false, overRda: false },
        { name: "Omega-3",   label: "Rarely detected",     foodPct: 8,  suppPct: 0,  hasSupplement: false, overRda: false },
        { name: "Vitamin C", label: "Frequently detected", foodPct: 80, suppPct: 0,  hasSupplement: false, overRda: false },
        { name: "Potassium", label: "Sometimes detected",  foodPct: 32, suppPct: 0,  hasSupplement: false, overRda: false },
        { name: "Fiber",     label: "Building pattern",    foodPct: 48, suppPct: 0,  hasSupplement: false, overRda: false },
      ];

  const insightsTourSteps = [
    {
      target: '[data-tour="insights-energy"]',
      content: "View your average macros updated over time to give you pattern insights.",
      disableBeacon: true
    },
    {
      target: '[data-tour="insights-micro"]',
      content: "Micronutrient patterns emerge over time as you log more meals to help you improve general health.",
      disableBeacon: true
    },
    {
      target: '[data-tour="insights-i-icon"]',
      content: (
        <div style={{ textAlign: "center", padding: "8px 4px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "1px solid rgba(31,41,55,0.1)",
              color: "rgba(31,41,55,0.6)",
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 12,
              lineHeight: 1
            }}
          >
            i
          </div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "#1F2937" }}>
            Tap this icon anywhere in the app to learn more about that section.
          </p>
        </div>
      ),
      disableBeacon: true
    }
  ] as Step[];

  const handleInsightsTour = (data: CallBackProps) => {
    if (!user) return;
    if (data.status === STATUS.SKIPPED) {
      localStorage.removeItem(`wya_demo_mode_${user.id}`);
      setIsDemoMode(false);
      localStorage.setItem(`wya_walkthrough_${user.id}`, "true");
      localStorage.removeItem(`wya_walkthrough_active_${user.id}`);
      localStorage.removeItem(`wya_walkthrough_stage_${user.id}`);
      setRunInsightsTour(false);
      return;
    }
    if (data.type === "step:after" && data.index === insightsTourSteps.length - 1) {
      localStorage.removeItem(`wya_demo_mode_${user.id}`);
      setIsDemoMode(false);
      localStorage.setItem(`wya_walkthrough_${user.id}`, "true");
      localStorage.removeItem(`wya_walkthrough_active_${user.id}`);
      localStorage.removeItem(`wya_walkthrough_stage_${user.id}`);
      localStorage.setItem(`wya_walkthrough_profile_${user.id}`, "true");
      setRunInsightsTour(false);
      router.push("/profile");
    }
  };

  if (!user) return null;

  if (loadingData) {
    return (
      <div className="min-h-screen bg-surface">
        <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 pt-7">
          <div className="mb-6 h-8 w-24 animate-pulse rounded-lg bg-ink/10" />
          <div className="mb-4 animate-pulse rounded-2xl bg-ink/10 p-5" style={{ height: 120 }} />
          <div className="mb-4 animate-pulse rounded-2xl bg-ink/10 p-5" style={{ height: 120 }} />
          <div className="animate-pulse rounded-2xl bg-ink/10 p-5" style={{ height: 120 }} />
        </div>
        <BottomNav current="patterns" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-surface">
      <Joyride
        steps={insightsTourSteps}
        run={runInsightsTour && !loadingData}
        continuous
        showSkipButton
        hideCloseButton
        disableOverlayClose
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
      <div className={`mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 pt-7 ${trial.isFree && !isDemoMode ? "blur-sm pointer-events-none select-none" : ""}`}>
        <header className="mb-6" data-tour="insights-header">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Patterns</h1>
            <p className="mt-1 text-sm text-muted/70">Longer-term trends from your logged meals</p>
            {!hasEnoughData && !isDemoMode && (
              <div className="mt-2 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] text-primary/80">
                Log meals across 5 days to unlock real data
              </div>
            )}
          </div>
        </header>

        <Card data-tour="insights-energy">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-wide text-muted/70">Macros</p>
              {!hasEnoughData && <p className="text-[11px] uppercase tracking-wide text-muted/70">Preview</p>}
              <button
                type="button"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-ink/10 text-[10px] font-semibold text-ink/60"
                onClick={() => setActiveNutrient("Macros")}
                aria-label="About energy, protein, and fats"
              >
                i
              </button>
            </div>
            <p className="text-[11px] uppercase tracking-wide text-muted/70">Avg trend</p>
          </div>
          <div className={`mt-5 flex items-baseline justify-between${!hasEnoughData && !isDemoMode ? " opacity-50" : ""}`}>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/70">Calories</p>
              <p className="mt-1 text-xl font-semibold">{displayAvgCalories}</p>
              <p className="text-[10px] text-muted/70">Avg trend</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/70">Carbs</p>
              <p className="mt-1 text-xl font-semibold">{displayAvgCarbs}</p>
              <p className="text-[10px] text-muted/70">Avg trend</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/70">Fats</p>
              <p className="mt-1 text-xl font-semibold">{displayAvgFat}</p>
              <p className="text-[10px] text-muted/70">Avg trend</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/70">Protein</p>
              <p className="mt-1 text-xl font-semibold">{displayAvgProtein}</p>
              <p className="text-[10px] text-muted/70">Avg trend</p>
            </div>
          </div>
          {gentleTargetsDisplay ? (
            <p className="mt-4 text-xs text-muted/70">
              Suggested range: {gentleTargetsDisplay.calories} kcal · {Math.round(gentleTargetsDisplay.calories * 0.50 / 4)}g carbs · {Math.round(gentleTargetsDisplay.calories * 0.30 / 9)}g fat · {gentleTargetsDisplay.protein}g protein
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted/70">Complete your profile for a personalized range</p>
          )}
        </Card>

        <Card className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-muted/70">Daily Intake</p>
            <p className="text-[11px] text-muted/70">{sparklineLoggedCount} / 7 days</p>
          </div>
          <div className="mt-3">
            <svg viewBox={`0 0 ${sparklineChart.W} ${sparklineChart.H}`} preserveAspectRatio="none" className="w-full" style={{ height: sparklineChart.H, display: "block" }}>
              {sparklineChart.hasTarget && sparklineChart.targetY1 !== null && sparklineChart.targetY2 !== null && (
                <rect
                  x={sparklineChart.targetRectX}
                  y={sparklineChart.targetY1}
                  width={sparklineChart.targetRectW}
                  height={Math.max(0, sparklineChart.targetY2 - sparklineChart.targetY1)}
                  fill="rgba(111,168,255,0.22)"
                  rx={2}
                />
              )}
              {sparklineChart.segments.map((d, i) => (
                <path key={i} d={d} fill="none" stroke="rgba(111,168,255,0.75)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {sparklineChart.todaySegment && (
                <path d={sparklineChart.todaySegment} fill="none" stroke="rgba(111,168,255,0.4)" strokeWidth={1.5} strokeDasharray="3 3" strokeLinecap="round" />
              )}
              {sparklineChart.dots.map((dot, i) =>
                dot.isToday && dot.logged ? (
                  <circle key={i} cx={dot.x} cy={dot.y} r={3} fill="white" stroke="rgba(111,168,255,0.8)" strokeWidth={1.5} />
                ) : dot.logged ? (
                  <circle key={i} cx={dot.x} cy={dot.y} r={2.5} fill="rgba(111,168,255,1)" />
                ) : (
                  <circle key={i} cx={dot.x} cy={dot.y} r={1.5} fill="rgba(0,0,0,0.08)" />
                )
              )}
            </svg>
            <div className="relative mt-1" style={{ height: 14 }}>
              {sparklineData.map((d, i) => {
                const date = new Date(`${d.dateKey}T12:00:00`);
                return (
                  <span
                    key={d.dateKey}
                    className={`absolute -translate-x-1/2 text-[9px] ${d.hasData ? "text-ink/70" : "text-ink/45"}`}
                    style={{ left: `${sparklineChart.dots[i].labelLeftPct}%` }}
                  >
                    {["S","M","T","W","T","F","S"][date.getDay()]}
                  </span>
                );
              })}
            </div>
          </div>
          {sparklineChart.hasTarget && (
            <div className="mt-2 flex items-center gap-1.5">
              <div className="h-2 w-3 rounded-sm bg-primary/35" />
              <p className="text-[10px] text-muted/75">Target range</p>
            </div>
          )}
        </Card>


        {feelLogs.length > 0 && (
          <Card className="mt-3 py-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs uppercase tracking-wide text-muted/70">Energy</p>
              <div className="flex items-center gap-2.5">
                {[
                  { label: "Extra low", color: "rgba(71,85,105,0.65)" },
                  { label: "Low", color: "rgba(148,163,184,0.50)" },
                  { label: "Average", color: "rgba(111,168,255,0.45)" },
                  { label: "High", color: "rgba(111,168,255,0.9)" },
                ].map(({ label, color }) => (
                  <div key={label} className="flex items-center gap-1">
                    <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                    <p className="text-[9px] text-ink/60">{label}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative" style={{ height: 26 }}>
              {sparklineData.map((d, i) => {
                const entry = feelLogsByDay[d.dateKey];
                const isToday = i === sparklineData.length - 1;
                const score = entry?.avgScore ?? null;
                const dotColor = score === null
                  ? null
                  : score >= 3.5 ? "rgba(111,168,255,0.9)"
                  : score >= 2.5 ? "rgba(111,168,255,0.45)"
                  : score >= 1.5 ? "rgba(148,163,184,0.50)"
                  : "rgba(71,85,105,0.65)";
                const date = new Date(`${d.dateKey}T12:00:00`);
                return (
                  <div
                    key={d.dateKey}
                    className="absolute -translate-x-1/2 flex flex-col items-center gap-1.5"
                    style={{ left: `${sparklineChart.dots[i].labelLeftPct}%` }}
                  >
                    <div
                      className="rounded-full"
                      style={{
                        width: 10, height: 10,
                        backgroundColor: dotColor ?? "white",
                        border: dotColor ? "none" : "1.5px solid rgba(0,0,0,0.10)",
                      }}
                    />
                    <span className={`text-[9px] ${isToday ? "font-bold text-ink/80" : d.hasData ? "text-ink/70" : "text-ink/45"}`}>
                      {["S","M","T","W","T","F","S"][date.getDay()]}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        <Card className="mt-6" data-tour="insights-micro">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-muted/70" data-tour="insights-micro-title">
              Micronutrients
            </p>
            <div className="flex items-center gap-3">
              {!hasEnoughData && <p className="text-[11px] uppercase tracking-wide text-muted/70">Preview</p>}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <div className="h-2 w-4 rounded-sm bg-primary/70" />
                  <p className="text-[10px] text-muted/75">Food</p>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-2 w-4 rounded-sm bg-primary/35" />
                  <p className="text-[10px] text-muted/75">Supplements</p>
                </div>
              </div>
            </div>
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
                    data-tour={index === 0 ? "insights-i-icon" : undefined}
                  >
                    i
                  </button>
                </div>
                <div className="mt-2 h-2 rounded-full bg-ink/5 flex overflow-hidden isolate">
                  {/* Food segment — darker */}
                  <div
                    className="h-full shrink-0 bg-primary/70"
                    style={{
                      width: barsReady ? `${pattern.foodPct}%` : "0%",
                      transition: `width 600ms cubic-bezier(0.22,1,0.36,1) ${index * 55}ms`,
                    }}
                  />
                  {/* Supplement segment — lighter, only shown when dose data exists */}
                  {pattern.hasSupplement && (
                    <div
                      className="h-full shrink-0 bg-primary/35"
                      style={{
                        width: barsReady ? `${pattern.suppPct}%` : "0%",
                        transition: `width 600ms cubic-bezier(0.22,1,0.36,1) ${index * 55}ms`,
                      }}
                    />
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted/70">{pattern.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2 border-t border-ink/5 pt-4">
            <p className="text-xs text-muted/70">Each bar shows how much of your daily recommended amount you're getting. The darker segment is from food, the lighter is from supplements.</p>
            <p className="text-xs text-muted/70">Aim to build up the nutrients that are low. Logging more meals and adding supplements with doses will fill in the picture over time.</p>
          </div>
        </Card>
      </div>

      {/* Paywall overlay — fixed but stops above the nav so nav stays clickable */}
      {trial.isFree && (
        <div className="fixed inset-x-0 top-0 z-20 flex flex-col items-center justify-center px-8 text-center" style={{ bottom: "73px" }}>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink/8 mb-5">
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-ink/40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <p className="text-base font-semibold text-ink">Your patterns are ready</p>
          <p className="mt-2 text-sm text-muted/70 leading-relaxed max-w-xs">
            Upgrade to unlock your micronutrient trends, weekly averages, and what your body might be missing.
          </p>
          <button
            type="button"
            onClick={openUpgradeModal}
            className="mt-6 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white transition active:opacity-80"
          >
            Unlock Patterns
          </button>
        </div>
      )}

      <BottomNav current="patterns" />

      {activeNutrient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-ink">{activeNutrient}</p>
                {(() => {
                  const info = NUTRIENT_INFO[activeNutrient] ?? "Supports steady energy and overall balance.";
                  return Array.isArray(info) ? (
                    <ul className="mt-2 space-y-1.5 text-sm text-muted/70">
                      {info.map((item, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/40" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-muted/70">{info}</p>
                  );
                })()}
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
