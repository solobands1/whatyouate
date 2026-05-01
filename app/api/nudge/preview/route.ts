import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildSmartNudgeContext } from "../../../../lib/digestEngine";
import { buildSmartPrompt, SMART_NUDGE_SYSTEM_PROMPT } from "../../../../lib/nudgeGen";
import type { MealLog, WorkoutSession, UserProfile } from "../../../../lib/types";

export const maxDuration = 60;

const PREVIEW_SECRET = "wya-push-test-2026";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function mapMealRow(row: Record<string, unknown>): MealLog | null {
  const analysis = row.analysis_json as Record<string, unknown> | null;
  if (!analysis?.estimated_ranges) return null;
  const tsRaw = Number(row.ts);
  const ts = Number.isFinite(tsRaw) && tsRaw > 0 ? tsRaw : new Date(row.created_at as string).getTime();
  return {
    id: String(row.id),
    ts,
    analysisJson: analysis as unknown as MealLog["analysisJson"],
    status: ((row.status as string) ?? "done") as MealLog["status"],
  };
}

function mapWorkoutRow(row: Record<string, unknown>): WorkoutSession {
  const coerce = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n < 10_000_000_000 ? n * 1000 : n;
  };
  return {
    id: String(row.id),
    startTs: coerce(row.start_ts) ?? Date.now(),
    endTs: coerce(row.end_ts),
    durationMin: Number.isFinite(Number(row.duration_min)) ? Number(row.duration_min) : undefined,
    workoutTypes: Array.isArray(row.workout_types) ? (row.workout_types as string[]) : undefined,
    intensity: ((row.intensity as string) ?? undefined) as WorkoutSession["intensity"],
  };
}

function mapProfileRow(data: Record<string, unknown>): UserProfile {
  return {
    id: data.user_id as string,
    firstName: (data.first_name as string) ?? "",
    lastName: (data.last_name as string) ?? "",
    height: (data.height as number) ?? null,
    weight: (data.weight as number) ?? null,
    age: (data.age as number) ?? null,
    sex: (data.sex as UserProfile["sex"]) ?? "prefer_not",
    goalDirection: data.goal_direction === "recomposition" ? "balance" : ((data.goal_direction as UserProfile["goalDirection"]) ?? "maintain"),
    bodyPriority: (data.body_priority as string) ?? "",
    freeformFocus: (data.freeform_focus as string) ?? "",
    activityLevel: (data.activity_level as UserProfile["activityLevel"]) ?? undefined,
    dietaryRestrictions: Array.isArray(data.dietary_restrictions) ? (data.dietary_restrictions as string[]) : [],
    units: ((data.units as "imperial" | "metric") ?? "imperial"),
    dailySupplements: [],
    streak: (data.streak as number) ?? 0,
    streakLastDate: (data.streak_last_date as string) ?? "",
    trackWater: (data.track_water as boolean) ?? false,
    waterUnit: data.water_unit === "oz" ? "oz" : "ml",
  };
}

function extractRecentFoods(meals: MealLog[]): string[] {
  const seen = new Set<string>();
  const foods: string[] = [];
  const cutoff = Date.now() - 4 * 24 * 60 * 60 * 1000;
  meals
    .filter((m) => m.ts >= cutoff && m.analysisJson?.source !== "supplement" && m.status !== "failed")
    .sort((a, b) => b.ts - a.ts)
    .forEach((meal) => {
      const items = [
        meal.analysisJson?.name,
        ...((meal.analysisJson?.detected_items ?? []) as Array<{ name: string }>).map((i) => i.name),
      ].filter(Boolean) as string[];
      items.forEach((name) => {
        const key = name.toLowerCase();
        if (!seen.has(key)) { seen.add(key); foods.push(name); }
      });
    });
  return foods;
}

