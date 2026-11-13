// The "first meal" step at the end of onboarding: the clock rules it follows and the small pieces of
// per-user state it keeps in localStorage. Kept free of React so the time logic can be checked on its
// own. The UI lives in components/FirstMealStep.tsx and the wiring in HomeScreen.
//
// State, all keyed by user id:
//   wya_first_meal_<uid>           the step is still waiting (written only when onboarding finishes,
//                                  so people who onboarded before this shipped never see it)
//   wya_first_habit_<uid>          "logged" | "skipped": start Find Your Rhythm today, once the habit
//                                  engine has loaded (consumed by HomeScreen)
//   wya_first_meal_reminder_<uid>  "Remind Me After Breakfast", or the one follow-up after "Not Now":
//                                  an in-app prompt on the next open after the chosen time (same
//                                  day), for when a push can't reach them

import type { MealAnalysis, MealLog } from "./types";

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

// The first meal is always logged today, at a time no later than now (backdating to last night
// would also start free access a day early, since it starts at the first real meal).
export function startOfToday(now: Date = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
export function clampToToday(ts: number, now: Date = new Date()): number {
  return Math.min(Math.max(ts, startOfToday(now)), now.getTime());
}

// Default meal time: now for "Yes, Log It" in the morning; about an hour ago (rounded down to five
// minutes) for "What Did You Last Eat?", but never before midnight.
export function defaultMealTs(period: FirstMealPeriod, now: Date = new Date()): number {
  if (period === "morning") return now.getTime();
  const d = new Date(now.getTime() - 60 * MIN);
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 5), 0, 0);
  return clampToToday(d.getTime(), now);
}

// Choices for the time wheel: today, every five minutes from midnight up to now, plus now itself
// and the current pick (so the wheel opens on it). Values are minutes after midnight, so nothing
// later than now can be picked.
export function todayTimeOptions(now: Date = new Date(), include?: number): { value: string; label: string }[] {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const set = new Set<number>();
  for (let m = 0; m <= nowMin; m += 5) set.add(m);
  set.add(nowMin);
  if (include != null && include >= 0 && include <= nowMin) set.add(include);
  return [...set].sort((a, b) => a - b).map((m) => ({ value: String(m), label: clockLabel(atMinute(m, now)) }));
}
export function minuteOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}
export function atMinute(minuteOfDay: number, now: Date = new Date()): number {
  const d = new Date(now);
  d.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return d.getTime();
}

function clockLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// "Today, 1:15 PM" (the chip on the first-meal loggers).
export function mealTimeLabel(ts: number): string {
  return `Today, ${clockLabel(ts)}`;
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

// The one follow-up after "Not Now" on the step, at the next likely mealtime: before 11:00 it asks
// about lunch at 1 PM, from 11:00 to 16:00 about dinner at 7 PM, and later than that about
// breakfast at 9 AM the next morning. Whole hours just after the meal (so "what did you have"
// makes sense), because the reminder cron runs at the top of each hour.
export function notNowFollowUpTime(now: Date = new Date()): number {
  const m = now.getHours() * 60 + now.getMinutes();
  const d = new Date(now);
  if (m < 11 * 60) d.setHours(13, 0, 0, 0);
  else if (m < 16 * 60) d.setHours(19, 0, 0, 0);
  else {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  }
  return d.getTime();
}

// Which meal a reminder at this local hour is about. The reminder cron derives the same thing from
// the stored time and the user's timezone offset (see mealKindForLocalHour in the cron), so the
// push and the in-app prompt always agree without storing a separate kind.
export type ReminderKind = "breakfast" | "lunch" | "dinner";
export function mealKindForHour(hour: number): ReminderKind {
  if (hour >= 4 && hour < 12) return "breakfast";
  if (hour >= 12 && hour < 17) return "lunch";
  return "dinner";
}
export function reminderKindAt(ts: number): ReminderKind {
  return mealKindForHour(new Date(ts).getHours());
}

// Placeholder for a meal saved before its analysis comes back. All zeros, so nothing invented
// reaches the totals, the history or the coach; the server swaps in the real analysis (status
// "done") or the meal is marked failed. `name` keeps what the user typed, so the pill can say
// what's being analysed and the fix-it prompt can start from it.
export function pendingAnalysis(name?: string): MealAnalysis {
  const typed = name?.trim();
  return {
    ...(typed ? { name: typed } : {}),
    detected_items: [],
    estimated_ranges: {
      calories_min: 0, calories_max: 0,
      protein_g_min: 0, protein_g_max: 0,
      carbs_g_min: 0, carbs_g_max: 0,
      fat_g_min: 0, fat_g_max: 0,
    },
    micronutrient_signals: [],
    confidence_overall_0_1: 0,
    detected_brand: null,
    detected_product: null,
    database_match_confidence_0_1: null,
    precision_mode_available: false,
  };
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

// Meals logged so far, in any state but unsaved, for "stop the first-meal reminders once a meal is
// logged". Water and feelings don't count: they aren't a first meal (the water option on the step
// leaves the lunch reminder in place), and the cron applies the same rule.
export function mealLogCount(meals: MealLog[]): number {
  return meals.filter((m) => isFood(m) && !m.id.startsWith("optimistic") && m.status !== "unsaved").length;
}

// ── localStorage records ──────────────────────────────────────────────────
export type FirstMealRecord = { startedAt: number; baseline: number };
// baseline: mealLogCount when it was set. kind is derived from `at` when missing (older records).
export type FirstMealReminder = { at: number; baseline: number; kind?: ReminderKind };
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
