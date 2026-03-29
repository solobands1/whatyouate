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
  daysLow?: number;
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

export function computeStreakFromMeals(meals: MealLog[]): number {
  const dayKeys = new Set(
    meals.filter((m) => m.analysisJson?.source !== "supplement").map((m) => dayKeyFromTs(m.ts))
  );
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
  if (profile.goalDirection === "gain") return base + 0.4;
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
  const loggedDays = summarizeLoggedDays(meals, 7, true);
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

  return { calories: suggestedCalories, protein: proteinTarget ? Math.round(proteinTarget) : Math.round(avgLoggedProtein), isEstimate: false };
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
  const loggedDays = summarizeLoggedDays(meals, 7, true);
  const avgWeekCalories = avgRangeMidpoint(
    loggedDays.map((d) => d.totals.calories_min),
    loggedDays.map((d) => d.totals.calories_max)
  );
  const avgWeekProtein = avgRangeMidpoint(
    loggedDays.map((d) => d.totals.protein_g_min),
    loggedDays.map((d) => d.totals.protein_g_max)
  );

  const gentleTargets = adjustTargetsForWorkouts(computeGentleTargets(meals, profile), workouts);
  // Use persisted streak from profile if available — it's accurate beyond the fetch window.
  // Fall back to in-memory computation for users who don't have it stored yet.
  const streak = profile?.streak ?? computeStreakFromMeals(meals);

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
  const loggedDays = summarizeLoggedDays(meals, 7, true);
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

  const hour = new Date().getHours();
  const isMorning = hour < 12;
  // Afternoon window: 3pm-8pm unlocks a second, today-aware nudge
  const isAfternoon = hour >= 15 && hour < 20;
  const maxNudges = isAfternoon ? 2 : 1;

  // Today's running totals (used for afternoon today-slot nudges)
  const todayTotals = summarizeDay(meals);
  const todayProteinMid = Math.round((todayTotals.protein_g_min + todayTotals.protein_g_max) / 2);
  const todayCalMid = Math.round((todayTotals.calories_min + todayTotals.calories_max) / 2);

  const dayCount = dayCountFromMeals(meals);
  const mealCount = meals.length;
  const loggedDays = summarizeLoggedDays(meals, 7, true);
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

  type ScoredNudge = { message: string; priority: number; type: NudgeType; data: NudgeData; slot: "trend" | "today" };
  const nudges: ScoredNudge[] = [];
  const focus = (profile?.freeformFocus ?? profile?.bodyPriority ?? "").toLowerCase();
  const calorieBias = focus.includes("energy") ? 1 : 0;
  const proteinBias = focus.includes("strength") || focus.includes("performance") ? 1 : 0;
  const microBias = focus.includes("longevity") ? 1 : 0;

  const gentleTargets = adjustTargetsForWorkouts(computeGentleTargets(meals, profile), workouts);

  // ── TREND NUDGES (weekly pattern, one always shown) ──────────────────────────

  if (profile && dayCount >= 5 && mealCount >= 5 && avgWeekCalories && gentleTargets?.calories) {
    const weekLow = avgWeekCalories < gentleTargets.calories * 0.9;
    const weekHigh = avgWeekCalories > gentleTargets.calories * 1.1;
    const daysCalorieLow = loggedDays.filter((d) => {
      const dayAvg = avgRangeMidpoint([d.totals.calories_min], [d.totals.calories_max]);
      return dayAvg > 0 && dayAvg < gentleTargets!.calories * 0.9;
    }).length;
    const daysCalStr = daysCalorieLow > 1 ? `${daysCalorieLow} of the last 7 days` : "most days this week";

    if (weekLow) {
      nudges.push({
        message: isMorning
          ? pickVariant([
              `Food intake has been on the lighter side for ${daysCalStr}. Worth aiming to eat a bit more throughout today.`,
              `Calorie intake has come in below your target for ${daysCalStr}. Today is a good chance to bring that up.`,
              `You've been eating below your goal for ${daysCalStr}. Building today's meals with that in mind can help.`,
              `Energy intake has been low for ${daysCalStr}. A bit more at each meal today should close that gap.`,
            ])
          : pickVariant([
              `Calorie intake has been below target for ${daysCalStr}. At ${todayCalMid} kcal today, there's still room to add more.`,
              `Most recent days have come in light on food. Today is at ${todayCalMid} kcal so far with more meals ahead.`,
              `You've been short on total intake for ${daysCalStr}. There's still time today to add something more.`,
            ]),
        type: "calorie_low",
        data: { actual: Math.round(avgWeekCalories), target: gentleTargets.calories, daysLow: daysCalorieLow },
        priority: 2 + calorieBias,
        slot: "trend",
      });
    } else if (weekHigh) {
      nudges.push({
        message: pickVariant([
          `Intake has been a bit above your target for most of this week. Just something to stay aware of.`,
          `Calories have been running a bit high this week. Keeping an eye on portions could help keep things balanced.`,
          `Food intake has been above your goal for a few days. Worth checking in on what's driving that.`,
          `You've been eating a bit more than your target this week. Staying aware of it is already half the work.`,
        ]),
        type: "calorie_high",
        data: { actual: Math.round(avgWeekCalories), target: gentleTargets.calories },
        priority: 2 + calorieBias,
        slot: "trend",
      });
    }
  }

  if (profile && avgWeekProtein) {
    const rawW = profile.weight ?? 0;
    const weightKg = rawW ? normalizeWeightToKg(rawW, profile.units) : 0;
    const target = weightKg ? weightKg * proteinTargetPerKg(profile) : 0;
    const daysProteinLow = target ? loggedDays.filter((d) => {
      const dayAvg = avgRangeMidpoint([d.totals.protein_g_min], [d.totals.protein_g_max]);
      return dayAvg > 0 && dayAvg < target * 0.85;
    }).length : 0;
    const daysProtStr = daysProteinLow > 1 ? `${daysProteinLow} of the last 7 days` : "most days recently";

    if (target && avgWeekProtein < target * 0.7) {
      nudges.push({
        message: isMorning
          ? pickVariant([
              `Protein has been well below your goal for ${daysProtStr}. Try to build each meal today around a solid protein source.`,
              `You've been short on protein for ${daysProtStr}. Even small additions at each meal today add up fast.`,
              `Protein intake has been low for ${daysProtStr}. Making it a focus today could really shift the weekly average.`,
              `The protein gap has been consistent for ${daysProtStr}. Today is a clean opportunity to close it.`,
            ])
          : pickVariant([
              `Protein has been short for ${daysProtStr}. At ${todayProteinMid}g today, dinner is still a real opportunity.`,
              `Protein intake has been low this week. ${todayProteinMid}g in today so far, a protein-rich dinner can still make a dent.`,
              `You've been under on protein for ${daysProtStr}. At ${todayProteinMid}g today, a strong finish at dinner would help.`,
            ]),
        type: "protein_low_critical",
        data: { actual: Math.round(avgWeekProtein), target: Math.round(target), daysLow: daysProteinLow },
        priority: 3 + proteinBias,
        slot: "trend",
      });
    } else if (target && avgWeekProtein < target * 0.85) {
      nudges.push({
        message: isMorning
          ? pickVariant([
              `Protein has been a little short for ${daysProtStr}. Worth nudging it up a bit today.`,
              `You've been slightly under your protein goal for ${daysProtStr}. A bit more at each meal today should get you there.`,
              `Protein has been coming in just under target lately. Today's a good day to aim a bit higher.`,
            ])
          : pickVariant([
              `Protein has been slightly below target for ${daysProtStr}. At ${todayProteinMid}g today with more meals ahead.`,
              `You've been a bit short on protein this week. ${todayProteinMid}g logged today so far.`,
              `Protein is slightly under where it should be this week. Still time to add a bit more today.`,
            ]),
        type: "protein_low",
        data: { actual: Math.round(avgWeekProtein), target: Math.round(target), daysLow: daysProteinLow },
        priority: 2 + proteinBias,
        slot: "trend",
      });
    }
  }

  const recentWorkoutCount = workouts.filter((w) => Date.now() - (w.endTs ?? w.startTs) <= 7 * 24 * 60 * 60 * 1000).length;
  let workoutFuelNudgePushed = false;

  if (profile?.activityLevel === "very_active" || profile?.activityLevel === "moderately_active") {
    if (recentWorkoutCount === 0 && mealCount >= 10) {
      nudges.push({
        message: pickVariant([
          `No workouts logged this week. If you've been training, adding sessions helps the app give you better intake guidance.`,
          `Workout tracking has been quiet this week. Logging sessions helps connect food and energy patterns over time.`,
          `No sessions logged this week. If you're active, tracking workouts gives the app better context for your intake.`,
        ]),
        type: "workout_missing",
        data: {},
        priority: 1,
        slot: "trend",
      });
    } else if (recentWorkoutCount >= 1 && gentleTargets?.calories && avgWeekCalories < gentleTargets.calories * 0.9) {
      nudges.push({
        message: isMorning
          ? pickVariant([
              `You've had some solid sessions this week. Food intake has been a bit light relative to the output. Worth eating more today.`,
              `Training load is up but food intake has been lower than ideal. Try to eat a bit more around your sessions today.`,
              `Good training week but the food hasn't quite kept pace. Aiming to eat a bit more today would help.`,
            ])
          : pickVariant([
              `You've been active this week but intake has been a bit light. At ${todayCalMid} kcal today, there's still room to fuel up.`,
              `Solid training week but food hasn't kept up. ${todayCalMid} kcal logged today with more time to add.`,
            ]),
        type: "workout_fuel_low",
        data: { actual: Math.round(avgWeekCalories), target: gentleTargets?.calories },
        priority: 2,
        slot: "trend",
      });
      workoutFuelNudgePushed = true;
    }
  }

  // Micronutrient nudges — require low signal across 3+ distinct days
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
        const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
        nudges.push({
          message: pickVariant([
            `${cap(nutrient)} has been on the lower side across your recent meals. Small changes in variety can add up over time.`,
            `Your recent meals have shown lower ${nutrient} than ideal. Adding a bit of variety can bring that up.`,
            `${cap(nutrient)} has appeared low across ${days.size} recent days. More variety in what you eat tends to help.`,
            `Looks like ${nutrient} has been a bit low lately. It's easy to miss, but worth mixing in a few new foods.`,
          ]),
          type: "micronutrient",
          data: { nutrient },
          priority: 1 + microBias,
          slot: "trend",
        });
      }
    });
  }

  // Training fuel (deduped against workout_fuel_low)
  if (
    !workoutFuelNudgePushed &&
    (profile?.activityLevel === "very_active" || profile?.activityLevel === "moderately_active") &&
    gentleTargets?.calories &&
    recentWorkoutCount >= 2 &&
    avgWeekCalories < gentleTargets.calories * 0.9
  ) {
    nudges.push({
      message: isMorning
        ? pickVariant([
            `Good training week. Food intake has been a bit light relative to the effort. Worth eating a bit more today.`,
            `Solid sessions this week but the food hasn't kept pace. Try to add a bit more fuel today.`,
            `Active week so far. Intake has been running a little low for the amount of training you're doing.`,
          ])
        : pickVariant([
            `Good training week but intake has been on the lighter side. You're at ${todayCalMid} kcal today.`,
            `Active week but calorie intake hasn't matched the output. Still time to eat a bit more today.`,
          ]),
      type: "training_fuel_low",
      data: { actual: Math.round(avgWeekCalories), target: gentleTargets?.calories },
      priority: 2,
      slot: "trend",
    });
  }

  // Fat nudge — only if calorie_low hasn't fired
  const calorieLowFired = nudges.some((n) => n.type === "calorie_low");
  if (profile && avgWeekCalories > 800 && avgWeekFat > 0 && !calorieLowFired) {
    const fatTarget = (avgWeekCalories * 0.3) / 9;
    if (avgWeekFat < fatTarget * 0.7) {
      nudges.push({
        message: pickVariant([
          `Fat intake has been on the lower side this week. Healthy fats help with energy, hormones, and absorbing vitamins.`,
          `Your meals have been a bit low in fat this week. Things like nuts, avocado, or olive oil help more than you might expect.`,
          `Fat intake has been below where it should be. It quietly affects energy, mood, and how well vitamins get absorbed.`,
          `Healthy fats have been low in your recent meals. Even small additions to what you normally eat can make a difference.`,
        ]),
        type: "fat_low",
        data: { actual: Math.round(avgWeekFat), target: Math.round(fatTarget) },
        priority: 1,
        slot: "trend",
      });
    }
  }

  // On-track trend — fires only when no other trend nudges found
  const hasTrendNudge = nudges.some((n) => n.slot === "trend");
  if (!hasTrendNudge && profile?.weight && dayCount >= 5 && avgWeekCalories > 0) {
    nudges.push({
      message: pickWeekly([
        `Intake is looking solid this week.`,
        `Things are tracking well across the board this week.`,
        `Good week of eating. The patterns are all in a healthy range.`,
        `Everything is looking balanced this week. Keep doing what you're doing.`,
      ]),
      type: "on_track",
      data: {},
      priority: 0,
      slot: "trend",
    });
  }

  // ── TODAY NUDGES (afternoon slot only, 3pm-8pm) ──────────────────────────────

  if (isAfternoon && gentleTargets) {
    const todayNudges: ScoredNudge[] = [];

    // Workout fuel today
    const workedOutToday = workouts.some(
      (w) => w.endTs != null && dayKeyFromTs(w.endTs) === dayKeyFromTs(Date.now())
    );
    if (workedOutToday && gentleTargets.calories && todayCalMid < gentleTargets.calories * 0.6) {
      todayNudges.push({
        message: pickVariant([
          `You logged a workout today but food is sitting at ${todayCalMid} kcal. Make sure dinner covers the extra cost.`,
          `Active day today and you're only at ${todayCalMid} kcal. Worth eating a bit more to recover properly.`,
          `Good session today. Food intake is at ${todayCalMid} kcal so far, dinner is a good chance to refuel.`,
        ]),
        type: "workout_fuel_low",
        data: { actual: todayCalMid, target: Math.round(gentleTargets.calories) },
        priority: 3,
        slot: "today",
      });
    }

    // Protein today
    if (
      gentleTargets.protein &&
      todayProteinMid < gentleTargets.protein * 0.5 &&
      todayProteinMid > 0
    ) {
      todayNudges.push({
        message: pickVariant([
          `Protein is light today at ${todayProteinMid}g. A protein-focused dinner could get you much closer to your goal.`,
          `You're at ${todayProteinMid}g of protein today. There's still a real opportunity with dinner to bring that up.`,
          `Today's protein is at ${todayProteinMid}g so far. Dinner is the best remaining chance to close the gap.`,
          `Only ${todayProteinMid}g of protein logged today. A solid dinner choice can still turn that around.`,
        ]),
        type: "protein_low",
        data: { actual: todayProteinMid, target: Math.round(gentleTargets.protein) },
        priority: 2,
        slot: "today",
      });
    }

    // Calories today
    if (
      gentleTargets.calories &&
      todayCalMid < gentleTargets.calories * 0.45 &&
      todayCalMid > 0 &&
      !workedOutToday
    ) {
      todayNudges.push({
        message: pickVariant([
          `Today has been pretty light on food at ${todayCalMid} kcal. A solid dinner can help bring the day into balance.`,
          `Only ${todayCalMid} kcal logged today. Dinner is a good chance to make up for the lighter day.`,
          `Food intake is low today at ${todayCalMid} kcal. There's still time to add something more nourishing.`,
        ]),
        type: "calorie_low",
        data: { actual: todayCalMid, target: Math.round(gentleTargets.calories) },
        priority: 2,
        slot: "today",
      });
    }

    // On-track today
    if (todayNudges.length === 0 && todayCalMid > 0) {
      todayNudges.push({
        message: pickVariant([
          `Today is looking well-balanced. A consistent dinner keeps the pattern going.`,
          `Good day of eating so far. You're tracking right where you should be.`,
          `Things are looking solid today. Finishing with a balanced dinner keeps it on track.`,
          `Today's intake is looking good. Stay consistent through dinner and you're set.`,
        ]),
        type: "on_track",
        data: {},
        priority: 0,
        slot: "today",
      });
    }

    const bestTodayNudge = todayNudges.sort((a, b) => b.priority - a.priority)[0];
    if (bestTodayNudge) nudges.push(bestTodayNudge);
  }

  // Sort and deduplicate trend nudges
  const unique = new Set<string>();
  const seenTypes = new Set<NudgeType>();
  const sortedTrend = nudges
    .filter((n) => n.slot === "trend")
    .sort((a, b) => b.priority - a.priority)
    .filter((item) => {
      if (unique.has(item.message) || seenTypes.has(item.type)) return false;
      unique.add(item.message);
      seenTypes.add(item.type);
      return true;
    });

  const sortedToday = nudges
    .filter((n) => n.slot === "today")
    .sort((a, b) => b.priority - a.priority)
    .filter((item) => {
      if (unique.has(item.message)) return false;
      unique.add(item.message);
      return true;
    });

  // Combine: always show top trend nudge. In afternoon window, add today nudge (or
  // fall back to a strong second trend nudge if no today nudge exists).
  const result: ComputedNudge[] = [];
  if (sortedTrend.length > 0) result.push(sortedTrend[0]);
  if (maxNudges >= 2) {
    if (sortedToday.length > 0) {
      result.push(sortedToday[0]);
    } else if (sortedTrend.length > 1 && sortedTrend[1].priority >= 2) {
      result.push(sortedTrend[1]);
    }
  }

  return result.map(({ message, type, data }) => ({ message, type, data }));
}
