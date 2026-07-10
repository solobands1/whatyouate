import type { MealLog } from "./types";

// Users who always have full access regardless of trial status
const UNLIMITED_USER_IDS = new Set([
  "4ef35614-32ec-4a17-b410-f4c31437c1bc", // Dillon
  "b2d6d7a6-a147-4dfb-9750-375d070cccbf", // Andrea
  "973c0886-cd6f-4813-8a3c-4ded80bfa09c", // Apple review demo
]);

// Same free/unlimited access, but matched by email (lowercased) when the user id
// isn't handy. Empty right now so these accounts see the real trial/paywall flow —
// add an address here to grant a specific tester unlimited access.
const UNLIMITED_USER_EMAILS = new Set<string>();

const DAY_MS = 1000 * 60 * 60 * 24;
const TRIAL_DAYS = 7;            // interim: still drives currentDay/daysLeft for the Home "Day X of 7" banner (Phase 2 replaces that UI)
const CORE_DAYS = 5;            // distinct logged days that "complete the core picture"
const CORE_MEALS = 5;          // real meals required alongside CORE_DAYS
const BUFFER_MS = 2 * DAY_MS;   // grace after the core picture is built, so they get to live in it
const BACKSTOP_MS = 14 * DAY_MS; // hard cap from first meal, regardless of engagement (cost control)

// The minimal meal shape the trial math needs. MealLog satisfies it; the cron
// routes can pass lighter rows (e.g. the reminder cron) without a full MealLog.
export type TrialMeal = { ts: number; status?: string | null; analysisJson?: { source?: string | null } | null };

function isRealMeal(m: TrialMeal): boolean {
  return m.analysisJson?.source !== "supplement" && m.status !== "failed";
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export interface Wall {
  hasStarted: boolean;           // user has logged at least one real meal
  firstMealTs: number | null;    // timestamp of that first real meal
  coreComplete: boolean;         // the "core picture" (CORE_DAYS days + CORE_MEALS meals) has been built
  coreCompleteTs: number | null; // when it was built
  expired: boolean;              // past the behavior wall (core built + buffer, or backstop)
}

// The behavior-triggered trial wall, computed purely from the user's meals.
// The free window lasts until the "core picture" is built (5 logged days + 5 meals)
// plus a 2-day buffer to live in it — or a 14-day backstop from the first meal,
// whichever comes first. Because 5 distinct days can't be reached before day 5,
// the wall is always >= ~day 7, so it only ever EXTENDS the old fixed window.
export function computeWall(meals: TrialMeal[], now: number): Wall {
  const real = meals.filter(isRealMeal).sort((a, b) => a.ts - b.ts);
  const firstMealTs = real.length ? real[0].ts : null;
  if (firstMealTs == null) {
    return { hasStarted: false, firstMealTs: null, coreComplete: false, coreCompleteTs: null, expired: false };
  }

  // Walk meals in time order; note the timestamp at which both thresholds are first met.
  const seenDays = new Set<string>();
  let coreCompleteTs: number | null = null;
  let mealsSoFar = 0;
  for (const m of real) {
    mealsSoFar++;
    seenDays.add(dayKey(m.ts));
    if (coreCompleteTs == null && seenDays.size >= CORE_DAYS && mealsSoFar >= CORE_MEALS) {
      coreCompleteTs = m.ts;
    }
  }
  const coreComplete = coreCompleteTs != null;

  const expiredByPicture = coreComplete && now >= (coreCompleteTs as number) + BUFFER_MS;
  const expiredByBackstop = now >= firstMealTs + BACKSTOP_MS;

  return { hasStarted: true, firstMealTs, coreComplete, coreCompleteTs, expired: expiredByPicture || expiredByBackstop };
}

// Whether a user is in an ACTIVE free trial (has started, not yet walled).
// Ignores pro/allowlist — callers layer paid status on top (the crons via RevenueCat).
export function isTrialEligible(meals: TrialMeal[], now: number = Date.now()): boolean {
  const w = computeWall(meals, now);
  return w.hasStarted && !w.expired;
}

export interface TrialStatus {
  hasStarted: boolean;    // user has logged at least one real meal
  isTrialActive: boolean; // in the free window (not yet walled)
  isExpired: boolean;     // past the wall, not pro
  isPro: boolean;         // allowlisted or paid
  isFree: boolean;        // expired and not pro (paywall applies)
  currentDay: number;     // interim 1–7 figure for the Home banner
  daysLeft: number;       // interim days-remaining figure for the Home banner
}

export function computeTrialStatus(
  meals: MealLog[],
  userId: string | null,
  email?: string | null,
  now: number = Date.now(),
): TrialStatus {
  const isPro =
    (userId ? UNLIMITED_USER_IDS.has(userId) : false) ||
    (email ? UNLIMITED_USER_EMAILS.has(email.toLowerCase()) : false);

  const wall = computeWall(meals, now);

  if (isPro) {
    return { hasStarted: wall.hasStarted, isTrialActive: false, isExpired: false, isPro: true, isFree: false, currentDay: 0, daysLeft: TRIAL_DAYS };
  }

  if (!wall.hasStarted) {
    return { hasStarted: false, isTrialActive: false, isExpired: false, isPro: false, isFree: false, currentDay: 1, daysLeft: TRIAL_DAYS };
  }

  // Interim calendar figures kept only for the existing "Day X of 7" banner; Phase 2
  // replaces that UI with progress-toward-your-picture, at which point these can go.
  const daysSinceStart = Math.floor((now - (wall.firstMealTs as number)) / DAY_MS);
  const daysLeft = Math.max(0, TRIAL_DAYS - daysSinceStart);
  const currentDay = Math.min(daysSinceStart + 1, TRIAL_DAYS);

  return {
    hasStarted: true,
    isTrialActive: !wall.expired,
    isExpired: wall.expired,
    isPro: false,
    isFree: wall.expired,
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
