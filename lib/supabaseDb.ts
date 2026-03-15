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
  return {
    id: String(row.id),
    ts: (() => {
      const explicit = Number(row.ts);
      if (Number.isFinite(explicit) && explicit > 0) return explicit;
      const parsed = new Date(row.created_at ?? Date.now()).getTime();
      return Number.isFinite(parsed) ? parsed : Date.now();
    })(),
    analysisJson: analysis,
    calories: row.calories ?? undefined,
    protein: row.protein ?? undefined,
    carbs: row.carbs ?? undefined,
    fat: row.fat ?? undefined,
    userCorrection: undefined,
    imageThumb: row.image_url ?? undefined,
    status: row.status ?? "done"
  };
}

function mapWorkout(row: any): WorkoutSession {
  // Normalize any timestamp value to milliseconds.
  // unix seconds are ~10 digits (< 10^10); unix ms are ~13 digits (>= 10^10).
  const coerceTs = (value: any): number | undefined => {
    if (value == null) return undefined;
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n < 10_000_000_000 ? n * 1000 : n;
  };

  const startedAt = coerceTs(row.start_ts);
  let endedAt = coerceTs(row.end_ts);
  let durationMin: number | undefined;
  const durationFromRow = Number(row.duration_min);
  if (Number.isFinite(durationFromRow) && durationFromRow >= 0) {
    durationMin = durationFromRow;
  } else if (startedAt != null && endedAt != null) {
    const rawMinutes = (endedAt - startedAt) / 60000;
    durationMin = rawMinutes < 1 ? 0 : Math.ceil(rawMinutes);
  }
  if (endedAt == null && startedAt != null && durationMin != null && durationMin > 0) {
    endedAt = startedAt + durationMin * 60000;
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
    activityLevel: data.activity_level ?? undefined,
    dietaryRestrictions: Array.isArray(data.dietary_restrictions) ? data.dietary_restrictions : [],
    units: data.units ?? "imperial"
  };
}

export async function saveProfile(userId: string, profile: UserProfile) {
  if (useMemory) {
    ensureLocalLoaded();
    memProfiles[userId] = profile;
    persistLocal();
    return { success: true };
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
    activity_level: profile.activityLevel ?? null,
    dietary_restrictions: profile.dietaryRestrictions ?? [],
    units: profile.units,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "user_id" });
  if (error) throw error;
  return { success: true };
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
    fat: approxFromRange(ranges.fat_g_min, ranges.fat_g_max),
    status: "processing"
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

  function roundCalories(value: number) {
    if (value <= 50) return Math.round(value / 5) * 5;
    return Math.round(value / 10) * 10;
  }

  function roundGram(value: number) {
    return Math.round(value);
  }

  const ranges = analysis.estimated_ranges;
  const calories =
    ranges.calories_min === ranges.calories_max
      ? ranges.calories_min
      : roundCalories(approxFromRange(ranges.calories_min, ranges.calories_max));
  const protein =
    ranges.protein_g_min === ranges.protein_g_max
      ? ranges.protein_g_min
      : roundGram(approxFromRange(ranges.protein_g_min, ranges.protein_g_max));
  const carbs =
    ranges.carbs_g_min === ranges.carbs_g_max
      ? ranges.carbs_g_min
      : roundGram(approxFromRange(ranges.carbs_g_min, ranges.carbs_g_max));
  const fat =
    ranges.fat_g_min === ranges.fat_g_max
      ? ranges.fat_g_min
      : roundGram(approxFromRange(ranges.fat_g_min, ranges.fat_g_max));
  const payload = {
    analysis_json: analysis,
    calories,
    protein,
    carbs,
    fat,
    status: "done"
  };
  const { error } = await supabase.from("meals").update(payload).eq("id", id);
  if (error) handleSupabaseError("meals", error);
  return {
    id,
    ts: Date.now(),
    analysisJson: analysis
  };
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

  const { data, error } = await supabase
    .from("workouts")
    .insert({
      user_id: userId,
      start_ts: Math.floor(startTs / 1000)
    })
    .select("*")
    .single();

  if (error) throw error;

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
    end_ts: Math.floor(endTs / 1000),
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
    clearAllData,
  };
}
