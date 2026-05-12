import { registerPlugin } from "@capacitor/core";
import { supabase } from "./supabaseClient";

interface HealthKitPlugin {
  requestHealthPermissions(): Promise<void>;
  syncActivity(): Promise<{
    steps: Array<{ date: string; steps: number }>;
    workouts: Array<{ startTs: number; endTs: number; durationMin: number; type: string; activeCalories?: number }>;
    sleep: Array<{ date: string; hours: number }>;
  }>;
  openSettings(): Promise<void>;
}

const HealthKit = registerPlugin<HealthKitPlugin>("HealthKit");

export async function requestHealthKitPermissions(): Promise<void> {
  try {
    await HealthKit.requestHealthPermissions();
  } catch {
    // silent — HealthKit unavailable or denied
  }
}

export async function openHealthKitSettings(): Promise<void> {
  try {
    await HealthKit.openSettings();
  } catch {
    // Fallback: open via system URL scheme
    try {
      window.open("app-settings:", "_system");
    } catch {}
  }
}

export async function connectHealthKit(userId: string): Promise<boolean> {
  await requestHealthKitPermissions();
  return syncHealthKitActivity(userId);
}

// Returns true if any data came back — used as proxy for "connected and has data"
export async function syncHealthKitActivity(userId: string): Promise<boolean> {
  try {
    const { steps, workouts, sleep } = await HealthKit.syncActivity();

    if (steps.length > 0) {
      await supabase.from("step_logs").upsert(
        steps.map(({ date, steps: count }) => ({
          user_id: userId,
          date,
          steps: count,
          synced_at: new Date().toISOString(),
        })),
        { onConflict: "user_id,date" }
      );
    }

    if (sleep.length > 0) {
      await supabase.from("sleep_logs").upsert(
        sleep.map(({ date, hours }) => ({
          user_id: userId,
          date,
          hours,
          synced_at: new Date().toISOString(),
        })),
        { onConflict: "user_id,date" }
      );
    }

    if (workouts.length > 0) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from("workouts")
        .select("start_ts")
        .eq("user_id", userId)
        .gte("created_at", thirtyDaysAgo);

      // Coerce stored ts to ms for comparison (DB may store seconds or ms)
      const coerce = (n: number) => (n < 10_000_000_000 ? n * 1000 : n);
      const existingTs = new Set((existing ?? []).map((w: { start_ts: number }) => coerce(w.start_ts)));

      const newWorkouts = workouts.filter(
        (w) => ![...existingTs].some((ts) => Math.abs(ts - w.startTs) < 2000)
      );

      if (newWorkouts.length > 0) {
        await supabase.from("workouts").insert(
          newWorkouts.map((w) => ({
            user_id: userId,
            start_ts: Math.round(w.startTs),
            end_ts: Math.round(w.endTs),
            duration_min: w.durationMin,
            workout_types: [w.type],
            intensity: null,
            created_at: new Date().toISOString(),
          }))
        );
      }
    }

    return steps.length > 0 || workouts.length > 0 || sleep.length > 0;
  } catch {
    return false;
  }
}
