// The comeback ladder. Once someone has logged nothing for 3 days, the daily pushes (2pm log
// reminder, 7pm Nightly Reflection reminder, 9am coach push) stop and three comeback pushes take
// their place at about 6pm their time, on quiet days 3, 7 and 14. Then nothing more until they log
// again, which resets everything. Home shows a one-time Welcome Back card when they open the app
// after a quiet stretch (components/WelcomeBackCard).
//
// Pure helpers only, shared by the crons and the app. The database side (who was sent what, and
// who came back within 48 hours) is supabase/comeback.sql, read and written by lib/server/comeback.ts.

import { computeDiscoveryCandidates } from "./discoveries";
import type { ReflectionEntry } from "./habitState";
import { HABIT_TEMPLATES } from "./habits";

// Quiet from this many local days after the last log: a Monday log makes Thursday quiet day 3.
export const QUIET_DAYS = 3;
// People with no meal yet keep the first-week pushes for days 1 to 7 (the sign-up day is day 1).
export const FIRST_WEEK_DAYS = 7;
export const COMEBACK_LOCAL_HOUR = 18;
export const COMEBACK_RETURN_WINDOW_MS = 48 * 60 * 60 * 1000;
export type ComebackStage = 1 | 2 | 3;
export const COMEBACK_STAGE_DAYS: Record<ComebackStage, number> = { 1: 3, 2: 7, 3: 14 };
// The re-engagement habit the day-3 push and the Welcome Back card offer ("Pick Back Up").
export const COMEBACK_HABIT_ID = "logging-comeback";

// Every real log, as a moment (ms) when it has one, or a local day ("YYYY-MM-DD") when it doesn't.
// Meals count from when they were saved (a backfilled dinner still means they were here today),
// not supplements (logged automatically when the app opens) and not failed analyses. Feelings
// count from their time, Nightly Reflections from when they were done, and water by day, since
// it's stored as a daily total.
export interface Activity {
  moments: number[];
  days: string[];
}

export type ActivityMeal = { createdAt?: number | null; status?: string | null; source?: string | null };

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isRealMeal(m: { status?: string | null; source?: string | null }): boolean {
  return m.source !== "supplement" && m.status !== "failed";
}

function toMs(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 100_000_000_000 ? n * 1000 : n; // seconds or ms
}

export function buildActivity(input: {
  meals?: ActivityMeal[];
  feelTs?: unknown[];       // feel_logs.ts (seconds in the table, ms in the app; either works)
  reflections?: unknown;    // profiles.reflections_json
  waterLogs?: unknown;      // profiles.water_logs_json ({ "YYYY-MM-DD": ml, goal: ml })
}): Activity {
  const moments: number[] = [];
  const days: string[] = [];
  for (const m of input.meals ?? []) {
    if (!isRealMeal(m)) continue;
    const at = toMs(m.createdAt);
    if (at != null) moments.push(at);
  }
  for (const ts of input.feelTs ?? []) {
    const at = toMs(ts);
    if (at != null) moments.push(at);
  }
  if (Array.isArray(input.reflections)) {
    for (const r of input.reflections as Array<Record<string, unknown> | null>) {
      if (!r || typeof r !== "object") continue;
      const at = toMs(r.ts);
      if (at != null) moments.push(at);
      else if (typeof r.date === "string" && DAY_KEY.test(r.date)) days.push(r.date);
    }
  }
  if (input.waterLogs && typeof input.waterLogs === "object" && !Array.isArray(input.waterLogs)) {
    for (const [key, ml] of Object.entries(input.waterLogs as Record<string, unknown>)) {
      if (DAY_KEY.test(key) && typeof ml === "number" && ml > 0) days.push(key);
    }
  }
  return { moments, days };
}

// Whole calendar days from one "YYYY-MM-DD" to another.
export function dayDiff(fromKey: string, toKey: string): number {
  const f = Date.UTC(+fromKey.slice(0, 4), +fromKey.slice(5, 7) - 1, +fromKey.slice(8, 10));
  const t = Date.UTC(+toKey.slice(0, 4), +toKey.slice(5, 7) - 1, +toKey.slice(8, 10));
  return Math.round((t - f) / 86_400_000);
}

export function lastActiveDay(activity: Activity, dayOf: (ms: number) => string): string | null {
  let last: string | null = null;
  if (activity.moments.length) last = dayOf(Math.max(...activity.moments));
  for (const d of activity.days) if (!last || d > last) last = d;
  return last;
}

export interface QuietState {
  quiet: boolean;            // in the ladder: daily pushes stop, comeback pushes may go
  quietDays: number | null;  // local days since `since` (0 = logged today)
  since: string | null;      // the local day the quiet clock counts from
  neverActive: boolean;      // nothing logged at all, so the clock runs from sign-up
  firstWeek: boolean;        // no meal yet and still in days 1 to 7: today's pushes, no ladder
}

