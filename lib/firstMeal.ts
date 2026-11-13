// The "first meal" step at the end of onboarding: the clock rules it follows and the small pieces of
// per-user state it keeps in localStorage. Kept free of React so the time logic can be checked on its
// own. The UI lives in components/FirstMealStep.tsx and the wiring in HomeScreen.
//
// State, all keyed by user id:
//   wya_first_meal_<uid>           the step is still waiting (written only when onboarding finishes,
//                                  so people who onboarded before this shipped never see it)
//   wya_first_habit_<uid>          "logged" | "skipped": start Find Your Rhythm today, once the habit
//                                  engine has loaded (consumed by HomeScreen)
//   wya_first_meal_reminder_<uid>  "Remind Me After Breakfast" fallback: an in-app prompt on the next
//                                  open after the chosen time, for when a push can't reach them

import type { MealLog } from "./types";

const MIN = 60_000;

// Morning runs from 4:00 to 10:30 local time. Between midnight and 4am "Good Morning! Have You Had
// Breakfast Yet?" would read oddly, so those hours get the "What Did You Last Eat?" version.
export const MORNING_START_MIN = 4 * 60;
export const MORNING_END_MIN = 10 * 60 + 30;

export type FirstMealPeriod = "morning" | "later";

export function firstMealPeriod(now: Date = new Date()): FirstMealPeriod {
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= MORNING_START_MIN && m < MORNING_END_MIN ? "morning" : "later";
}

// Default meal times for each path.
export function lastNightDinnerTs(now: Date = new Date()): number {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  d.setHours(19, 0, 0, 0);
  return d.getTime();
}

// About an hour ago, rounded down to five minutes so the picker shows a tidy time.
export function anHourAgoTs(now: Date = new Date()): number {
  const d = new Date(now.getTime() - 60 * MIN);
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 5), 0, 0);
  return d.getTime();
}

// "HH:MM" for a time input.
export function toTimeInputValue(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// A picked clock time resolved to a real moment. A meal being logged has already happened, so a time
// later than now means one of two things: a small overshoot on the wheel (within two hours, treated
// as now) or a time from yesterday (11:30 PM picked at 12:40 AM, or last night's 8 PM dinner).
export function resolvePickedTime(hhmm: string, now: Date = new Date()): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  const ahead = d.getTime() - now.getTime();
  if (ahead <= MIN) return d.getTime();
  if (ahead < 2 * 60 * MIN) return now.getTime();
  d.setDate(d.getDate() - 1);
  return d.getTime();
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "Today, 1:15 PM" / "Yesterday, 7:00 PM".
export function mealTimeLabel(ts: number, now: Date = new Date()): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay(d, now)) return `Today, ${time}`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}

// "Remind Me After Breakfast": the next whole hour at least an hour away, no earlier than 8 AM and
// no later than 11 AM, so it lands after a normal breakfast while it's still morning (7:40 gives
// 9 AM). Whole hours because the server reminder job (app/api/cron/reminder) runs at the top of
// each hour.
export function breakfastReminderTime(now: Date = new Date()): number {
  const t = new Date(now.getTime() + 60 * MIN);
  if (t.getMinutes() || t.getSeconds() || t.getMilliseconds()) t.setHours(t.getHours() + 1, 0, 0, 0);
  const floor = new Date(now);
  floor.setHours(8, 0, 0, 0);
  const cap = new Date(now);
  cap.setHours(11, 0, 0, 0);
  let at = Math.max(t.getTime(), floor.getTime());
  if (at > cap.getTime()) at = cap.getTime();
  // Only reachable if this is ever called after 10:30: never schedule something already past.
  if (at < now.getTime() + 30 * MIN) at = t.getTime();
  return at;
}

// "9 AM" / "9:30 AM".
export function shortClockLabel(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", d.getMinutes() ? { hour: "numeric", minute: "2-digit" } : { hour: "numeric" });
}

// ── Meal counting ─────────────────────────────────────────────────────────
// A first log only counts once the row is really saved: optimistic pills ("optimistic-…" ids) and
// failed or unsaved ones don't, and neither do the auto-logged daily supplements.
function isFood(m: MealLog): boolean {
  return m.analysisJson?.source !== "supplement";
}
export function savedMealCount(meals: MealLog[]): number {
  return meals.filter((m) => isFood(m) && !m.id.startsWith("optimistic") && m.status !== "failed" && m.status !== "unsaved").length;
}
export function hasPendingMeal(meals: MealLog[]): boolean {
  return meals.some((m) => isFood(m) && m.id.startsWith("optimistic") && m.status === "done");
}

// ── localStorage records ──────────────────────────────────────────────────
export type FirstMealRecord = { startedAt: number; baseline: number };
export type FirstMealReminder = { at: number; baseline: number };
export type FirstHabitStart = "logged" | "skipped";

const recordKey = (uid: string) => `wya_first_meal_${uid}`;
const habitKey = (uid: string) => `wya_first_habit_${uid}`;
const reminderKey = (uid: string) => `wya_first_meal_reminder_${uid}`;
export const FIRST_MEAL_STORAGE_KEYS = (uid: string) => [recordKey(uid), habitKey(uid), reminderKey(uid)];

function readJson<T>(key: string, valid: (v: unknown) => v is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return valid(v) ? v : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}
function remove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRecord = (v: unknown): v is FirstMealRecord =>
  !!v && typeof v === "object" && isNum((v as FirstMealRecord).startedAt) && isNum((v as FirstMealRecord).baseline);
const isReminder = (v: unknown): v is FirstMealReminder =>
  !!v && typeof v === "object" && isNum((v as FirstMealReminder).at) && isNum((v as FirstMealReminder).baseline);

export const readFirstMeal = (uid: string) => readJson(recordKey(uid), isRecord);
export const writeFirstMeal = (uid: string, rec: FirstMealRecord) => writeJson(recordKey(uid), rec);
export const clearFirstMeal = (uid: string) => remove(recordKey(uid));

export const readFirstMealReminder = (uid: string) => readJson(reminderKey(uid), isReminder);
export const writeFirstMealReminder = (uid: string, rec: FirstMealReminder) => writeJson(reminderKey(uid), rec);
export const clearFirstMealReminder = (uid: string) => remove(reminderKey(uid));

export function readFirstHabitStart(uid: string): FirstHabitStart | null {
  try {
    const v = localStorage.getItem(habitKey(uid));
    return v === "logged" || v === "skipped" ? v : null;
  } catch {
    return null;
  }
}
export function writeFirstHabitStart(uid: string, v: FirstHabitStart): void {
  try { localStorage.setItem(habitKey(uid), v); } catch { /* ignore */ }
}
export const clearFirstHabitStart = (uid: string) => remove(habitKey(uid));
