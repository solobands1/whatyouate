import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPush } from "../../../../lib/apns";
import { isTrialEligible, type TrialMeal } from "../../../../lib/trial";
import { checkProEntitlement } from "../../../../lib/entitlement";
import { HABIT_TEMPLATES } from "../../../../lib/habits";

export const maxDuration = 60;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const REMINDER_MESSAGES = [
  "Whenever you eat next, a quick log helps your coach learn what works for you. Even a rough one counts.",
  "Still time to log something today. A few seconds is all it takes, and even a snack gives your coach something to work with.",
  "Your coach hasn't caught a meal from you yet today. Log whenever you're ready, even a rough one helps.",
  "Your coach is ready when you are. Log a meal and I'll have a fresh read for you.",
  "A quick log whenever you get a moment keeps your insights fresh. Even a rough one is plenty.",
];

function getRandomReminder(): string {
  return REMINDER_MESSAGES[Math.floor(Math.random() * REMINDER_MESSAGES.length)];
}

// The nightly reflection reminder (fires at 7pm local if the user hasn't reflected today).
// One fixed message, unlike the rotating meal nag.
const REFLECTION_REMINDER_TITLE = "Your Nightly Reflection Is Ready";
const REFLECTION_REMINDER_BODY = "It's how we learn what helps you and only takes a minute";

