// Streak-saver "freeze" state — a capped safety net that bridges a single missed day.
//
// All client-side (localStorage). The persisted profile.streak / streakLastDate stay the
// source of truth for the displayed count; AppDataProvider keeps them in sync using the
// forgiven set below. A "forgiven" day preserves the streak without crediting it (freeze
// semantics): a 6-day streak stays 6 across the gap, and logging the next day makes it 7.

const forgivenKey = (uid: string) => `wya_streak_forgiven_${uid}`;
const rescueKey = (uid: string) => `wya_streak_rescue_last_${uid}`;

// At most one passive rescue per rolling window. Actively backfilling the day releases it.
export const RESCUE_WINDOW_DAYS = 7;

export function readForgiven(uid: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(forgivenKey(uid));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeForgiven(uid: string, set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (set.size === 0) localStorage.removeItem(forgivenKey(uid));
    else localStorage.setItem(forgivenKey(uid), JSON.stringify([...set]));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

export function clearForgiven(uid: string): void {
  writeForgiven(uid, new Set());
}

export function readRescueLast(uid: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(rescueKey(uid));
  } catch {
    return null;
  }
}

export function setRescueLast(uid: string, dateStr: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(rescueKey(uid), dateStr);
  } catch {
    /* non-fatal */
  }
}

export function clearRescueLast(uid: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(rescueKey(uid));
  } catch {
    /* non-fatal */
  }
}

// Which rescue (by its missed-day key) has had its "we saved it this time" message shown, so
// the passive reveal fires exactly once — whether the user dismisses the prompt or ignores it.
const ackKey = (uid: string) => `wya_streak_rescue_ack_${uid}`;

export function readRescueAck(uid: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ackKey(uid));
  } catch {
    return null;
  }
}

export function setRescueAck(uid: string, dateStr: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ackKey(uid), dateStr);
  } catch {
    /* non-fatal */
  }
}

// Whole-day difference between two YYYY-MM-DD keys (b - a).
function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity;
  return Math.round((db - da) / 86_400_000);
}

// A passive rescue is available only if none has been spent within the rolling window.
export function rescueAvailable(uid: string, todayStr: string): boolean {
  const last = readRescueLast(uid);
  if (!last) return true;
  return daysBetween(last, todayStr) >= RESCUE_WINDOW_DAYS;
}
