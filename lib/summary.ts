import type { DailyRange, MealLog, WorkoutSession } from "./types";
import { dayKeyFromTs, localDayKeyFromTs, localTodayKey, todayKey } from "./utils";

export function summarizeDay(meals: MealLog[], dateKey?: string, offsetMinutes?: number): DailyRange {
  const getKey = offsetMinutes !== undefined
    ? (ts: number) => localDayKeyFromTs(ts, offsetMinutes)
    : dayKeyFromTs;
  const key = dateKey ?? (offsetMinutes !== undefined ? localTodayKey(offsetMinutes) : todayKey());
  const totals = meals
    .filter((meal) => getKey(meal.ts) === key && meal.status !== "processing" && meal.status !== "failed")
    .reduce(
      (acc, meal) => {
        const ranges = meal.analysisJson.estimated_ranges;
        const cal = meal.calories ?? null;
        const pro = meal.protein ?? null;
        const carb = meal.carbs ?? null;
        const fat = meal.fat ?? null;
        acc.calories_min += cal !== null ? cal : ranges.calories_min;
        acc.calories_max += cal !== null ? cal : ranges.calories_max;
        acc.protein_g_min += pro !== null ? pro : ranges.protein_g_min;
        acc.protein_g_max += pro !== null ? pro : ranges.protein_g_max;
        acc.carbs_g_min += carb !== null ? carb : ranges.carbs_g_min;
        acc.carbs_g_max += carb !== null ? carb : ranges.carbs_g_max;
        acc.fat_g_min += fat !== null ? fat : ranges.fat_g_min;
        acc.fat_g_max += fat !== null ? fat : ranges.fat_g_max;
        return acc;
      },
      {
        calories_min: 0,
        calories_max: 0,
        protein_g_min: 0,
        protein_g_max: 0,
        carbs_g_min: 0,
        carbs_g_max: 0,
        fat_g_min: 0,
        fat_g_max: 0
      }
    );

  return totals;
}

export function summarizeWeek(meals: MealLog[], days = 7, offsetMinutes?: number) {
  const result: Array<{ dateKey: string; totals: DailyRange }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    let key: string;
    if (offsetMinutes !== undefined) {
      key = localDayKeyFromTs(Date.now() - i * 24 * 60 * 60 * 1000, offsetMinutes);
    } else {
      const date = new Date();
      date.setDate(date.getDate() - i);
      key = todayKey(date);
    }
    result.push({ dateKey: key, totals: summarizeDay(meals, key, offsetMinutes) });
  }
  return result;
}

/** Like summarizeWeek but only includes days with 2+ non-supplement meals logged.
 *  Using 2+ meals as the threshold ensures averages reflect real eating days,
 *  not days where only a snack or single item was logged.
 *  Pass excludeToday=true when computing historical averages (e.g. nudges). */
export function summarizeLoggedDays(meals: MealLog[], days = 7, excludeToday = false) {
  const today = excludeToday ? todayKey() : null;
  const mealCountByDay = new Map<string, number>();
  for (const m of meals) {
    if (m.analysisJson?.source === "supplement" || m.status === "failed") continue;
    const key = dayKeyFromTs(m.ts);
    mealCountByDay.set(key, (mealCountByDay.get(key) ?? 0) + 1);
  }
  return summarizeWeek(meals, days).filter(
    (d) => (!today || d.dateKey !== today) && (mealCountByDay.get(d.dateKey) ?? 0) >= 2
  );
}

export function summarizeWorkoutsWeek(workouts: WorkoutSession[]) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const sessions = workouts.filter((session) => session.endTs != null && session.endTs >= cutoff);
  const totalMinutes = sessions.reduce((acc, session) => acc + (session.durationMin ?? 0), 0);
  return {
    count: sessions.length,
    totalMinutes
  };
}
