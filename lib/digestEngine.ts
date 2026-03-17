import type { ActivityLevel, MealLog, UserProfile, WorkoutSession } from "./types";
import { summarizeDay, summarizeWeek, summarizeWorkoutsWeek } from "./summary";
import { dayKeyFromTs } from "./utils";
import { buildNutrientNotes, buildSuggestions, type SuggestionSignal } from "./recommendations";

type RecentItem =
  | { type: "meal"; ts: number; meal: MealLog }
  | { type: "workout"; ts: number; workout: WorkoutSession };

function dayCountFromMeals(meals: MealLog[]) {
  const days = new Set(meals.map((meal) => dayKeyFromTs(meal.ts)));
  return days.size;
}

function computeStreak(meals: MealLog[]): number {
  const dayKeys = new Set(meals.map((m) => dayKeyFromTs(m.ts)));
  let streak = 0;
  const d = new Date();
  // Don't break streak mid-day if no meal logged yet today
  if (!dayKeys.has(dayKeyFromTs(d.getTime()))) {
    d.setDate(d.getDate() - 1);
  }
  while (dayKeys.has(dayKeyFromTs(d.getTime()))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function avgRangeMidpoint(mins: number[], maxes: number[]) {
  if (!mins.length || !maxes.length) return 0;
  const total = mins.reduce((sum, v) => sum + v, 0) + maxes.reduce((sum, v) => sum + v, 0);
  return Math.round(total / (mins.length + maxes.length));
}

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
};

const PROTEIN_PER_KG: Record<ActivityLevel, number> = {
  sedentary: 1.4,
  lightly_active: 1.6,
  moderately_active: 1.8,
  very_active: 2.1,
};

export function proteinTargetPerKg(profile: UserProfile): number {
  const base = profile.activityLevel ? (PROTEIN_PER_KG[profile.activityLevel] ?? 1.8) : 1.8;
  if (profile.goalDirection === "gain") return base + 0.2;
  if (profile.goalDirection === "lose") return Math.max(1.4, base - 0.1);
  return base;
}

/** Mifflin-St Jeor TDEE estimate. Returns null if profile is missing required fields.
 *  For unknown/non-binary sex, uses the midpoint of male and female BMR formulas. */
export function estimateMaintenance(profile: UserProfile): number | null {
  const { weight, height, age, sex, activityLevel } = profile;
  if (!weight || !height || !age) return null;
  let bmr: number;
  if (sex === "male") {
    bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  } else if (sex === "female") {
    bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  } else {
    // Use midpoint of male/female for "other" or "prefer_not"
    const maleBmr = 10 * weight + 6.25 * height - 5 * age + 5;
    const femaleBmr = 10 * weight + 6.25 * height - 5 * age - 161;
    bmr = (maleBmr + femaleBmr) / 2;
  }
  const multiplier = activityLevel ? (ACTIVITY_MULTIPLIERS[activityLevel] ?? 1.375) : 1.375;
  return Math.round(bmr * multiplier);
}

function computeGentleTargets(meals: MealLog[], profile?: UserProfile) {
  if (!profile) return null;
  const dayCount = dayCountFromMeals(meals);
  const mealCount = meals.length;
  const goal = profile.goalDirection;
  const weight = profile.weight ?? 0;
  const calNudge = goal === "gain" ? 0.08 : goal === "lose" ? -0.08 : 0;

  // Early estimate: use Mifflin-St Jeor before enough meal data exists
  if (dayCount < 5 || mealCount < 10) {
    const maintenance = estimateMaintenance(profile);
    if (!maintenance) return null;
    const suggestedCalories = Math.round(maintenance * (1 + calNudge));
    const proteinTarget = weight ? Math.round(weight * proteinTargetPerKg(profile)) : Math.round(suggestedCalories * 0.15 / 4);
    return { calories: suggestedCalories, protein: proteinTarget, isEstimate: true };
  }

  const weekSummary = summarizeWeek(meals, 7);
  const avgWeekCalories = avgRangeMidpoint(
    weekSummary.map((d) => d.totals.calories_min),
    weekSummary.map((d) => d.totals.calories_max)
  );
  const avgWeekProtein = avgRangeMidpoint(
    weekSummary.map((d) => d.totals.protein_g_min),
    weekSummary.map((d) => d.totals.protein_g_max)
  );
  if (!avgWeekCalories && !avgWeekProtein) return null;

  const suggestedCalories = Math.max(0, Math.round(avgWeekCalories * (1 + calNudge)));
  const proteinTarget = weight ? weight * proteinTargetPerKg(profile) : 0;
  const proteinNudge = proteinTarget
    ? avgWeekProtein + Math.round((proteinTarget - avgWeekProtein) * 0.1)
    : avgWeekProtein;

  return { calories: suggestedCalories, protein: Math.round(proteinNudge) };
}

const BURN_KCAL_PER_MIN: Record<string, number> = { low: 4, medium: 7, high: 10 };

function adjustTargetsForWorkouts(
  targets: { calories: number; protein: number } | null,
  workouts: WorkoutSession[]
) {
  if (!targets || workouts.length === 0) return targets;

  // Same-day burn: add estimated kcal burned by workouts logged today
  const todayDayKey = dayKeyFromTs(Date.now());
  const sameDayBurn = workouts
    .filter((w) => dayKeyFromTs(w.endTs ?? w.startTs) === todayDayKey)
    .reduce((sum, w) => {
      const mins = w.durationMin ?? 0;
      const rate = BURN_KCAL_PER_MIN[w.intensity ?? "medium"] ?? 7;
      return sum + mins * rate;
    }, 0);

  // Weekly volume adjustment: only kicks in at >= 3 workouts in 7 days
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = workouts.filter((workout) => (workout.endTs ?? workout.startTs) >= cutoff);
  let weeklyFactor = 0;
  if (recent.length >= 3) {
    const intensityScore = recent.reduce((sum, workout) => {
      if (workout.intensity === "high") return sum + 2;
      if (workout.intensity === "medium" || !workout.intensity) return sum + 1;
      return sum;
    }, 0);
    if (intensityScore > 0) weeklyFactor = intensityScore >= 4 ? 0.08 : 0.04;
  }

  if (!weeklyFactor && !sameDayBurn) return targets;
  return {
    ...targets,
    calories: Math.round(targets.calories * (1 + weeklyFactor) + sameDayBurn),
    protein: Math.round(targets.protein * (1 + weeklyFactor * 0.6))
  };
}

export function computeRecent(meals: MealLog[], workouts: WorkoutSession[]) {
  const items: RecentItem[] = [
    ...meals.map((meal) => ({ type: "meal" as const, ts: meal.ts, meal })),
    ...workouts.filter((w) => w.endTs != null).map((workout) => ({
      type: "workout" as const,
      // Floor to second so old ms-precision rows don't sort above newer second-precision rows
      ts: Math.floor((workout.endTs ?? workout.startTs) / 1000) * 1000,
      workout
    }))
  ];
  return items.sort((a, b) => {
    const diff = b.ts - a.ts;
    if (diff !== 0) return diff;
    // Tiebreaker: newer startTs wins (handles equal-second endTs from ms vs seconds storage)
    const aStart = a.type === "workout" ? a.workout.startTs : 0;
    const bStart = b.type === "workout" ? b.workout.startTs : 0;
    return bStart - aStart;
  });
}

export function computeHomeMarkers(meals: MealLog[], workouts: WorkoutSession[], profile?: UserProfile) {
  const todayTotals = summarizeDay(meals);
  const weekSummary = summarizeWeek(meals, 7);
  const dayCount = dayCountFromMeals(meals);
  const mealCount = meals.length;
  const recent = computeRecent(meals, workouts);

  const avgWeekCalories = avgRangeMidpoint(
    weekSummary.map((d) => d.totals.calories_min),
    weekSummary.map((d) => d.totals.calories_max)
  );
  const avgWeekProtein = avgRangeMidpoint(
    weekSummary.map((d) => d.totals.protein_g_min),
    weekSummary.map((d) => d.totals.protein_g_max)
  );

  const gentleTargets = adjustTargetsForWorkouts(computeGentleTargets(meals, profile), workouts);
  const streak = computeStreak(meals);

  return {
    todayTotals,
    weekSummary,
    dayCount,
    mealCount,
    gentleTargets,
    avgWeekCalories,
    avgWeekProtein,
    recent,
    streak
  };
}

export function computeSummaryMarkers(meals: MealLog[], workouts: WorkoutSession[], profile?: UserProfile) {
  const todayTotals = summarizeDay(meals);
  const weekSummary = summarizeWeek(meals, 7);
  const workoutSummary = summarizeWorkoutsWeek(workouts);
  const dayCount = dayCountFromMeals(meals);
  const mealCount = meals.length;

  const avgWeekCalories = avgRangeMidpoint(
    weekSummary.map((d) => d.totals.calories_min),
    weekSummary.map((d) => d.totals.calories_max)
  );
  const avgWeekProtein = avgRangeMidpoint(
    weekSummary.map((d) => d.totals.protein_g_min),
    weekSummary.map((d) => d.totals.protein_g_max)
  );

  const gentleTargets = adjustTargetsForWorkouts(computeGentleTargets(meals, profile), workouts);

  const nutrientTrends = (() => {
    if (dayCount < 5 || mealCount < 10) return [];
    const trends: string[] = [];
    const signals = meals
      .filter((meal) => Date.now() - meal.ts <= 30 * 24 * 60 * 60 * 1000)
      .flatMap((meal) => meal.analysisJson.micronutrient_signals ?? []);
    const lowSignals = signals.filter((signal) => signal.signal === "low_appearance");
    const lowNames = new Set(lowSignals.map((signal) => signal.nutrient.toLowerCase()));
    if (lowNames.has("iron")) trends.push("Likely low iron.");
    if (lowNames.has("fiber")) trends.push("Low fiber trend.");
    if (profile?.goalDirection === "gain") {
      const weight = profile.weight ?? 0;
      const proteinTarget = weight ? weight * proteinTargetPerKg(profile) : 0;
      if (proteinTarget && avgWeekProtein < proteinTarget * 0.8) {
        trends.push("Protein below weight‑gain target.");
      }
    }
    if (lowNames.has("b12") || lowNames.has("vitamin b12")) {
      trends.push("Low B12 if vegetarian.");
    }
    return Array.from(new Set(trends)).slice(0, 4);
  })();

  const nutrientNotes = buildNutrientNotes(meals);

  let fuelingState: "under" | "adequate" | "over" = "adequate";
  if (gentleTargets?.calories) {
    const todayMid = Math.round((todayTotals.calories_min + todayTotals.calories_max) / 2);
    if (todayMid && todayMid < gentleTargets.calories * 0.85) fuelingState = "under";
    if (todayMid && todayMid > gentleTargets.calories * 1.15) fuelingState = "over";
  }

  let suggestionSignal: SuggestionSignal = "balanced";
  if (fuelingState === "under") {
    const proteinTarget = gentleTargets?.protein ?? 0;
    if (proteinTarget && avgWeekProtein < proteinTarget * 0.8) {
      suggestionSignal = "protein";
    } else {
      suggestionSignal = "calorie";
    }
  }
  const suggestions = buildSuggestions(meals, profile, suggestionSignal);

  return {
    todayTotals,
    weekSummary,
    workoutSummary,
    dayCount,
    mealCount,
    avgWeekCalories,
    avgWeekProtein,
    gentleTargets,
    nutrientTrends,
    suggestions,
    nutrientNotes,
    fuelingState
  };
}

// Picks a variant by day-of-month so messages rotate daily but stay stable within a day
function pickVariant(variants: string[]): string {
  return variants[new Date().getDate() % variants.length];
}

export function computeNudges(meals: MealLog[], workouts: WorkoutSession[], profile?: UserProfile) {
  if (meals.length < 5) return [];

  const dayCount = dayCountFromMeals(meals);
  const mealCount = meals.length;
  const weekSummary = summarizeWeek(meals, 7);
  const avgWeekCalories = avgRangeMidpoint(
    weekSummary.map((d) => d.totals.calories_min),
    weekSummary.map((d) => d.totals.calories_max)
  );
  const avgWeekProtein = avgRangeMidpoint(
    weekSummary.map((d) => d.totals.protein_g_min),
    weekSummary.map((d) => d.totals.protein_g_max)
  );
  const todayTotals = summarizeDay(meals);

  type ScoredNudge = { message: string; priority: number };
  const nudges: ScoredNudge[] = [];
  const focus = (profile?.freeformFocus ?? profile?.bodyPriority ?? "").toLowerCase();
  const calorieBias = focus.includes("energy") ? 1 : 0;
  const proteinBias = focus.includes("strength") || focus.includes("performance") ? 1 : 0;
  const microBias = focus.includes("longevity") ? 1 : 0;

  const gentleTargets = computeGentleTargets(meals, profile);
  if (profile && dayCount >= 5 && mealCount >= 5 && avgWeekCalories && gentleTargets?.calories) {
    const todayMid = Math.round((todayTotals.calories_min + todayTotals.calories_max) / 2);
    const hasToday = todayMid > 0;
    const isDayMostlyOver = new Date().getHours() >= 18;
    const todayLow = hasToday && isDayMostlyOver && todayMid < gentleTargets.calories * 0.85;
    const todayHigh = hasToday && isDayMostlyOver && todayMid > gentleTargets.calories * 1.15;
    const weekLow = avgWeekCalories < gentleTargets.calories * 0.9;
    const weekHigh = avgWeekCalories > gentleTargets.calories * 1.1;
    if (todayLow && weekLow) {
      nudges.push({
        message: calorieBias
          ? "Energy intake is trending lighter this week — may affect your energy levels."
          : pickVariant([
            "Energy intake is trending lighter than your recent range.",
            "Intake has been running a bit lighter than usual this week.",
            "Calorie intake has been on the lighter side recently."
          ]),
        priority: 2 + calorieBias
      });
    } else if (todayHigh && weekHigh) {
      nudges.push({
        message: calorieBias
          ? "Energy intake is trending fuller this week — may be worth easing back slightly."
          : pickVariant([
            "Energy intake is trending fuller than your recent range.",
            "Intake is running a bit higher than your recent pattern.",
            "Calorie intake has been on the fuller side this week."
          ]),
        priority: 2 + calorieBias
      });
    }
  }

  if (profile && avgWeekProtein) {
    const target = (profile.weight ?? 0) * proteinTargetPerKg(profile);
    if (target && avgWeekProtein < target * 0.7) {
      nudges.push({
        message: proteinBias
          ? "Protein has been running low this week — worth prioritizing for your strength goals."
          : pickVariant([
            "Noticed protein below your goal range. Consider a small add.",
            "Protein has been running low this week. A small boost may help.",
            "Protein intake is well below your goal range. Worth adding a source."
          ]),
        priority: 3 + proteinBias
      });
    } else if (target && avgWeekProtein < target * 0.85) {
      nudges.push({
        message: proteinBias
          ? "Protein is a bit short this week — a small add supports your strength goals."
          : pickVariant([
            "Noticed protein slightly below your goal range. Consider a small add.",
            "Protein is a bit short of your target this week. A small add may help.",
            "Protein is trending slightly under your goal. Easy to close the gap."
          ]),
        priority: 2 + proteinBias
      });
    } else if (target && avgWeekProtein < target * 0.95) {
      nudges.push({
        message: proteinBias
          ? "Protein is close to target — a small add would round it out for your strength goals."
          : pickVariant([
            "Noticed protein near the lower edge of your goal range. A small add may help.",
            "Protein is just under your goal range. A small source could fill it.",
            "Protein is close but slightly below target. A small add would do it."
          ]),
        priority: 1 + proteinBias
      });
    }
  }

  const recentWorkoutCount = workouts.filter((w) => Date.now() - (w.endTs ?? w.startTs) <= 7 * 24 * 60 * 60 * 1000).length;

  // Activity-level nudges
  if (profile?.activityLevel === "very_active" || profile?.activityLevel === "moderately_active") {
    if (recentWorkoutCount === 0 && mealCount >= 10) {
      nudges.push({
        message: pickVariant([
          "No workouts logged this week — don't forget to track your sessions.",
          "Workouts haven't been logged this week. Remember to track your sessions.",
          "No sessions logged yet this week. Don't forget to record your workouts."
        ]),
        priority: 1
      });
    } else if (recentWorkoutCount >= 1 && gentleTargets?.calories && avgWeekCalories < gentleTargets.calories * 0.9) {
      nudges.push({
        message: pickVariant([
          "You've been active this week but intake is running a bit light — worth fueling a little more.",
          "Active week, but energy intake has been on the lighter side. A bit more fuel may help.",
          "Solid activity this week — intake may be a little light to match your output."
        ]),
        priority: 2
      });
    }
  }

  const signals = meals
    .filter((meal) => Date.now() - meal.ts <= 30 * 24 * 60 * 60 * 1000)
    .flatMap((meal) => meal.analysisJson.micronutrient_signals ?? []);
  const lowSignals = signals.filter((signal) => signal.signal === "low_appearance");
  if (lowSignals.length) {
    const counts = new Map<string, number>();
    lowSignals.forEach((signal) => {
      const key = String(signal.nutrient || "").toLowerCase();
      if (!key) return;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    counts.forEach((count, nutrient) => {
      if (count >= 3) {
        nudges.push({
          message: microBias
            ? `Fewer ${nutrient}-rich foods lately — worth adding one to support long-term health.`
            : pickVariant([
              `Noticed fewer ${nutrient}-rich foods. Consider a small add.`,
              `Fewer ${nutrient} sources in the pattern lately. Worth adding one.`,
              `${nutrient.charAt(0).toUpperCase() + nutrient.slice(1)}-rich foods have been less common lately. A small add may help.`
            ]),
          priority: 1 + microBias
        });
      }
    });
  }

  if (
    gentleTargets?.calories &&
    recentWorkoutCount >= 2 &&
    avgWeekCalories < gentleTargets.calories * 0.9
  ) {
    nudges.push({
      message: "Noticed solid training volume. Fueling may be slightly lighter than usual.",
      priority: 2
    });
  }

  const unique = new Set<string>();
  const sorted = nudges
    .sort((a, b) => b.priority - a.priority)
    .filter((item) => {
      if (unique.has(item.message)) return false;
      unique.add(item.message);
      return true;
    });

  // Only show a second nudge if it's meaningfully strong (priority >= 2).
  // Prevents a low-priority filler from padding a single strong signal.
  const capped = sorted.length > 1 && sorted[1].priority < 2
    ? sorted.slice(0, 1)
    : sorted.slice(0, 2);

  return capped.map((item) => item.message);
}
