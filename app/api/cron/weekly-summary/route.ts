import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildSmartNudgeContext } from "../../../../lib/digestEngine";
import { buildWeeklySummaryPrompt, sanitizeNudgeFields, WEEKLY_SUMMARY_SYSTEM_PROMPT } from "../../../../lib/nudgeGen";
import { sendPush } from "../../../../lib/apns";
import type { MealLog, WorkoutSession, UserProfile, SupplementEntry } from "../../../../lib/types";

export const maxDuration = 300;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getUserLocalHour(timezoneOffsetMinutes: number | undefined): number {
  const utcMinutes = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  const offset = timezoneOffsetMinutes ?? 0;
  return Math.floor(((utcMinutes - offset) + 1440) % 1440 / 60);
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
    dailySupplements: Array.isArray(data.daily_supplements)
      ? (data.daily_supplements as unknown[]).map((s): SupplementEntry => {
          if (typeof s === "string") {
            try {
              const p = JSON.parse(s);
              if (p && typeof p === "object" && typeof p.name === "string") return p as SupplementEntry;
            } catch {}
          }
          return s as SupplementEntry;
        })
      : [],
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

async function generateWeeklySummary(ctx: Record<string, unknown>): Promise<{ message: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("[cron/weekly-summary] ANTHROPIC_API_KEY not set"); return null; }
  const prompt = buildWeeklySummaryPrompt(ctx);
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
        max_tokens: 250,
        temperature: 0.8,
        system: WEEKLY_SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      console.error(`[cron/weekly-summary] Anthropic API error: ${response.status} ${response.statusText}`);
      return null;
    }
    const result = await response.json();
    const raw = (result.content?.[0]?.text ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { console.error("[cron/weekly-summary] No JSON in Claude response:", raw.slice(0, 200)); return null; }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("[cron/weekly-summary] JSON parse failed:", jsonMatch[0].slice(0, 200), e);
      return null;
    }
    if (!parsed.message || typeof parsed.message !== "string") return null;

    // Strip em-dashes and trim to 120 words
    parsed.message = (parsed.message as string).replace(/\s*—\s*/g, " ").replace(/\s+/g, " ").trim();
    const words = (parsed.message as string).split(/\s+/);
    if (words.length > 120) {
      parsed.message = words.slice(0, 120).join(" ").replace(/[,;]$/, "") + ".";
    }

    return sanitizeNudgeFields(parsed) as { message: string };
  } catch (err) {
    console.error("[cron/weekly-summary] generate error:", err);
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
  const nowISO = new Date().toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: profileRows }, { data: tokens }] = await Promise.all([
    supabase.from("profiles").select("user_id, timezone_offset_minutes"),
    supabase.from("push_tokens").select("user_id, token").eq("platform", "ios"),
  ]);

  if (!profileRows?.length) return NextResponse.json({ ok: true, processed: 0 });

  const profiles = profileRows as Array<{ user_id: string; timezone_offset_minutes?: number }>;
  const timezoneByUser = new Map(profiles.map((p) => [p.user_id, p.timezone_offset_minutes]));
  const userIds = [...new Set(profiles.map((p) => p.user_id))];
  let processed = 0;
  let sent = 0;

  const pendingPushes: Array<{ userId: string; message: string }> = [];

  for (const userId of userIds) {
    try {
      const tzOffset = timezoneByUser.get(userId);
      const localHour = getUserLocalHour(tzOffset);
      if (localHour !== 10) continue;

      // Only send once per week — check for existing weekly_summary in past 7 days
      const { data: existingWeeklySummary } = await supabase
        .from("nudges")
        .select("id")
        .eq("user_id", userId)
        .eq("type", "weekly_summary")
        .gte("created_at", sevenDaysAgo)
        .limit(1);
      if (existingWeeklySummary?.length) continue;

      const isPro = await checkProEntitlement(userId);
      if (!isPro) continue;

      const [mealsRes, workoutsRes, profileRes, feelRes, weightRes] = await Promise.all([
        supabase.from("meals").select("*").eq("user_id", userId).gte("created_at", sixtyDaysAgo).order("ts", { ascending: false }),
        supabase.from("workouts").select("*").eq("user_id", userId).gte("created_at", sixtyDaysAgo),
        supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("feel_logs").select("ts, tag").eq("user_id", userId).order("ts", { ascending: false }).limit(10),
        supabase.from("weight_logs").select("weight_kg, logged_at").eq("user_id", userId).order("logged_at", { ascending: false }).limit(20),
      ]);

      if (!profileRes.data) continue;

      const meals = (mealsRes.data ?? []).map(mapMealRow).filter(Boolean) as MealLog[];

      // Require at least 3 logged days in the past 7 days
      const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentDayKeys = new Set(
        meals
          .filter((m) => m.ts >= sevenDaysAgoMs && m.analysisJson?.source !== "supplement")
          .map((m) => {
            const d = new Date(m.ts - (tzOffset ?? 0) * 60 * 1000);
            return d.toISOString().slice(0, 10);
          })
      );
      if (recentDayKeys.size < 3) continue;

      const workouts = (workoutsRes.data ?? []).map(mapWorkoutRow);
      const profile = mapProfileRow(profileRes.data as Record<string, unknown>);
      const recentFeelLogs = (feelRes.data ?? []).map((r: { ts: number; tag: string }) => ({ ts: r.ts * 1000, tag: r.tag }));

      const timezoneOffset = (profileRes.data as Record<string, unknown>).timezone_offset_minutes as number | undefined;
      const ctx = buildSmartNudgeContext(
        meals, workouts, profile, [], [],
        recentFeelLogs, undefined, weightRes.data ?? [], undefined, timezoneOffset
      ) as unknown as Record<string, unknown>;

      const nudge = await generateWeeklySummary(ctx);
      if (!nudge?.message) continue;

      await supabase.from("nudges").insert({
        user_id: userId,
        type: "weekly_summary",
        message: nudge.message,
        why: null,
        action: null,
        suggestions: null,
        created_at: nowISO,
      });

      pendingPushes.push({ userId, message: nudge.message });
      processed++;
    } catch (err) {
      console.error(`[cron/weekly-summary] error for user ${userId}:`, err);
    }
  }

  for (const { userId, message } of pendingPushes) {
    const userTokens = (tokens ?? []).filter((t: { user_id: string }) => t.user_id === userId);
    for (const t of userTokens as Array<{ token: string }>) {
      const ok = await sendPush(t.token, {
        title: "WhatYouAte • Week Recap",
        body: message,
        data: { screen: "summary" },
        badge: 1,
      });
      if (ok) sent++;
    }
  }

  return NextResponse.json({ ok: true, processed, sent });
}
