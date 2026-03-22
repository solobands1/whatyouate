import type { ActivityLevel, MealLog, Units, UserProfile, WorkoutSession } from "./types";
import { summarizeDay, summarizeLoggedDays, summarizeWeek, summarizeWorkoutsWeek } from "./summary";
import { dayKeyFromTs } from "./utils";
import { buildNutrientNotes, buildSuggestions, type SuggestionSignal } from "./recommendations";

export type NudgeType =
  | "calorie_low" | "calorie_high"
  | "protein_low_critical" | "protein_low"
  | "workout_missing" | "workout_fuel_low" | "training_fuel_low"
  | "micronutrient" | "fat_low" | "on_track";

export interface NudgeData {
  actual?: number;
  target?: number;
  nutrient?: string;
}

export interface ComputedNudge {
  message: string;
  type: NudgeType;
  data: NudgeData;
}

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

/** Return the stored weight value in kilograms.
 *  ProfileScreen always converts lbs → kg before persisting, so the database
 *  stores kg for ALL users regardless of their display-unit preference.
 *  No runtime conversion is needed here. */
export function normalizeWeightToKg(weight: number, _units: Units): number {
  return weight;
}

/** Mifflin-St Jeor TDEE estimate. Returns null if profile is missing required fields.
 *  For unknown/non-binary sex, uses the midpoint of male and female BMR formulas. */