// dayOf turns a moment into the person's local day: their stored offset on the server, the
// device's own clock in the app.
export function quietState(opts: {
  activity: Activity;
  hasRealMeal: boolean;
  createdAtMs: number | null;
  nowMs: number;
  dayOf: (ms: number) => string;
}): QuietState {
  const { activity, hasRealMeal, createdAtMs, nowMs, dayOf } = opts;
  const today = dayOf(nowMs);
  const last = lastActiveDay(activity, dayOf);
  const createdDay = createdAtMs != null && Number.isFinite(createdAtMs) ? dayOf(createdAtMs) : null;
  const firstWeek = !hasRealMeal && createdDay != null && dayDiff(createdDay, today) + 1 <= FIRST_WEEK_DAYS;
  const since = last ?? createdDay;
  const quietDays = since ? Math.max(0, dayDiff(since, today)) : null;
  return {
    quiet: !firstWeek && quietDays != null && quietDays >= QUIET_DAYS,
    quietDays,
    since,
    neverActive: last == null,
    firstWeek,
  };
}

// The step due on this quiet day, if any. Exact days, so someone who was already quiet for weeks
// when the ladder went live, or who joins it late, just gets silence.
export function dueComebackStage(quietDays: number | null): ComebackStage | null {
  if (quietDays == null) return null;
  for (const s of [1, 2, 3] as ComebackStage[]) if (COMEBACK_STAGE_DAYS[s] === quietDays) return s;
  return null;
}

// When they came back after a comeback push sent at sentMs, if they have: the first log saved
// after it, or now if the only sign is a log that has no time (water, a reflection without one).
// Nothing they log can fall between their last log and the push (that's what made them quiet),
// so anything newer than the quiet stretch's first day is new.
export function returnedAt(activity: Activity, sentMs: number, quietSince: string, nowMs: number, dayOf: (ms: number) => string): number | null {
  const after = activity.moments.filter((m) => m > sentMs);
  if (after.length) return Math.min(...after);
  const newer = activity.days.some((d) => d > quietSince) || activity.moments.some((m) => dayOf(m) > quietSince);
  return newer ? nowMs : null;
}

// ── Push copy ──────────────────────────────────────────────────────────────

export interface ComebackMessage { title: string; body: string }

const NUMBER_WORDS: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five" };
const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// The day-7 step says something true from their own data, or a light line when there isn't
// anything real to say. A coach connection first (a literal count from their check-ins, positive
// pairs only), then what they've logged so far, then the plain line.
function stageTwo(ctx: { neverActive: boolean; meals: number; nights: number; reflections: ReflectionEntry[] }): ComebackMessage {
  if (!ctx.neverActive && ctx.reflections.length) {
    const link = computeDiscoveryCandidates(ctx.reflections).find((c) => c.id === "sleep-energy" || c.id === "sleep-mood");
    if (link) {
      const what = link.id === "sleep-energy" ? "energy" : "mood";
      const lead = link.hits === link.n ? `On all ${link.n} days you slept well` : `On ${link.hits} of the ${link.n} days you slept well`;
      return { title: "From Your Check-Ins", body: `${lead}, your ${what} was good too. A check-in tonight adds to the picture.` };
    }
  }
  if (!ctx.neverActive && (ctx.meals >= 3 || ctx.nights >= 3)) {
    const parts = [
      ctx.meals > 0 ? `${count(ctx.meals, "meal", "meals")} logged` : null,
      ctx.nights > 0 ? `${count(ctx.nights, "night", "nights")} reflected` : null,
    ].filter(Boolean);
    return { title: "It's All Still Here", body: `${parts.join(" and ")} so far. One quick log picks it back up.` };
  }
  return { title: "Whenever You're Ready", body: "One quick log is all it takes to get going." };
}

export function comebackMessage(
  stage: ComebackStage,
  ctx: { neverActive: boolean; meals?: number; nights?: number; reflections?: ReflectionEntry[] },
): ComebackMessage {
  if (stage === 1) {
    if (ctx.neverActive) return stageTwo({ neverActive: true, meals: 0, nights: 0, reflections: [] });
    const days = HABIT_TEMPLATES.find((t) => t.id === COMEBACK_HABIT_ID)?.durationDays ?? 2;
    return {
      title: "Pick Up Where You Left Off",
      body: `Pick Back Up is ${NUMBER_WORDS[days] ?? days} easy days, one log a day. A meal, a feeling or a glass of water all count.`,
    };
  }
  if (stage === 2) return stageTwo({ neverActive: ctx.neverActive, meals: ctx.meals ?? 0, nights: ctx.nights ?? 0, reflections: ctx.reflections ?? [] });
  return ctx.neverActive
    ? { title: "Still Here When You Want It", body: "Your coach is ready whenever you are. One quick log gets you started." }
    : { title: "Still Here When You Want It", body: "One quick log gets you going again. No catching up needed." };
}
