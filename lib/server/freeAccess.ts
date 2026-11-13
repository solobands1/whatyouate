// Free Access for the crons (2pm meal push, 9am coach nudge, weekly summary), computed exactly the
// way the phone computes it (lib/trial.ts computeWall): the same meals the app loads, the nightly
// reflections, and the user's timezone, so a push never goes to someone the app has walled, or
// skips someone the app still treats as in Free Access. Paid status is separate: callers OR this
// with checkProEntitlement (lib/entitlement.ts), as before.

import type { SupabaseClient } from "@supabase/supabase-js";
import { FREE_ACCESS_CAP_MS, firstRealMealTs, isTrialEligible, type TrialMeal, type TrialReflection } from "../trial";

// The app loads the newest 400 meals in every state (lib/supabaseDb.ts listMeals); match it.
const APP_MEAL_LIMIT = 400;

// Same mapping as the app's mapMeal: a row without an analysis reads as failed there.
function toTrialMeal(row: Record<string, unknown>): TrialMeal {
  const analysis = row.analysis_json as Record<string, unknown> | null;
  const tsRaw = Number(row.ts);
  const createdMs = row.created_at ? new Date(row.created_at as string).getTime() : NaN;
  const ts = Number.isFinite(tsRaw) && tsRaw > 0 ? tsRaw : Number.isFinite(createdMs) ? createdMs : Date.now();
  const hasAnalysis = !!analysis?.estimated_ranges;
  return {
    ts,
    createdAt: Number.isFinite(createdMs) ? createdMs : null,
    status: hasAnalysis ? ((row.status as string) ?? "done") : "failed",
    analysisJson: hasAnalysis
      ? {
          source: (analysis!.source as string) ?? null,
          feeling_tags: Array.isArray(analysis!.feeling_tags) ? (analysis!.feeling_tags as string[]) : [],
        }
      : null,
  };
}

/**
 * Whether the user is in Free Access right now, as the app sees it.
 *
 * `meals` is optional: whatever the cron already loaded. It's only used to skip the lookups for
 * someone already past the 14-day cap (the cron's meals are a subset of the real history, so if
 * they say "past the cap", the full history does too). Everyone else gets their own rows read.
 *
 * Fails closed: if a lookup errors, the user is treated as not in Free Access for this run (they
 * still get the push if they've paid), and the error is logged.
 */
export async function isFreeAccessEligible(
  supabase: SupabaseClient,
  userId: string,
  opts: { meals?: TrialMeal[]; now?: number } = {},
): Promise<boolean> {
  const now = opts.now ?? Date.now();
  const knownFirst = opts.meals ? firstRealMealTs(opts.meals) : null;
  if (knownFirst != null && now >= knownFirst + FREE_ACCESS_CAP_MS) return false;

  const [mealsRes, profileRes] = await Promise.all([
    supabase
      .from("meals")
      .select("ts, created_at, status, analysis_json")
      .eq("user_id", userId)
      .order("ts", { ascending: false, nullsFirst: false })
      .limit(APP_MEAL_LIMIT),
    supabase.from("profiles").select("reflections_json, timezone_offset_minutes").eq("user_id", userId).maybeSingle(),
  ]);
  if (mealsRes.error || profileRes.error) {
    console.error(
      `[freeAccess] lookup failed for ${userId.slice(0, 8)}:`,
      mealsRes.error?.message ?? profileRes.error?.message,
    );
    return false;
  }

  const meals = ((mealsRes.data ?? []) as Record<string, unknown>[]).map(toTrialMeal);
  const profile = (profileRes.data ?? null) as { reflections_json?: unknown; timezone_offset_minutes?: unknown } | null;
  const reflections = Array.isArray(profile?.reflections_json) ? (profile!.reflections_json as TrialReflection[]) : [];
  const offset = profile?.timezone_offset_minutes;
  // No stored offset: read days in UTC, the same fallback the crons use for their local hour.
  const tzOffsetMinutes = typeof offset === "number" && Number.isFinite(offset) ? offset : 0;
  return isTrialEligible(meals, now, { reflections, tzOffsetMinutes });
}
