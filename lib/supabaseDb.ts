import { supabase } from "./supabaseClient";
import { LOCAL_MODE } from "./config";
import type { MealAnalysis, MealLog, UserProfile, WorkoutSession } from "./types";
import { approxFromRange } from "./utils";
import { safeFallbackAnalysis } from "./ai/schema";

export { LOCAL_MODE };

const DEBUG = false;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const useMemory = LOCAL_MODE;
if (DEBUG && supabaseUrl) {
  try {
    console.debug("[supabase] url host:", new URL(supabaseUrl).host);
  } catch {
    console.debug("[supabase] url host: invalid");
  }
}

type MealRecord = { userId: string; meal: MealLog };
type WorkoutRecord = { userId: string; session: WorkoutSession };
type NudgeRecord = { id: string; userId: string; type: string; message: string; createdAt: number };

let memMeals: MealRecord[] = [];
let memWorkouts: WorkoutRecord[] = [];
let memProfiles: Record<string, UserProfile> = {};
let memNudges: NudgeRecord[] = [];
const LOCAL_DATA_KEY = "wya_local_data_v1";
let localLoaded = false;

const ensureLocalLoaded = () => {
  if (!useMemory || typeof window === "undefined" || localLoaded) return;
  localLoaded = true;
  try {
    const raw = localStorage.getItem(LOCAL_DATA_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      memMeals?: MealRecord[];
      memWorkouts?: WorkoutRecord[];
      memProfiles?: Record<string, UserProfile>;
      memNudges?: NudgeRecord[];
    };
    memMeals = Array.isArray(parsed.memMeals) ? parsed.memMeals : [];
    memWorkouts = Array.isArray(parsed.memWorkouts) ? parsed.memWorkouts : [];
    memProfiles = parsed.memProfiles ?? {};
    memNudges = Array.isArray(parsed.memNudges) ? parsed.memNudges : [];
  } catch {
    // Ignore malformed local data.
  }
};

const persistLocal = () => {
  if (!useMemory || typeof window === "undefined") return;
  const sanitizedMeals = memMeals.map((entry) => ({
    ...entry,
    meal: {
      ...entry.meal,
      imageBlob: undefined
    }
  }));
  const sanitizedWorkouts = memWorkouts.map((entry) => ({
    ...entry,
    session: {
      ...entry.session,
      startImageBlob: undefined,
      endImageBlob: undefined
    }
  }));
  const payload = {
    memMeals: sanitizedMeals,
    memWorkouts: sanitizedWorkouts,
    memProfiles,
    memNudges
  };
  try {
    localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures (quota or private mode).
  }
};

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function computeDurationMin(startTs: number, endTs: number) {
  const rawMinutes = (endTs - startTs) / 60000;
  return rawMinutes < 1 ? 0 : Math.ceil(rawMinutes);
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
  const startedAt = row.start_ts ? new Date(row.start_ts).getTime() : undefined;
  const endedAt = row.end_ts ? new Date(row.end_ts).getTime() : undefined;
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
  if (useMemory) {
    ensureLocalLoaded();
    return memProfiles[userId] ?? null;
  }

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
    units: data.units ?? "imperial"
  };
}

export async function saveProfile(userId: string, profile: UserProfile) {
  if (useMemory) {
    ensureLocalLoaded();
    memProfiles[userId] = profile;
    persistLocal();
    return;
  }

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
  if (useMemory) {
    ensureLocalLoaded();
    const meal: MealLog = {
      id: newId("meal"),
      ts: Date.now(),
      analysisJson: analysis,
      userCorrection: undefined,
      imageThumb: imageOptional ?? undefined
    };
    memMeals.push({ userId, meal });
    persistLocal();
    return meal;
  }

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
  if (useMemory) {
    ensureLocalLoaded();
    const record = memMeals.find((entry) => entry.meal.id === id);
    if (record) {
      record.meal = {
        ...record.meal,
        analysisJson: analysis
      };
      persistLocal();
      return record.meal;
    }
    const meal: MealLog = {
      id,
      ts: Date.now(),
      analysisJson: analysis,
      userCorrection: undefined,
      imageThumb: undefined
    };
    memMeals.push({ userId: "unknown", meal });
    persistLocal();
    return meal;
  }

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
  if (useMemory) {
    ensureLocalLoaded();
    return memMeals
      .filter((entry) => entry.userId === userId)
      .map((entry) => entry.meal)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  }

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
  if (useMemory) {
    ensureLocalLoaded();
    memMeals = memMeals.filter((entry) => {
      if (entry.meal.id !== id) return true;
      if (!userId) return false;
      return entry.userId !== userId;
    });
    persistLocal();
    return;
  }

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
  if (useMemory) {
    ensureLocalLoaded();
    const session: WorkoutSession = {
      id: newId("workout"),
      startTs,
      workoutTypes,
      intensity
    };
    memWorkouts.push({ userId, session });
    persistLocal();
    return session;
  }

  console.log("[workout] DB insert", { userId, startTs });

  const { data, error } = await supabase
    .from("workouts")
    .insert({
      user_id: userId,
      start_ts: startTs
    })
    .select("*")
    .single();

  if (error) {
    console.error("[workout] DB error", error);
    throw error;
  }

  console.log("[workout] DB inserted row", data);

  return data;
}

