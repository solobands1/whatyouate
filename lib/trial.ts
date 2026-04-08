import type { MealLog } from "./types";

// Users who always have full access regardless of trial status
const UNLIMITED_USER_IDS = new Set([
  "4ef35614-32ec-4a17-b410-f4c31437c1bc", // Dillon
]);

const TRIAL_DAYS = 7;

export interface TrialStatus {
  hasStarted: boolean;    // user has logged at least one real meal
  isTrialActive: boolean; // within the 7-day window
  isExpired: boolean;     // past 7 days, not pro
  isPro: boolean;         // allowlisted or paid
  isFree: boolean;        // expired and not pro (paywall applies)
  currentDay: number;     // 1–7 during trial
  daysLeft: number;       // days remaining in trial
}

export function computeTrialStatus(meals: MealLog[], userId: string | null): TrialStatus {
  const isPro = userId ? UNLIMITED_USER_IDS.has(userId) : false;

  const firstRealMeal = [...meals]
    .filter((m) => m.analysisJson?.source !== "supplement" && m.status !== "failed")
    .sort((a, b) => a.ts - b.ts)[0];

  if (isPro) {
    return {
      hasStarted: !!firstRealMeal,
      isTrialActive: false,
      isExpired: false,
      isPro: true,
      isFree: false,
      currentDay: 0,
      daysLeft: TRIAL_DAYS,
    };
  }

  if (!firstRealMeal) {
    return {
      hasStarted: false,
      isTrialActive: false,
      isExpired: false,
      isPro: false,
      isFree: false,
      currentDay: 1,
      daysLeft: TRIAL_DAYS,
    };
  }

  const daysSinceStart = Math.floor((Date.now() - firstRealMeal.ts) / (1000 * 60 * 60 * 24));
  const daysLeft = Math.max(0, TRIAL_DAYS - daysSinceStart);
  const currentDay = Math.min(daysSinceStart + 1, TRIAL_DAYS);
  const isExpired = daysSinceStart >= TRIAL_DAYS;

  return {
    hasStarted: true,
    isTrialActive: !isExpired,
    isExpired,
    isPro: false,
    isFree: isExpired,
    currentDay,
    daysLeft,
  };
}

// How many unique logged days (excluding supplements) are in the meals array
export function countLoggedDays(meals: MealLog[]): number {
  const days = new Set(
    meals
      .filter((m) => m.analysisJson?.source !== "supplement" && m.status !== "failed")
      .map((m) => {
        const d = new Date(m.ts);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      })
  );
  return days.size;
}

// Whether enough data exists to show the "your patterns are ready" value moment
// Must match the InsightsScreen hasEnoughData threshold (5 days + 5 meals) so the
// Patterns bell only fires when real data is actually visible in the screen.
export function hasEnoughDataForPatterns(meals: MealLog[]): boolean {
  const realMeals = meals.filter(
    (m) => m.analysisJson?.source !== "supplement" && m.status !== "failed"
  );
  return realMeals.length >= 5 && countLoggedDays(meals) >= 5;
}
