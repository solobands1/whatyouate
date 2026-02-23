import type { DailyRange, MealLog, WorkoutSession } from "./types";
import { dayKeyFromTs, todayKey } from "./utils";

export function summarizeDay(meals: MealLog[], dateKey = todayKey()): DailyRange {
  const totals = meals
    .filter((meal) => dayKeyFromTs(meal.ts) === dateKey)
    .reduce(
      (acc, meal) => {
        const ranges = meal.analysisJson.estimated_ranges;
        acc.calories_min += ranges.calories_min;
        acc.calories_max += ranges.calories_max;
        acc.protein_g_min += ranges.protein_g_min;
        acc.protein_g_max += ranges.protein_g_max;
        acc.fat_g_min += ranges.fat_g_min;
        acc.fat_g_max += ranges.fat_g_max;
        return acc;
      },
      {
        calories_min: 0,
        calories_max: 0,
        protein_g_min: 0,
        protein_g_max: 0,
        fat_g_min: 0,
        fat_g_max: 0
      }
    );

  return totals;
}

export function summarizeWeek(meals: MealLog[], days = 7) {
  const result: Array<{ dateKey: string; totals: DailyRange }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const key = todayKey(date);
    result.push({ dateKey: key, totals: summarizeDay(meals, key) });
  }
  return result;
}

export function summarizeWorkoutsWeek(workouts: WorkoutSession[]) {
  const startOfWeek = new Date();
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  const sessions = workouts.filter((session) => new Date(session.startTs) >= startOfWeek);
  const totalMinutes = sessions.reduce((acc, session) => acc + (session.durationMin ?? 0), 0);
  return {
    count: sessions.length,
    totalMinutes
  };
}