export function estimateMaintenance(profile: UserProfile): number | null {
  const { height, age, sex, activityLevel } = profile;
  if (!profile.weight || !height || !age) return null;
  const weight = normalizeWeightToKg(profile.weight, profile.units);
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

export function computeGentleTargets(meals: MealLog[], profile?: UserProfile) {
  if (!profile) return null;
  const dayCount = dayCountFromMeals(meals);
  const mealCount = meals.length;
  const goal = profile.goalDirection;
  const rawWeight = profile.weight ?? 0;
  const weight = rawWeight ? normalizeWeightToKg(rawWeight, profile.units) : 0;
  const calNudge = goal === "gain" ? 0.08 : goal === "lose" ? -0.08 : 0;

  // Early estimate: use Mifflin-St Jeor before enough meal data exists
  if (dayCount < 5 || mealCount < 10) {
    const maintenance = estimateMaintenance(profile);
    if (!maintenance) return null;
    const suggestedCalories = Math.round(maintenance * (1 + calNudge));
    const proteinTarget = weight ? Math.round(weight * proteinTargetPerKg(profile)) : Math.round(suggestedCalories * 0.15 / 4);
    return { calories: suggestedCalories, protein: proteinTarget, isEstimate: true };
  }

  // Established path: anchor calories to TDEE to prevent targets from drifting down
  // toward current intake. Fall back to logged-data average only if TDEE unavailable.
  const loggedDays = summarizeLoggedDays(meals, 7);
  const avgLoggedCalories = avgRangeMidpoint(
    loggedDays.map((d) => d.totals.calories_min),
    loggedDays.map((d) => d.totals.calories_max)
  );
  const avgLoggedProtein = avgRangeMidpoint(
    loggedDays.map((d) => d.totals.protein_g_min),
    loggedDays.map((d) => d.totals.protein_g_max)
  );
  if (!avgLoggedCalories && !avgLoggedProtein) return null;

  const maintenance = estimateMaintenance(profile);
  const suggestedCalories = maintenance
    ? Math.round(maintenance * (1 + calNudge))
    : Math.max(0, Math.round(avgLoggedCalories * (1 + calNudge)));
  const proteinTarget = weight ? weight * proteinTargetPerKg(profile) : 0;
  const proteinNudge = proteinTarget
    ? avgLoggedProtein + Math.round((proteinTarget - avgLoggedProtein) * 0.1)
    : avgLoggedProtein;

  return { calories: suggestedCalories, protein: Math.round(proteinNudge), isEstimate: false };
}

const BURN_KCAL_PER_MIN: Record<string, number> = { low: 4, medium: 7, high: 10 };

function adjustTargetsForWorkouts(
  targets: { calories: number; protein: number; isEstimate?: boolean } | null,
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

  // Use logged-days-only averages so empty days don't deflate the numbers
  const loggedDays = summarizeLoggedDays(meals, 7);
  const avgWeekCalories = avgRangeMidpoint(
    loggedDays.map((d) => d.totals.calories_min),
    loggedDays.map((d) => d.totals.calories_max)
  );
  const avgWeekProtein = avgRangeMidpoint(
    loggedDays.map((d) => d.totals.protein_g_min),
    loggedDays.map((d) => d.totals.protein_g_max)
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

  // Use logged-days-only averages so empty days don't deflate the numbers
  const loggedDays = summarizeLoggedDays(meals, 7);
  const avgWeekCalories = avgRangeMidpoint(
    loggedDays.map((d) => d.totals.calories_min),
    loggedDays.map((d) => d.totals.calories_max)
  );
  const avgWeekProtein = avgRangeMidpoint(
    loggedDays.map((d) => d.totals.protein_g_min),
    loggedDays.map((d) => d.totals.protein_g_max)
  );
  const avgWeekFat = avgRangeMidpoint(
    loggedDays.map((d) => d.totals.fat_g_min),
    loggedDays.map((d) => d.totals.fat_g_max)
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
      const rawW = profile.weight ?? 0;
      const weight = rawW ? normalizeWeightToKg(rawW, profile.units) : 0;
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

  // Protein signal takes priority regardless of calorie state — so protein nudges
  // get protein-rich food suggestions even when overall calories are adequate.
  let suggestionSignal: SuggestionSignal = "balanced";
  const weekProteinTarget = gentleTargets?.protein ?? 0;
  if (weekProteinTarget && avgWeekProtein < weekProteinTarget * 0.85) {
    suggestionSignal = "protein";
  } else if (fuelingState === "under") {
    suggestionSignal = "calorie";
  } else if (avgWeekCalories > 800 && avgWeekFat > 0) {
    const fatTarget = (avgWeekCalories * 0.3) / 9;
    if (avgWeekFat < fatTarget * 0.7) suggestionSignal = "fat";
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

// Picks a variant by ISO week number so messages rotate weekly
function pickWeekly(variants: string[]): string {
  const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  return variants[week % variants.length];
}

export function computeNudges(meals: MealLog[], workouts: WorkoutSession[], profile?: UserProfile) {
  if (meals.length < 5) return [];

  const dayCount = dayCountFromMeals(meals);
  const mealCount = meals.length;
  // Use logged-days-only averages so un-logged days don't deflate numbers
  const loggedDays = summarizeLoggedDays(meals, 7);
  const avgWeekCalories = avgRangeMidpoint(
    loggedDays.map((d) => d.totals.calories_min),
    loggedDays.map((d) => d.totals.calories_max)
  );
  const avgWeekProtein = avgRangeMidpoint(
    loggedDays.map((d) => d.totals.protein_g_min),
    loggedDays.map((d) => d.totals.protein_g_max)
  );
  const avgWeekFat = avgRangeMidpoint(
    loggedDays.map((d) => d.totals.fat_g_min),
    loggedDays.map((d) => d.totals.fat_g_max)
  );
  const todayTotals = summarizeDay(meals);

  type ScoredNudge = { message: string; priority: number; type: NudgeType; data: NudgeData };
  const nudges: ScoredNudge[] = [];
  const focus = (profile?.freeformFocus ?? profile?.bodyPriority ?? "").toLowerCase();
  const calorieBias = focus.includes("energy") ? 1 : 0;
  const proteinBias = focus.includes("strength") || focus.includes("performance") ? 1 : 0;
  const microBias = focus.includes("longevity") ? 1 : 0;

  // Adjust targets for workouts — mirrors what computeSummaryMarkers and computeHomeMarkers do
  const gentleTargets = adjustTargetsForWorkouts(computeGentleTargets(meals, profile), workouts);
  const isEstimateTargets = gentleTargets?.isEstimate ?? false;
  if (profile && dayCount >= 5 && mealCount >= 5 && avgWeekCalories && gentleTargets?.calories) {
    const weekLow = avgWeekCalories < gentleTargets.calories * 0.9;
    const weekHigh = avgWeekCalories > gentleTargets.calories * 1.1;
    if (weekLow) {
      nudges.push({
        message: isEstimateTargets
          ? `You've been averaging around ${Math.round(avgWeekCalories)} kcal a day this week • based on your profile, we'd estimate closer to ${gentleTargets.calories} kcal`
          : `You've been averaging around ${Math.round(avgWeekCalories)} kcal a day this week • your target is closer to ${gentleTargets.calories} kcal`,
        type: "calorie_low",
        data: { actual: Math.round(avgWeekCalories), target: gentleTargets.calories },
        priority: 2 + calorieBias
      });
    } else if (weekHigh) {
      nudges.push({
        message: isEstimateTargets
          ? `You've been averaging around ${Math.round(avgWeekCalories)} kcal a day this week • based on your profile, we'd estimate closer to ${gentleTargets.calories} kcal`
          : `You've been averaging around ${Math.round(avgWeekCalories)} kcal a day this week • your target is around ${gentleTargets.calories} kcal`,
        type: "calorie_high",
        data: { actual: Math.round(avgWeekCalories), target: gentleTargets.calories },
        priority: 2 + calorieBias
      });
    }
  }

  if (profile && avgWeekProtein) {
    const rawW = profile.weight ?? 0;
    const weightKg = rawW ? normalizeWeightToKg(rawW, profile.units) : 0;
    const target = weightKg ? weightKg * proteinTargetPerKg(profile) : 0;
    if (target && avgWeekProtein < target * 0.7) {
      nudges.push({
        message: isEstimateTargets
          ? `You've been averaging around ${Math.round(avgWeekProtein)}g of protein a day this week • based on your weight, your goal would be around ${Math.round(target)}g`
          : `You've been averaging around ${Math.round(avgWeekProtein)}g of protein a day this week • your goal is closer to ${Math.round(target)}g`,
        type: "protein_low_critical",
        data: { actual: Math.round(avgWeekProtein), target: Math.round(target) },
        priority: 3 + proteinBias
      });
    } else if (target && avgWeekProtein < target * 0.85) {
      nudges.push({
        message: isEstimateTargets
          ? `You've been averaging around ${Math.round(avgWeekProtein)}g of protein a day this week • based on your weight, your goal would be around ${Math.round(target)}g`
          : `You've been averaging around ${Math.round(avgWeekProtein)}g of protein a day this week • your goal is closer to ${Math.round(target)}g`,
        type: "protein_low",
        data: { actual: Math.round(avgWeekProtein), target: Math.round(target) },
        priority: 2 + proteinBias
      });
    }
  }

  const recentWorkoutCount = workouts.filter((w) => Date.now() - (w.endTs ?? w.startTs) <= 7 * 24 * 60 * 60 * 1000).length;

  // Activity-level nudges
  let workoutFuelNudgePushed = false;
  if (profile?.activityLevel === "very_active" || profile?.activityLevel === "moderately_active") {
    if (recentWorkoutCount === 0 && mealCount >= 10) {
      nudges.push({
        message: "Looks like no workouts have been logged this week • if you've been training, make sure you're tracking your sessions",
        type: "workout_missing",
        data: {},
        priority: 1
      });
    } else if (recentWorkoutCount >= 1 && gentleTargets?.calories && avgWeekCalories < gentleTargets.calories * 0.9) {
      nudges.push({
        message: `You've been putting in some solid sessions this week • food intake is sitting around ${Math.round(avgWeekCalories)} kcal, which looks a bit light for what you're putting out`,
        type: "workout_fuel_low",
        data: { actual: Math.round(avgWeekCalories), target: gentleTargets?.calories },
        priority: 2
      });
      workoutFuelNudgePushed = true;
    }
  }

  // Micronutrient nudges — require low signal across 3+ distinct days (not just 3 meals)
  const signalsWithTs = meals
    .filter((meal) => Date.now() - meal.ts <= 30 * 24 * 60 * 60 * 1000)
    .flatMap((meal) => (meal.analysisJson.micronutrient_signals ?? []).map((s) => ({ ...s, ts: meal.ts })));
  const lowSignals = signalsWithTs.filter((s) => s.signal === "low_appearance");
  if (lowSignals.length) {
    const dayCounts = new Map<string, Set<string>>();
    lowSignals.forEach((signal) => {
      const key = String(signal.nutrient || "").toLowerCase();
      if (!key) return;
      if (!dayCounts.has(key)) dayCounts.set(key, new Set());
      dayCounts.get(key)!.add(dayKeyFromTs(signal.ts));
    });
    dayCounts.forEach((days, nutrient) => {
      if (days.size >= 3) {
        nudges.push({
          message: `Looks like ${nutrient} has been a bit low across your recent meals • it's one of those things that's easy to miss until it adds up`,
          type: "micronutrient",
          data: { nutrient },
          priority: 1 + microBias
        });
      }
    });
  }

  // Training fuel — only fires if workout_fuel_low hasn't already (prevents duplicate)
  // Also requires an active activity level, matching the workout_fuel_low guard
  if (
    !workoutFuelNudgePushed &&
    (profile?.activityLevel === "very_active" || profile?.activityLevel === "moderately_active") &&
    gentleTargets?.calories &&
    recentWorkoutCount >= 2 &&
    avgWeekCalories < gentleTargets.calories * 0.9
  ) {
    nudges.push({
      message: `Solid training week • you've been eating around ${Math.round(avgWeekCalories)} kcal on average, which might be a bit light for the effort you're putting in`,
      type: "training_fuel_low",
      data: { actual: Math.round(avgWeekCalories), target: gentleTargets?.calories },
      priority: 2
    });
  }

  // Fat nudge — only if calories aren't already flagged low (low fat is expected with low calories)
  const calorieLowFired = nudges.some((n) => n.type === "calorie_low");
  if (profile && avgWeekCalories > 800 && avgWeekFat > 0 && !calorieLowFired) {
    const fatTarget = (avgWeekCalories * 0.3) / 9;
    if (avgWeekFat < fatTarget * 0.7) {
      nudges.push({
        message: `Fat intake has been around ${Math.round(avgWeekFat)}g a day this week • healthy fats support hormones, brain function, and vitamin absorption`,
        type: "fat_low",
        data: { actual: Math.round(avgWeekFat), target: Math.round(fatTarget) },
        priority: 1
      });
    }
  }

  // On-track — fires only when no other nudges found and there's enough meaningful data
  if (nudges.length === 0 && profile?.weight && dayCount >= 5 && avgWeekCalories > 0) {
    nudges.push({
      message: pickWeekly([
        "Intake is looking solid this week",
        "Your numbers are in a good place this week",
        "Things are tracking well this week",
      ]),
      type: "on_track",
      data: {},
      priority: 0
    });
  }

  const unique = new Set<string>();
  const seenTypes = new Set<NudgeType>();
  const sorted = nudges
    .sort((a, b) => b.priority - a.priority)
    .filter((item) => {
      if (unique.has(item.message)) return false;
      // Only one nudge per type — prevents duplicate cards with identical why/action copy
      if (seenTypes.has(item.type)) return false;
      unique.add(item.message);
      seenTypes.add(item.type);
      return true;
    });

  // Only show a second nudge if it's meaningfully strong (priority >= 2).
  // Prevents a low-priority filler from padding a single strong signal.
  const capped = sorted.length > 1 && sorted[1].priority < 2
    ? sorted.slice(0, 1)
    : sorted.slice(0, 2);

  return capped.map(({ message, type, data }) => ({ message, type, data }));
}
