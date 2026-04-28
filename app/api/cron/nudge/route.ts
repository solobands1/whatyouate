import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildSmartNudgeContext } from "../../../../lib/digestEngine";
import { buildSmartPrompt, SMART_NUDGE_SYSTEM_PROMPT } from "../../../../lib/nudgeGen";
import { sendPush } from "../../../../lib/apns";
import type { MealLog, WorkoutSession, UserProfile } from "../../../../lib/types";

export const maxDuration = 300;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getTimeWindow(): "morning" | "afternoon" | "evening" {
  const hour = new Date().getUTCHours();
  if (hour < 16) return "morning";
  if (hour < 21) return "afternoon";
  return "evening";
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

const UNLIMITED_USER_IDS = new Set([
  "4ef35614-32ec-4a17-b410-f4c31437c1bc", // Dillon
  "b2d6d7a6-a147-4dfb-9750-375d070cccbf", // Andrea
  "973c0886-cd6f-4813-8a3c-4ded80bfa09c", // Apple review demo
]);

async function checkProEntitlement(userId: string): Promise<boolean> {
  if (UNLIMITED_USER_IDS.has(userId)) return true;
  try {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.REVENUECAT_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (!res.ok) return false;
    const data = await res.json();
    const entitlement = data.subscriber?.entitlements?.pro;
    if (!entitlement) return false;
    const expires = entitlement.expires_date;
    if (!expires) return true;
    return new Date(expires) > new Date();
  } catch {
    return false;
  }
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

const VALID_NUDGE_TYPES = new Set([
  "win","momentum","pattern","meal_timing","food_insight","variety",
  "rest_day_fuel","workout_recovery","protein_low_critical","protein_low",
  "calorie_low","calorie_high","workout_missing","micronutrient","fat_low",
  "on_track","check_in","workout_fuel_low","training_fuel_low",
]);

async function generateNudge(ctx: Record<string, unknown>): Promise<{ message: string; type: string; why?: string; action?: string; suggestions: string[] } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("[cron/nudge] ANTHROPIC_API_KEY not set"); return null; }
  const prompt = buildSmartPrompt(ctx);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25_000);
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
    if (!response.ok) {
      console.error(`[cron/nudge] Anthropic API error: ${response.status} ${response.statusText}`);
      return null;
    }
    const result = await response.json();
    const raw = (result.content?.[0]?.text ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { console.error("[cron/nudge] No JSON in Claude response:", raw.slice(0, 200)); return null; }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("[cron/nudge] JSON parse failed:", jsonMatch[0].slice(0, 200), e);
      return null;
    }
    if (!parsed.message || typeof parsed.message !== "string") return null;
    if (parsed.message.length > 500) { console.error("[cron/nudge] Message too long:", parsed.message.length); return null; }
    if (!parsed.type || !VALID_NUDGE_TYPES.has(parsed.type as string)) {
      console.error("[cron/nudge] Invalid nudge type:", parsed.type);
      return null;
    }

    // Post-generation cleanup: strip em-dashes, trim to 70 words
    parsed.message = (parsed.message as string).replace(/\s*—\s*/g, " ").replace(/\s+/g, " ").trim();
    const words = (parsed.message as string).split(/\s+/);
    if (words.length > 70) {
      parsed.message = words.slice(0, 70).join(" ").replace(/[,;]$/, "") + ".";
    }

    return parsed as { message: string; type: string; why?: string; action?: string; suggestions: string[] };
  } catch (err) {
    console.error("[cron/nudge] generateNudge error:", err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = adminClient();
  const window = getTimeWindow();
  const nowISO = new Date().toISOString();
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch all users and tokens in parallel — nudge generation is not gated on push token existence
  const [{ data: profileRows }, { data: tokens }] = await Promise.all([
    supabase.from("profiles").select("user_id"),
    supabase.from("push_tokens").select("user_id, token").eq("platform", "ios"),
  ]);

  if (!profileRows?.length) return NextResponse.json({ ok: true, processed: 0 });

  const userIds = [...new Set(profileRows.map((p: { user_id: string }) => p.user_id))];
  let processed = 0;
  let sent = 0;

  // Phase 1: generate nudges + save to DB for all users (no sleep between users)
  const pendingPushes: Array<{ userId: string; message: string }> = [];

  for (const userId of userIds) {
    try {
      const { data: recentNudgeCheck } = await supabase
        .from("nudges")
        .select("id")
        .eq("user_id", userId)
        .gte("created_at", fourHoursAgo)
        .limit(1);
      if (recentNudgeCheck?.length) continue;

      const isPro = await checkProEntitlement(userId);
      if (!isPro) continue;

      const [mealsRes, workoutsRes, profileRes, nudgesRes, feelRes, weightRes] = await Promise.all([
        supabase.from("meals").select("*").eq("user_id", userId).gte("created_at", sixtyDaysAgo).order("ts", { ascending: false }),
        supabase.from("workouts").select("*").eq("user_id", userId).gte("created_at", sixtyDaysAgo),
        supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("nudges").select("type, message, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
        supabase.from("feel_logs").select("ts, tag").eq("user_id", userId).order("ts", { ascending: false }).limit(10),
        supabase.from("weight_logs").select("weight_kg, logged_at").eq("user_id", userId).order("logged_at", { ascending: false }).limit(20),
      ]);

      if (!profileRes.data) continue;

      const meals = (mealsRes.data ?? []).map(mapMealRow).filter(Boolean) as MealLog[];
      if (meals.length < 5) continue;

      const workouts = (workoutsRes.data ?? []).map(mapWorkoutRow);
      const profile = mapProfileRow(profileRes.data as Record<string, unknown>);
      const recentNudgeMessages = (nudgesRes.data ?? []).map((n: { type: string; message: string }) => `${n.type}: ${n.message}`);
      const recentFeelLogs = (feelRes.data ?? []).map((r: { ts: number; tag: string }) => ({ ts: r.ts * 1000, tag: r.tag }));
      const lastNudgeRecord = nudgesRes.data?.[0]
        ? { type: (nudgesRes.data[0] as { type: string }).type, message: (nudgesRes.data[0] as { message: string }).message, created_at: (nudgesRes.data[0] as { created_at: string }).created_at }
        : undefined;
      const recentFoods = extractRecentFoods(meals);

      // Programmatic fatigue check — enforced in code, not just in the prompt
      const recentTypes = (nudgesRes.data ?? []).slice(0, 3).map((n: { type: string }) => n.type);
      const proteinCount = recentTypes.filter((t) => t === "protein_low" || t === "protein_low_critical").length;
      const deficitSet = new Set(["protein_low", "protein_low_critical", "calorie_low", "fat_low", "micronutrient"]);
      const allDeficits = recentTypes.length >= 3 && recentTypes.every((t) => deficitSet.has(t));
      const blockedNudgeTypes: string[] = [];
      if (proteinCount >= 2) blockedNudgeTypes.push("protein_low");
      if (allDeficits) blockedNudgeTypes.push(...Array.from(deficitSet));

      // Hard water-fatigue block — if last 2 nudges both referenced water, block water-adjacent angles
      const last2Types = (nudgesRes.data ?? []).slice(0, 2).map((n: { type: string; message: string }) => n.message?.toLowerCase() ?? "");
      const waterCount = last2Types.filter((m) => m.includes("water") || m.includes("hydrat")).length;
      if (waterCount >= 2) blockedNudgeTypes.push("check_in"); // water check-ins are the main water vector

      const timezoneOffset = (profileRes.data as Record<string, unknown>).timezone_offset_minutes as number | undefined;
      const ctx = buildSmartNudgeContext(
        meals, workouts, profile, recentFoods, recentNudgeMessages,
        recentFeelLogs, lastNudgeRecord, weightRes.data ?? [], undefined, timezoneOffset
      ) as unknown as Record<string, unknown>;

      // Cron nudges are durable pattern insights — strip real-time today fields
      // that will be stale or incomplete at cron fire time
      delete ctx.todayCalories;
      delete ctx.todayProtein;
      delete ctx.todayFat;
      delete ctx.todayCarbs;
      delete ctx.todayMeals;
      delete ctx.remainingCalories;
      delete ctx.remainingProtein;
      delete ctx.followThrough;
      delete ctx.timeOfDay; // replaced by nudgeIntentWindow below

      ctx.nudgeIntentWindow = window;

      // Hard-blocked: types that require real-time today data the cron doesn't have
      const CRON_HARD_BLOCKED = new Set(["check_in", "meal_timing"]);
      // Soft-blocked: passed to Claude as guidance but not hard-enforced in code
      const softBlocked = [...new Set([...blockedNudgeTypes, "workout_fuel_low"])];
      ctx.blockedNudgeTypes = [...CRON_HARD_BLOCKED, ...softBlocked];

      const nudge = await generateNudge(ctx);
      if (!nudge?.message) continue;

      // Hard-enforce only truly real-time types — fatigue suppression is handled by the prompt
      if (CRON_HARD_BLOCKED.has(nudge.type)) continue;

      await supabase.from("nudges").insert({
        user_id: userId,
        type: nudge.type,
        message: nudge.message,
        why: nudge.why ?? null,
        action: nudge.action ?? null,
        created_at: nowISO,
      });

      pendingPushes.push({ userId, message: nudge.message });
      processed++;
    } catch (err) {
      console.error(`[cron/nudge] error for user ${userId}:`, err);
    }
  }

  // Phase 2: all nudges are in DB — now send all pushes
  // Nudge is already persisted so the app will find it immediately on open
  for (const { userId, message } of pendingPushes) {
    const userTokens = (tokens ?? []).filter((t: { user_id: string }) => t.user_id === userId);
    for (const t of userTokens as Array<{ token: string }>) {
      const ok = await sendPush(t.token, {
        title: "Coach",
        body: message,
        data: { screen: "summary" },
        badge: 1,
      });
      if (ok) sent++;
    }
  }

  return NextResponse.json({ ok: true, processed, sent, window });
}
