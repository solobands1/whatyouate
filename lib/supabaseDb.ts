import { supabase } from "./supabaseClient";
import type { MealAnalysis, MealLog, UserProfile, WorkoutSession } from "./types";
import { approxFromRange } from "./utils";
import { safeFallbackAnalysis } from "./ai/schema";

const DEBUG = false;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (DEBUG && supabaseUrl) {
  try {
    console.debug("[supabase] url host:", new URL(supabaseUrl).host);
  } catch {
    console.debug("[supabase] url host: invalid");
  }
}

function handleSupabaseError(table: string, error: any) {
  if (!error) return;
  if (error?.status === 404) {
    throw new Error(
      `Supabase table not found: ${table} (check SUPABASE_URL points to correct project and table exists in public schema)`
    );
  }
  throw error;
}

function mapMeal(row: any): MealLog {
  let analysis = row.analysis_json;
  if (!analysis || !analysis.estimated_ranges) {
    analysis = safeFallbackAnalysis();
  }
  if (analysis?.estimated_ranges) {
    if (typeof row.calories === "number") {
      analysis.estimated_ranges.calories_min = row.calories;
      analysis.estimated_ranges.calories_max = row.calories;
    }
    if (typeof row.protein === "number") {
      analysis.estimated_ranges.protein_g_min = row.protein;
      analysis.estimated_ranges.protein_g_max = row.protein;
    }
    if (typeof row.carbs === "number") {
      analysis.estimated_ranges.carbs_g_min = row.carbs;
      analysis.estimated_ranges.carbs_g_max = row.carbs;
    }
    if (typeof row.fat === "number") {
      analysis.estimated_ranges.fat_g_min = row.fat;
      analysis.estimated_ranges.fat_g_max = row.fat;
    }
  }
  return {
    id: String(row.id),
    ts: (() => {
      const explicit = Number(row.ts);
      if (Number.isFinite(explicit) && explicit > 0) return explicit;
      const parsed = new Date(row.created_at ?? Date.now()).getTime();
      return Number.isFinite(parsed) ? parsed : Date.now();
    })(),
    analysisJson: analysis,
    userCorrection: undefined,
    imageThumb: row.image_url ?? undefined
  };
}

function mapWorkout(row: any): WorkoutSession {
  const startedAt = row.started_at ? new Date(row.started_at).getTime() : undefined;
  const endedAt = row.ended_at ? new Date(row.ended_at).getTime() : undefined;
  let durationMin: number | undefined;
  if (startedAt && endedAt) {
    const rawMinutes = (endedAt - startedAt) / 60000;
    durationMin = rawMinutes < 1 ? 0 : Math.ceil(rawMinutes);
  }
  return {
    id: String(row.id),
    startTs: startedAt ?? Date.now(),
    endTs: endedAt,
    durationMin,
    workoutTypes: Array.isArray(row.workout_types) ? row.workout_types : undefined,
    intensity: row.intensity ?? undefined
  };
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  if (DEBUG) console.debug("[supabase] getProfile -> profiles");
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) handleSupabaseError("profiles", error);
  if (!data) return null;
  if (DEBUG) console.debug("[supabase] profiles rows:", 1);

  return {
    id: data.user_id,
    firstName: data.first_name ?? "",
    lastName: data.last_name ?? "",
    height: data.height ?? null,
    weight: data.weight ?? null,
    age: data.age ?? null,
    sex: data.sex ?? "prefer_not",
    goalDirection: data.goal_direction === "recomposition" ? "balance" : (data.goal_direction ?? "maintain"),
    bodyPriority: data.body_priority ?? "",
    units: data.units ?? "metric"
  };
}

export async function saveProfile(userId: string, profile: UserProfile) {
  const payload = {
    user_id: userId,
    first_name: profile.firstName ?? null,
    last_name: profile.lastName ?? null,
    height: profile.height ?? null,
    weight: profile.weight ?? null,
    age: profile.age ?? null,
    sex: profile.sex,
    goal_direction: profile.goalDirection,
    body_priority: profile.bodyPriority ?? "",
    units: profile.units,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "user_id" });
  if (error) throw error;
}

export async function addMeal(userId: string, analysis: MealAnalysis, imageOptional?: string, corrections?: any) {
  const ranges = analysis.estimated_ranges;
  const created_at = new Date().toISOString();
  const payload = {
    user_id: userId,
    created_at,
    analysis_json: analysis,
    image_url: imageOptional ?? null,
    calories: approxFromRange(ranges.calories_min, ranges.calories_max),
    protein: approxFromRange(ranges.protein_g_min, ranges.protein_g_max),
    carbs: approxFromRange(ranges.carbs_g_min, ranges.carbs_g_max),
    fat: approxFromRange(ranges.fat_g_min, ranges.fat_g_max)
  };
  const { data, error } = await supabase.from("meals").insert(payload).select("*").single();
  if (error) {
    console.error("[addMeal] error:", error);
    handleSupabaseError("meals", error);
  }
  return mapMeal(data);
}

export async function updateMeal(id: string, analysis: MealAnalysis, corrections?: any) {
  const ranges = analysis.estimated_ranges;
  const payload = {
    analysis_json: analysis,
    calories: approxFromRange(ranges.calories_min, ranges.calories_max),
    protein: approxFromRange(ranges.protein_g_min, ranges.protein_g_max),
    carbs: approxFromRange(ranges.carbs_g_min, ranges.carbs_g_max),
    fat: approxFromRange(ranges.fat_g_min, ranges.fat_g_max)
  };
  const { data, error } = await supabase.from("meals").update(payload).eq("id", id).select("*").single();
  if (error) handleSupabaseError("meals", error);
  return mapMeal(data);
}