export async function updateWorkout(
  id: string,
  userId: string | null,
  endTs: number,
  durationMin: number,
  workoutTypes?: string[],
  intensity?: "low" | "medium" | "high"
) {
  if (useMemory) {
    ensureLocalLoaded();
    const record = memWorkouts.find(
      (entry) => entry.session.id === id && (userId ? entry.userId === userId : true)
    );
    if (record) {
      record.session = {
        ...record.session,
        endTs,
        durationMin,
        workoutTypes,
        intensity
      };
      persistLocal();
      return record.session;
    }
    const inferredStart = endTs - Math.max(0, durationMin) * 60000;
    const session: WorkoutSession = {
      id,
      startTs: Number.isFinite(inferredStart) ? inferredStart : endTs,
      endTs,
      durationMin,
      workoutTypes,
      intensity
    };
    memWorkouts.push({ userId: userId ?? "unknown", session });
    persistLocal();
    return session;
  }

  const payload: Record<string, unknown> = {
    end_ts: endTs,
    duration_min: durationMin,
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
  if (useMemory) {
    ensureLocalLoaded();
    const updated: WorkoutSession[] = [];
    memWorkouts = memWorkouts.map((entry) => {
      if (entry.userId !== userId) return entry;
      if (entry.session.endTs) return entry;
      const durationMin = computeDurationMin(entry.session.startTs, endTs);
      const session = {
        ...entry.session,
        endTs,
        durationMin,
        workoutTypes,
        intensity
      };
      updated.push(session);
      return { ...entry, session };
    });
    persistLocal();
    return updated;
  }

  const payload: Record<string, unknown> = {
    end_ts: new Date(endTs).toISOString(),
    workout_types: workoutTypes && workoutTypes.length > 0 ? workoutTypes : null,
    intensity: intensity ?? null
  };
  const { data, error } = await supabase
    .from("workouts")
    .update(payload)
    .eq("user_id", userId)
    .is("end_ts", null)
    .select("*");
  if (error) handleSupabaseError("workouts", error);
  return (data ?? []).map(mapWorkout);
}

export async function deleteWorkout(id: string, userId?: string) {
  if (useMemory) {
    ensureLocalLoaded();
    memWorkouts = memWorkouts.filter((entry) => {
      if (entry.session.id !== id) return true;
      if (!userId) return false;
      return entry.userId !== userId;
    });
    persistLocal();
    return;
  }

  let query = supabase.from("workouts").delete().eq("id", id);
  if (userId) {
    query = query.eq("user_id", userId);
  }
  const { error } = await query;
  if (error) handleSupabaseError("workouts", error);
}

export async function listWorkouts(userId: string, limit = 50) {
  if (useMemory) {
    ensureLocalLoaded();
    return memWorkouts
      .filter((entry) => entry.userId === userId)
      .map((entry) => entry.session)
      .sort((a, b) => b.startTs - a.startTs)
      .slice(0, limit);
  }

  if (DEBUG) console.debug("[supabase] listWorkouts -> workouts");
  const { data, error } = await supabase
    .from("workouts")
    .select("*")
    .eq("user_id", userId)
    .order("start_ts", { ascending: false })
    .limit(limit);
  if (error) handleSupabaseError("workouts", error);
  if (DEBUG) console.debug("[supabase] workouts rows:", data?.length ?? 0);
  return (data ?? []).map(mapWorkout);
}

export async function getActiveWorkout(userId: string) {
  if (useMemory) {
    ensureLocalLoaded();
    const active = memWorkouts
      .filter((entry) => entry.userId === userId && !entry.session.endTs)
      .map((entry) => entry.session)
      .sort((a, b) => b.startTs - a.startTs);
    return active[0] ?? null;
  }

  const { data, error } = await supabase
    .from("workouts")
    .select("*")
    .eq("user_id", userId)
    .is("end_ts", null)
    .order("start_ts", { ascending: false })
    .limit(1);
  if (error) handleSupabaseError("workouts", error);
  return data?.[0] ? mapWorkout(data[0]) : null;
}

export async function addNudge(userId: string, type: string, message: string) {
  if (useMemory) {
    ensureLocalLoaded();
    const nudge: NudgeRecord = {
      id: newId("nudge"),
      userId,
      type,
      message,
      createdAt: Date.now()
    };
    memNudges.push(nudge);
    persistLocal();
    return nudge;
  }

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
  if (useMemory) {
    ensureLocalLoaded();
    return memNudges
      .filter((nudge) => nudge.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

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
  if (useMemory) {
    ensureLocalLoaded();
    return {
      profile: memProfiles[userId] ?? null,
      meals: memMeals.filter((entry) => entry.userId === userId).map((entry) => entry.meal),
      workouts: memWorkouts.filter((entry) => entry.userId === userId).map((entry) => entry.session),
      nudges: memNudges.filter((nudge) => nudge.userId === userId)
    };
  }

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
  if (useMemory) {
    ensureLocalLoaded();
    memMeals = memMeals.filter((entry) => entry.userId !== userId);
    memWorkouts = memWorkouts.filter((entry) => entry.userId !== userId);
    memNudges = memNudges.filter((nudge) => nudge.userId !== userId);
    delete memProfiles[userId];
    persistLocal();
    return;
  }

  const meals = await supabase.from("meals").delete().eq("user_id", userId);
  const workouts = await supabase.from("workouts").delete().eq("user_id", userId);
  const profile = await supabase.from("profiles").delete().eq("user_id", userId);
  const nudges = await supabase.from("nudges").delete().eq("user_id", userId);
  if (meals.error || workouts.error || profile.error || nudges.error) {
    throw meals.error || workouts.error || profile.error || nudges.error;
  }
}

if (typeof window !== "undefined") {
  (window as any).debugDB = {
    listMeals,
    listWorkouts,
    getProfile,
    exportAllData,
    clearAllData
  };
}
