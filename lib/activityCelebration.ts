// Activity-celebration markers — which activity moments the app has already celebrated, so each
// fires once and survives a device switch. Persisted server-side on the profile
// (activity_celebration_json) rather than localStorage, which is per-device.
//
// Two moments (see memory: project_activity_celebration):
//  - Comeback: recorded activity again after a gap. A MOMENT — fired as a top banner from
//    HomeScreen the instant the returning activity appears (manual log or Apple Health sync).
//  - Consistency: newly-built steadiness over a week. A TREND — voiced by the coach, not here.
// These are pure helpers over the marker state; HomeScreen owns firing the banner.

import type { WorkoutSession } from "./types";
import { dayKeyFromTs } from "./utils";

export type ActivityCelebrationState = {
  lastComeback: string | null; // day-key of the last comeback we celebrated
  lastConsistencyWin: string | null; // day-key of the last consistency nod (drives the coach cooldown)
};

export const EMPTY_ACTIVITY_CELEBRATION: ActivityCelebrationState = {
  lastComeback: null,
  lastConsistencyWin: null,
};

// Days with no recorded activity before the next one counts as a "comeback".
export const COMEBACK_GAP_DAYS = 7;
// Only celebrate a comeback the user is around to see — within this many days of it happening,
// so a stale one (they didn't open the app for a week) doesn't pop as a late "welcome back".
export const COMEBACK_FRESH_DAYS = 2;

// The coach voices a consistency nod (activity_win) at most once per this many days, so a newly
// steady stretch is celebrated once, not congratulated every morning it stays true. Long enough to
// cover the same-week repeat window, short enough that a genuine later dip-and-rebuild re-earns it.
export const CONSISTENCY_COOLDOWN_DAYS = 14;

// Normalize whatever is stored in the jsonb column (or a stale/missing value) into a valid state.
export function coerceActivityCelebration(raw: unknown): ActivityCelebrationState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_ACTIVITY_CELEBRATION };
  const o = raw as Record<string, unknown>;
  return {
    lastComeback: typeof o.lastComeback === "string" ? o.lastComeback : null,
    lastConsistencyWin: typeof o.lastConsistencyWin === "string" ? o.lastConsistencyWin : null,
  };
}

// Whole-day difference between two YYYY-MM-DD keys (b - a).
function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity;
  return Math.round((db - da) / 86_400_000);
}

// Distinct local day-keys (ascending) that have a COMPLETED recorded activity. A walk counts the
// same as a workout — this is about movement, not intensity. In-progress sessions (no endTs) are
// not "done" yet, so they're excluded, mirroring completedWorkouts / summarizeWorkoutsWeek.
export function activityDayKeys(workouts: WorkoutSession[]): string[] {
  const set = new Set<string>();
  for (const w of workouts) {
    if (w.endTs == null) continue;
    set.add(dayKeyFromTs(w.endTs ?? w.startTs));
  }
  return [...set].sort();
}

// The day-key of a "comeback" — the most recent recorded activity, IF it ended a gap of at least
// COMEBACK_GAP_DAYS and there was a prior activity before that gap (a first-ever workout is not a
// comeback), and it's recent enough to still be worth celebrating. Returns null otherwise.
// Source-agnostic by design: it reads whatever is in the workout log, so it fires the same whether
// the user logged the activity themselves or it synced in passively from Apple Health.
export function detectComebackDay(workouts: WorkoutSession[], todayKey: string): string | null {
  const days = activityDayKeys(workouts);
  if (days.length < 2) return null; // need a prior activity to "come back" from
  const latest = days[days.length - 1];
  const prev = days[days.length - 2];
  if (daysBetween(prev, latest) < COMEBACK_GAP_DAYS) return null; // no real gap — not a comeback
  if (daysBetween(latest, todayKey) > COMEBACK_FRESH_DAYS) return null; // too stale to celebrate now
  return latest;
}

// Whether the coach may voice a consistency nod today — true unless one fired within the cooldown.
// The cron nudge path reads this to suppress a repeat, and writes recordConsistencyWin when one fires.
export function consistencyWinAvailable(state: ActivityCelebrationState, todayKey: string): boolean {
  if (!state.lastConsistencyWin) return true;
  return daysBetween(state.lastConsistencyWin, todayKey) >= CONSISTENCY_COOLDOWN_DAYS;
}

// Mark a consistency nod as fired today, so it stays quiet for CONSISTENCY_COOLDOWN_DAYS. Preserves
// the comeback marker.
export function recordConsistencyWin(state: ActivityCelebrationState, todayKey: string): ActivityCelebrationState {
  return { ...state, lastConsistencyWin: todayKey };
}