export async function listMeals(userId: string, limit = 50) {
  if (DEBUG) console.debug("[supabase] listMeals -> meals");
  const { data, error } = await supabase
    .from("meals")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) handleSupabaseError("meals", error);
  return (data ?? []).map(mapMeal);
}

export async function deleteMeal(id: string, userId?: string) {
  let query = supabase.from("meals").delete().eq("id", id);
  if (userId) {
    query = query.eq("user_id", userId);
  }
  const { error } = await query;
  if (error) handleSupabaseError("meals", error);
}

export async function addWorkout(
  userId: string,
  startTs: number,
  workoutTypes?: string[],
  intensity?: "low" | "medium" | "high"
) {
  const payload = {
    user_id: userId,
    started_at: new Date(startTs).toISOString(),
    workout_types: workoutTypes && workoutTypes.length > 0 ? workoutTypes : null,
    intensity: intensity ?? null
  };
  const { data, error } = await supabase.from("workouts").insert(payload).select("*").single();
  if (error) handleSupabaseError("workouts", error);
  return mapWorkout(data);
}

export async function updateWorkout(
  id: string,
  userId: string | null,
  endTs: number,
  durationMin: number,
  workoutTypes?: string[],
  intensity?: "low" | "medium" | "high"
) {
  const payload: Record<string, unknown> = {
    ended_at: new Date(endTs).toISOString(),
    workout_types: workoutTypes && workoutTypes.length > 0 ? workoutTypes : null,
    intensity: intensity ?? null
  };
  let query = supabase.from("workouts").update(payload).eq("id", id);
  if (userId) {
    query = query.eq("user_id", userId);
  }
  const { data, error } = await query.select("*").single();
  if (error) handleSupabaseError("workouts", error);
  return mapWorkout(data);
}

export async function endActiveWorkouts(
  userId: string,
  endTs: number,
  workoutTypes?: string[],
  intensity?: "low" | "medium" | "high"
) {
  const payload: Record<string, unknown> = {
    ended_at: new Date(endTs).toISOString(),
    workout_types: workoutTypes && workoutTypes.length > 0 ? workoutTypes : null,
    intensity: intensity ?? null
  };
  const { data, error } = await supabase
    .from("workouts")
    .update(payload)
    .eq("user_id", userId)
    .is("ended_at", null)
    .select("*");
  if (error) handleSupabaseError("workouts", error);
  return (data ?? []).map(mapWorkout);
}

export async function deleteWorkout(id: string, userId?: string) {
  let query = supabase.from("workouts").delete().eq("id", id);
  if (userId) {
    query = query.eq("user_id", userId);
  }
  const { error } = await query;
  if (error) handleSupabaseError("workouts", error);
}

export async function listWorkouts(userId: string, limit = 50) {
  if (DEBUG) console.debug("[supabase] listWorkouts -> workouts");
  const { data, error } = await supabase
    .from("workouts")
    .select("*")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) handleSupabaseError("workouts", error);
  if (DEBUG) console.debug("[supabase] workouts rows:", data?.length ?? 0);
  return (data ?? []).map(mapWorkout);
}

export async function getActiveWorkout(userId: string) {
  const { data, error } = await supabase
    .from("workouts")
    .select("*")
    .eq("user_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) handleSupabaseError("workouts", error);
  return data?.[0] ? mapWorkout(data[0]) : null;
}

export async function addNudge(userId: string, type: string, message: string) {
  const payload = {
    user_id: userId,
    type,
    message
  };
  const { data, error } = await supabase.from("nudges").insert(payload).select("*").single();
  if (error) handleSupabaseError("nudges", error);
  return data;
}

export async function listNudges(userId: string, limit = 50) {
  if (DEBUG) console.debug("[supabase] listNudges -> nudges");
  const { data, error } = await supabase
    .from("nudges")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) handleSupabaseError("nudges", error);
  if (DEBUG) console.debug("[supabase] nudges rows:", data?.length ?? 0);
  return data ?? [];
}

export async function exportAllData(userId: string) {
  const profile = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  const meals = await supabase.from("meals").select("*").eq("user_id", userId);
  const workouts = await supabase.from("workouts").select("*").eq("user_id", userId);
  const nudges = await supabase.from("nudges").select("*").eq("user_id", userId);
  if (profile.error || meals.error || workouts.error) {
    throw profile.error || meals.error || workouts.error || nudges.error;
  }
  return {
    profile: profile.data,
    meals: meals.data ?? [],
    workouts: workouts.data ?? [],
    nudges: nudges.data ?? []
  };
}

export async function clearAllData(userId: string) {
  const meals = await supabase.from("meals").delete().eq("user_id", userId);
  const workouts = await supabase.from("workouts").delete().eq("user_id", userId);
  const profile = await supabase.from("profiles").delete().eq("user_id", userId);
  const nudges = await supabase.from("nudges").delete().eq("user_id", userId);
  if (meals.error || workouts.error || profile.error || nudges.error) {
    throw meals.error || workouts.error || profile.error || nudges.error;
  }
}
