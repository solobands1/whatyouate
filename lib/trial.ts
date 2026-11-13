import type { MealLog } from "./types";
import { computeFoodFeelingLinks, type FeelingReflection } from "./foodFeeling";

// Users who always have full access regardless of trial status
const UNLIMITED_USER_IDS = new Set([
  "4ef35614-32ec-4a17-b410-f4c31437c1bc", // Dillon
  "b2d6d7a6-a147-4dfb-9750-375d070cccbf", // Andrea
  "973c0886-cd6f-4813-8a3c-4ded80bfa09c", // Apple review demo
  "cb1b1885-8192-4a71-ad64-30c58905c5d1", // Marketing demo (screen recordings for social)
]);

// Same free/unlimited access, but matched by email (lowercased) when the user id
// isn't handy. Empty right now so these accounts see the real trial/paywall flow —
// add an address here to grant a specific tester unlimited access.
const UNLIMITED_USER_EMAILS = new Set<string>();

const DAY_MS = 1000 * 60 * 60 * 24;
export const FREE_ACCESS_BUFFER_MS = 2 * DAY_MS; // time to live with the first connection before the wall
export const FREE_ACCESS_CAP_MS = 14 * DAY_MS;   // hard cap from the first meal, whatever happens (cost control)
const HEADS_UP_MS = 2 * DAY_MS;                  // Home and Profile name the end day once it's this close

// The minimal meal shape the free-access math needs. MealLog satisfies it; the crons pass rows
// straight from the database. createdAt (when the row was saved) matters for a meal logged for an
// earlier time: it only counts toward a connection from the moment it was actually logged.
export type TrialMeal = {
  ts: number;
  createdAt?: number | null;
  status?: string | null;
  analysisJson?: { source?: string | null; feeling_tags?: string[] | null } | null;
};

// A nightly reflection as stored in profiles.reflections_json. ts is when it was saved.
export type TrialReflection = FeelingReflection & { ts?: number | null };

// What decides free access beyond meals. Server and phone must pass the same things: the
// reflections, and on the server the user's stored timezone offset (the phone uses its own).
export interface FreeAccessContext {
  reflections?: TrialReflection[] | null;
  tzOffsetMinutes?: number | null;
}

function isRealMeal(m: TrialMeal): boolean {
  return m.analysisJson?.source !== "supplement" && m.status !== "failed";
}

export function firstRealMealTs(meals: TrialMeal[]): number | null {
  let first: number | null = null;
  for (const m of meals) if (isRealMeal(m) && (first == null || m.ts < first)) first = m.ts;
  return first;
}

// End of a "YYYY-MM-DD" day, for an old reflection saved without a ts.
function endOfDay(date: string, tzOffsetMinutes: number | null | undefined): number {
  const y = +date.slice(0, 4), mo = +date.slice(5, 7) - 1, d = +date.slice(8, 10);
  if (typeof tzOffsetMinutes === "number" && Number.isFinite(tzOffsetMinutes)) {
    return Date.UTC(y, mo, d + 1) + tzOffsetMinutes * 60_000 - 1;
  }
  return new Date(y, mo, d + 1).getTime() - 1;
}

// When the first real food and feeling connection appeared: the earliest moment at which
// computeFoodFeelingLinks (the engine behind Patterns and the coach card), run on only the meals
// and reflections that existed by then, finds at least one link. Checked at every moment new data
// arrived (each meal as it was logged, each reflection as it was saved) and once a day, so the
// answer never moves once found, even if later data makes the link fade. Only looks between the
// first meal and `until`; null when nothing showed in that span.
export function firstConnectionTs(
  meals: TrialMeal[],
  reflections: TrialReflection[],
  fromTs: number,
  until: number,
  tzOffsetMinutes?: number | null,
): number | null {
  if (until < fromTs) return null;
  const mealsIn = meals.map((m) => ({ m, at: Math.max(m.ts, m.createdAt ?? m.ts) }));
  const reflIn = reflections
    .filter((r) => r && typeof r.date === "string" && r.answers && typeof r.answers === "object")
    .map((r) => ({ r, at: typeof r.ts === "number" && r.ts > 0 ? r.ts : endOfDay(r.date, tzOffsetMinutes) }));

  const checkpoints = new Set<number>([fromTs]);
  for (const { at } of mealsIn) if (at > fromTs && at <= until) checkpoints.add(at);
  for (const { at } of reflIn) if (at > fromTs && at <= until) checkpoints.add(at);
  for (let t = fromTs + DAY_MS; t <= until; t += DAY_MS) checkpoints.add(t);

  for (const t of [...checkpoints].sort((a, b) => a - b)) {
    const ms = mealsIn.filter((x) => x.at <= t).map((x) => x.m);
    const rs = reflIn.filter((x) => x.at <= t).map((x) => x.r);
    if (computeFoodFeelingLinks(ms, rs, undefined, { now: t, tzOffsetMinutes }).length > 0) return t;
  }
  return null;
}

