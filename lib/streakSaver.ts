// Streak-saver "freeze" state — a capped safety net that bridges a single missed day.
//
// Freeze semantics: a forgiven day preserves the streak without crediting it (a 6-day streak
// stays 6 across the gap; logging the next day makes it 7). At most one passive rescue is
// spent per rolling window; actively backfilling the day releases it.
//
// The state is persisted server-side on the profile (streak_saver_json), so the forgiven days
// and the weekly cap are durable and consistent across devices. These are pure helpers over
// that state — AppDataProvider owns reading/writing it alongside the streak itself.

export type StreakSaverState = {
  forgiven: string[]; // frozen day-keys (YYYY-MM-DD) that bridge the streak
  rescueLast: string | null; // day the weekly rescue was last spent on
  ack: string | null; // rescue day whose "we saved it" message has been shown
};

export const EMPTY_STREAK_SAVER: StreakSaverState = { forgiven: [], rescueLast: null, ack: null };

// At most one passive rescue per rolling window. Actively backfilling the day releases it.
export const RESCUE_WINDOW_DAYS = 7;

// Normalize whatever is stored in the jsonb column (or a stale/missing value) into a valid state.
export function coerceStreakSaver(raw: unknown): StreakSaverState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_STREAK_SAVER };
  const o = raw as Record<string, unknown>;
  return {
    forgiven: Array.isArray(o.forgiven) ? o.forgiven.filter((x): x is string => typeof x === "string") : [],
    rescueLast: typeof o.rescueLast === "string" ? o.rescueLast : null,
    ack: typeof o.ack === "string" ? o.ack : null,
  };
}

// Whole-day difference between two YYYY-MM-DD keys (b - a).
function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity;
  return Math.round((db - da) / 86_400_000);
}

// A passive rescue is available only if none has been spent within the rolling window.
export function rescueAvailable(state: StreakSaverState, todayStr: string): boolean {
  if (!state.rescueLast) return true;
  return daysBetween(state.rescueLast, todayStr) >= RESCUE_WINDOW_DAYS;
}