async function generateNudge(ctx: Record<string, unknown>) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const prompt = buildSmartPrompt(ctx);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55_000);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        temperature: 0.7,
        system: SMART_NUDGE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) return null;
    const result = await response.json();
    const raw = (result.content?.[0]?.text ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.message) return null;
    return parsed as { message: string; type: string; why?: string; action?: string };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  const userId = searchParams.get("userId");
  const windowParam = searchParams.get("window") as "morning" | "evening" | null;

  if (secret !== PREVIEW_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!userId || !windowParam) {
    return NextResponse.json({ error: "Missing userId or window" }, { status: 400 });
  }

  const supabase = adminClient();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const [mealsRes, workoutsRes, profileRes, nudgesRes, feelRes, weightRes] = await Promise.all([
    supabase.from("meals").select("*").eq("user_id", userId).gte("created_at", sixtyDaysAgo).order("ts", { ascending: false }),
    supabase.from("workouts").select("*").eq("user_id", userId).gte("created_at", sixtyDaysAgo),
    supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("nudges").select("type, message, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
    supabase.from("feel_logs").select("ts, tag").eq("user_id", userId).order("ts", { ascending: false }).limit(10),
    supabase.from("weight_logs").select("weight_kg, logged_at").eq("user_id", userId).order("logged_at", { ascending: false }).limit(20),
  ]);

  if (!profileRes.data) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const meals = (mealsRes.data ?? []).map(mapMealRow).filter(Boolean) as MealLog[];
  const workouts = (workoutsRes.data ?? []).map(mapWorkoutRow);
  const profile = mapProfileRow(profileRes.data as Record<string, unknown>);
  const recentFoods = extractRecentFoods(meals);
  const recentNudgeMessages = (nudgesRes.data ?? []).map((n: { type: string; message: string }) => `${n.type}: ${n.message}`);
  const recentFeelLogs = (feelRes.data ?? []).map((r: { ts: number; tag: string }) => ({ ts: r.ts * 1000, tag: r.tag }));
  const lastNudgeRecord = nudgesRes.data?.[0]
    ? { type: (nudgesRes.data[0] as { type: string }).type, message: (nudgesRes.data[0] as { message: string }).message, created_at: (nudgesRes.data[0] as { created_at: string }).created_at }
    : undefined;
  const timezoneOffset = (profileRes.data as Record<string, unknown>).timezone_offset_minutes as number | undefined;

  const ctx = buildSmartNudgeContext(
    meals, workouts, profile, recentFoods, recentNudgeMessages,
    recentFeelLogs, lastNudgeRecord, weightRes.data ?? [], undefined, timezoneOffset
  ) as unknown as Record<string, unknown>;

  const isEvening = windowParam === "evening";
  delete ctx.timeOfDay;

  const recentTypes = (nudgesRes.data ?? []).slice(0, 3).map((n: { type: string }) => n.type);
  const proteinCount = recentTypes.filter((t: string) => t === "protein_low" || t === "protein_low_critical").length;
  const deficitSet = new Set(["protein_low", "protein_low_critical", "calorie_low", "fat_low", "micronutrient"]);
  const allDeficits = recentTypes.length >= 3 && recentTypes.every((t: string) => deficitSet.has(t));
  const blockedNudgeTypes: string[] = [];
  if (proteinCount >= 2) blockedNudgeTypes.push("protein_low");
  if (allDeficits) blockedNudgeTypes.push(...Array.from(deficitSet));

  if (isEvening) {
    ctx.nudgeIntentWindow = "evening";
    ctx.blockedNudgeTypes = ["meal_timing", ...blockedNudgeTypes];
  } else {
    delete ctx.todayCalories;
    delete ctx.todayProtein;
    delete ctx.todayFat;
    delete ctx.todayCarbs;
    delete ctx.todayMeals;
    delete ctx.remainingCalories;
    delete ctx.remainingProtein;
    delete ctx.followThrough;
    ctx.nudgeIntentWindow = "morning";
    ctx.blockedNudgeTypes = ["check_in", "meal_timing", "workout_fuel_low", ...blockedNudgeTypes];
  }

  const nudge = await generateNudge(ctx);
  if (!nudge) return NextResponse.json({ message: null, debug: { meals: meals.length, profile: !!profileRes.data } });

  return NextResponse.json({
    window: windowParam,
    type: nudge.type,
    message: nudge.message,
    why: nudge.why ?? null,
    action: nudge.action ?? null,
  });
}