export interface Wall {
  hasStarted: boolean;           // user has logged at least one real meal
  firstMealTs: number | null;    // timestamp of that first real meal
  connectionTs: number | null;   // when the first real food and feeling connection appeared (before the cap)
  capTs: number | null;          // first meal + 14 days
  endsAt: number | null;         // when free access ends: connection + 2 days, or the cap, whichever is first
  endsBy: "connection" | "cap" | null;
  expired: boolean;              // past endsAt
}

// Free access, from the first real meal until 2 days after the first real food and feeling
// connection, capped at 14 days from the first meal. A connection needs 8 nights with an energy
// answer and tagged meals to compare, so it can't land before day 7 and the wall can't land
// before about day 8.
export function computeWall(meals: TrialMeal[], now: number, ctx: FreeAccessContext = {}): Wall {
  const firstMealTs = firstRealMealTs(meals);
  if (firstMealTs == null) {
    return { hasStarted: false, firstMealTs: null, connectionTs: null, capTs: null, endsAt: null, endsBy: null, expired: false };
  }
  const capTs = firstMealTs + FREE_ACCESS_CAP_MS;
  // Past the cap nothing else matters, so skip the replay (most long-time users).
  const connectionTs = now >= capTs ? null : firstConnectionTs(meals, ctx.reflections ?? [], firstMealTs, now, ctx.tzOffsetMinutes);
  const byConnection = connectionTs != null ? connectionTs + FREE_ACCESS_BUFFER_MS : Infinity;
  const endsAt = Math.min(byConnection, capTs);
  const endsBy = byConnection < capTs ? "connection" : "cap";
  return { hasStarted: true, firstMealTs, connectionTs, capTs, endsAt, endsBy, expired: now >= endsAt };
}

// Whether a user is in ACTIVE free access (has started, not yet walled). Ignores pro/allowlist;
// callers layer paid status on top. Without ctx.reflections no connection can be seen, so only
// the cap applies: the crons go through lib/server/freeAccess.ts, which loads them.
export function isTrialEligible(meals: TrialMeal[], now: number = Date.now(), ctx: FreeAccessContext = {}): boolean {
  const w = computeWall(meals, now, ctx);
  return w.hasStarted && !w.expired;
}

export interface TrialStatus {
  hasStarted: boolean;    // user has logged at least one real meal
  isTrialActive: boolean; // in Free Access (not yet walled)
  isExpired: boolean;     // past the wall, not pro
  isPro: boolean;         // allowlisted or paid
  isFree: boolean;        // expired and not pro (paywall applies)
  endsAt: number | null;  // when Free Access ends (only while it's active)
  endsBy: "connection" | "cap" | null;
}

export function computeTrialStatus(
  meals: MealLog[],
  userId: string | null,
  email?: string | null,
  now: number = Date.now(),
  ctx: FreeAccessContext = {},
): TrialStatus {
  const isPro =
    (userId ? UNLIMITED_USER_IDS.has(userId) : false) ||
    (email ? UNLIMITED_USER_EMAILS.has(email.toLowerCase()) : false);

  if (isPro) {
    return { hasStarted: firstRealMealTs(meals) != null, isTrialActive: false, isExpired: false, isPro: true, isFree: false, endsAt: null, endsBy: null };
  }

  const wall = computeWall(meals, now, ctx);
  if (!wall.hasStarted) {
    return { hasStarted: false, isTrialActive: false, isExpired: false, isPro: false, isFree: false, endsAt: null, endsBy: null };
  }
  return {
    hasStarted: true,
    isTrialActive: !wall.expired,
    isExpired: wall.expired,
    isPro: false,
    isFree: wall.expired,
    endsAt: wall.expired ? null : wall.endsAt,
    endsBy: wall.expired ? null : wall.endsBy,
  };
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The last day of Free Access in words, once it's 2 days away or less: "Today", "Tomorrow" or a
// weekday ("Thursday"). Null when there's no end in sight yet. Reads the day of the last moment
// of access, so an end at midnight names the day before.
export function freeAccessEndDay(status: Pick<TrialStatus, "isTrialActive" | "endsAt">, now: number = Date.now()): string | null {
  if (!status.isTrialActive || status.endsAt == null || status.endsAt - now > HEADS_UP_MS) return null;
  const last = new Date(Math.max(status.endsAt - 1, now));
  const today = new Date(now);
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((dayStart(last) - dayStart(today)) / DAY_MS);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return WEEKDAY[last.getDay()];
}

// "Nov 26": the latest Free Access can run, for Profile.
export function freeAccessLatestDate(endsAt: number): string {
  const d = new Date(endsAt - 1);
  return `${MONTH[d.getMonth()]} ${d.getDate()}`;
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

// Whether enough meals exist for the nutrition views (5 days + 5 meals). Must match the
// InsightsScreen hasEnoughData threshold so the Patterns bell, the "Your Nutrition Just Opened Up"
// celebration and the first review milestone only fire when real data is visible.
export function hasEnoughDataForPatterns(meals: MealLog[]): boolean {
  const realMeals = meals.filter(
    (m) => m.analysisJson?.source !== "supplement" && m.status !== "failed"
  );
  return realMeals.length >= 5 && countLoggedDays(meals) >= 5;
}