// The user's local calendar date ("YYYY-MM-DD") from their stored timezone offset, to compare
// against reflections_json[].date (written as the device's local date at save time).
function userLocalDateStr(offsetMinutes: number | null | undefined): string {
  const offset = offsetMinutes ?? 0;
  const local = new Date(Date.now() - offset * 60 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

// Local YYYY-MM-DD for an arbitrary timestamp under the user's stored offset (generalizes
// userLocalDateStr, which is just this for "now") — used to date-stamp a habit's startedAt.
function localDateStrOf(ts: number, offsetMinutes: number | null | undefined): string {
  const offset = offsetMinutes ?? 0;
  const local = new Date(ts - offset * 60 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}
// Whole calendar days from fromKey to toKey (both "YYYY-MM-DD").
function dayDiff(fromKey: string, toKey: string): number {
  const f = Date.UTC(+fromKey.slice(0, 4), +fromKey.slice(5, 7) - 1, +fromKey.slice(8, 10));
  const t = Date.UTC(+toKey.slice(0, 4), +toKey.slice(5, 7) - 1, +toKey.slice(8, 10));
  return Math.round((t - f) / (24 * 60 * 60 * 1000));
}

function getUserLocalHour(timezoneOffsetMinutes: number | undefined): number {
  const offset = timezoneOffsetMinutes ?? 0;
  const localMs = Date.now() - offset * 60 * 1000;
  return new Date(localMs).getUTCHours();
}

// Minimal row → TrialMeal mapping (matches the other crons: requires an analyzed
// meal). Only the fields the trial math needs (ts, status, source) are selected.
function mapReminderMeal(row: Record<string, unknown>): TrialMeal | null {
  const analysis = row.analysis_json as Record<string, unknown> | null;
  if (!analysis?.estimated_ranges) return null;
  const tsRaw = Number(row.ts);
  const ts = Number.isFinite(tsRaw) && tsRaw > 0 ? tsRaw : new Date(row.created_at as string).getTime();
  return { ts, status: (row.status as string) ?? "done", analysisJson: { source: (analysis.source as string) ?? undefined } };
}

// Compute start-of-today in the user's local timezone using their stored offset.
// offsetMinutes = getTimezoneOffset() — positive = west of UTC (ET=300, PT=480).
// Falls back to UTC midnight if offset is unknown.
function userTodayStartISO(offsetMinutes: number | null | undefined): string {
  const offset = offsetMinutes ?? 0;
  // Shift clock to user's local time, read the date, then shift back
  const localNow = new Date(Date.now() - offset * 60 * 1000);
  const year = localNow.getUTCFullYear();
  const month = localNow.getUTCMonth();
  const day = localNow.getUTCDate();
  // Local midnight in UTC ms
  const localMidnightUtcMs = Date.UTC(year, month, day) + offset * 60 * 1000;
  return new Date(localMidnightUtcMs).toISOString();
}

// "Remind Me After Breakfast", from the first-meal step at the end of onboarding. The app stores an
// absolute time in profiles.first_meal_reminder_at, so there's no timezone math here: the first
// hourly run at or after it sends one push, unless the user has logged a meal today. The column is
// cleared BEFORE sending, so a failed clear can never turn into a repeat push. A reminder more than
// three hours overdue (missed runs) is cleared without sending, since a breakfast push in the
// afternoon would be odd. Kept apart from the main loop: if the column doesn't exist yet
// (supabase/first_meal_reminder.sql not run), the lookup errors and only this part is skipped.
const FIRST_MEAL_REMINDER_TITLE = "Had Breakfast Yet?";
const FIRST_MEAL_REMINDER_BODY = "Log it when you get a moment. A photo or a few words is plenty.";

async function sendFirstMealReminders(
  supabase: ReturnType<typeof adminClient>,
  tokens: Array<{ user_id: string; token: string }>
): Promise<number> {
  const nowMs = Date.now();
  // Reminders are set on the hour and the cron runs at :00, so allow a few minutes of clock skew.
  const dueBy = new Date(nowMs + 5 * 60 * 1000).toISOString();
  const { data: due, error } = await supabase
    .from("profiles")
    .select("user_id, first_meal_reminder_at, timezone_offset_minutes")
    .not("first_meal_reminder_at", "is", null)
    .lte("first_meal_reminder_at", dueBy);
  if (error) {
    console.error("[cron/reminder] first-meal reminder lookup failed:", error.message);
    return 0;
  }
  let sent = 0;
  for (const row of (due ?? []) as Array<{ user_id: string; first_meal_reminder_at: string; timezone_offset_minutes: number | null }>) {
    const userId = row.user_id;
    try {
      const { error: clearErr } = await supabase
        .from("profiles")
        .update({ first_meal_reminder_at: null })
        .eq("user_id", userId);
      if (clearErr) {
        console.error(`[cron/reminder] couldn't clear first-meal reminder for ${userId.slice(0, 8)}, skipping:`, clearErr.message);
        continue;
      }
      const atMs = new Date(row.first_meal_reminder_at).getTime();
      if (!Number.isFinite(atMs) || nowMs - atMs > 3 * 60 * 60 * 1000) continue;
      const userTokens = tokens.filter((t) => t.user_id === userId);
      if (!userTokens.length) continue; // no push permission: the app shows its own prompt on open
      const { data: todayMeals, error: mealsErr } = await supabase
        .from("meals").select("id")
        .eq("user_id", userId).gte("created_at", userTodayStartISO(row.timezone_offset_minutes)).neq("status", "failed").limit(1);
      if (mealsErr) {
        console.error(`[cron/reminder] first-meal meal check failed for ${userId.slice(0, 8)}:`, mealsErr.message);
        continue;
      }
      if (todayMeals?.length) continue; // already logged, nothing to remind
      console.log(`[cron/reminder] first-meal reminder for ${userId.slice(0, 8)}`);
      for (const t of userTokens) {
        const ok = await sendPush(t.token, { title: FIRST_MEAL_REMINDER_TITLE, body: FIRST_MEAL_REMINDER_BODY, data: { screen: "home" }, badge: 1 });
        if (ok) sent++;
      }
    } catch (err) {
      console.error(`[cron/reminder] first-meal reminder error for ${userId.slice(0, 8)}:`, err);
    }
  }
  return sent;
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = adminClient();
  const now = new Date();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const { data: tokens } = await supabase
    .from("push_tokens")
    .select("user_id, token")
    .eq("platform", "ios");
  // Runs before the no-tokens early return so due reminders still get cleared.
  const firstMealSent = await sendFirstMealReminders(supabase, (tokens ?? []) as Array<{ user_id: string; token: string }>);
  if (!tokens?.length) return NextResponse.json({ ok: true, sent: firstMealSent });

  const userIds = [...new Set(tokens.map((t: { user_id: string }) => t.user_id))];
  let sent = firstMealSent;

  for (const userId of userIds) {
    try {
      // Timezone offset + reflection history drive both the 2pm meal nag and the 7pm reflection
      // reminder. Fixed hours (14 / 19) keep them from colliding, so no cross-nudge cooldown.
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("timezone_offset_minutes, reflections_json, habit_state_json")
        .eq("user_id", userId)
        .maybeSingle();
      const offsetMinutes = (profileRow as Record<string, unknown> | null)?.timezone_offset_minutes as number | null | undefined;
      const localHour = getUserLocalHour(offsetMinutes ?? undefined);
      const userTokens = (tokens as Array<{ user_id: string; token: string }>).filter((t) => t.user_id === userId);

      if (localHour === 8) {
        // Habit-builder KICKOFF — one push on the morning a "starts tomorrow" habit goes live, so
        // day one doesn't silently slip. Only for a builder still "committed" whose start day is
        // today (accept day + 1); once the user opens the app it flips to "active" and this stops,
        // so it fires exactly once (the cron is hourly at :00). No trial/pro gate — new users on
        // "Find Your Rhythm" need the day-one prompt most. The daily 9am coach nudge is untouched;
        // this is purely additive.
        const habitState = (profileRow as Record<string, unknown> | null)?.habit_state_json as { builder?: { templateId?: string; status?: string; startedAt?: string | null } } | null;
        const builder = habitState?.builder;
        if (builder && builder.status === "committed" && builder.startedAt) {
          const startedLocal = localDateStrOf(new Date(builder.startedAt).getTime(), offsetMinutes);
          if (dayDiff(startedLocal, userLocalDateStr(offsetMinutes)) === 1) {
            const tmpl = HABIT_TEMPLATES.find((t) => t.id === builder.templateId);
            if (tmpl) {
              const title = `${tmpl.title} Starts Today`;
              const body = `Day 1 of ${tmpl.durationDays}. Open the app to track it as you go.`;
              console.log(`[cron/reminder] habit kickoff for ${userId.slice(0, 8)}: ${tmpl.id}`);
              for (const t of userTokens) {
                const ok = await sendPush(t.token, { title, body, data: { screen: "home" }, badge: 1 });
                if (ok) sent++;
              }
            }
          }
        }
      } else if (localHour === 14) {
        // 2pm MEAL NAG — only if they've logged nothing today. Goes to trial-active or paid users
        // (unchanged eligibility from the original reminder).
        const todayStartISO = userTodayStartISO(offsetMinutes);
        const { data: todayMeals } = await supabase
          .from("meals").select("id")
          .eq("user_id", userId).gte("created_at", todayStartISO).neq("status", "failed").limit(1);
        if (todayMeals?.length) continue;

        const { data: histRows } = await supabase
          .from("meals").select("ts, created_at, status, analysis_json")
          .eq("user_id", userId).gte("created_at", sixtyDaysAgo).order("ts", { ascending: false });
        const histMeals = (histRows ?? []).map(mapReminderMeal).filter(Boolean) as TrialMeal[];
        const eligible = isTrialEligible(histMeals, Date.now()) || (await checkProEntitlement(userId));
        if (!eligible) continue;

        const message = getRandomReminder();
        await supabase.from("nudges").insert({ user_id: userId, type: "reminder", message, created_at: now.toISOString() });
        for (const t of userTokens) {
          const ok = await sendPush(t.token, { title: "WhatYouAte • Coach", body: message, data: { screen: "home" }, badge: 1 });
          if (ok) sent++;
        }
      } else if (localHour === 19) {
        // 7pm REFLECTION REMINDER — only if they haven't reflected today. Reflection is free from
        // day one, so this is NOT gated on trial/pro; every user with notifications on gets it.
        const reflections = Array.isArray((profileRow as Record<string, unknown> | null)?.reflections_json)
          ? ((profileRow as Record<string, unknown>).reflections_json as Array<{ date?: string }>)
          : [];
        const localToday = userLocalDateStr(offsetMinutes);
        if (reflections.some((r) => r?.date === localToday)) continue; // already reflected today

        for (const t of userTokens) {
          const ok = await sendPush(t.token, { title: REFLECTION_REMINDER_TITLE, body: REFLECTION_REMINDER_BODY, data: { screen: "home" }, badge: 1 });
          if (ok) sent++;
        }
      }
    } catch (err) {
      console.error(`[cron/reminder] error for user ${userId}:`, err);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
