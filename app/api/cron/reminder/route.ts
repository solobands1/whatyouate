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

// First-meal step reminders: "Remind Me After Breakfast", and the one follow-up after "Not Now"
// (next likely mealtime: 1 PM lunch, 7 PM dinner, or 9 AM breakfast the next morning). The app
// stores an absolute time in profiles.first_meal_reminder_at (with the device's current timezone
// offset alongside), and the first hourly run at or after it sends one push, unless the user has
// logged a meal since (in any state). Water and feelings don't count: the step's "Log A Glass Of
// Water" deliberately leaves the next-mealtime reminder in place. Which meal it asks about comes
// from that time's local hour, so no separate kind is stored; the app derives it the same way for
// its in-app prompt (lib/firstMeal mealKindForHour).
//
// The column is cleared BEFORE sending, so a failed clear can never turn into a repeat push. A
// reminder more than three hours overdue (missed runs) is cleared without sending. Kept apart from
// the main loop: if the column doesn't exist (supabase/first_meal_reminder.sql not run), the
// lookup errors and only this part is skipped. Returns who got a push, so the main loop can hold
// back that user's other reminder in the same run (one push per person per hour; in practice the
// 7 PM reflection reminder on the evening of a dinner follow-up).
type MealKind = "breakfast" | "lunch" | "dinner";
function mealKindForLocalHour(hour: number): MealKind {
  if (hour >= 4 && hour < 12) return "breakfast";
  if (hour >= 12 && hour < 17) return "lunch";
  return "dinner";
}
const FIRST_MEAL_MESSAGES: Record<MealKind, { title: string; body: string }> = {
  breakfast: { title: "Had Breakfast Yet?", body: "Log it when you get a moment. A photo or a few words is plenty." },
  lunch: { title: "What Did You Have For Lunch?", body: "A photo or a few words is plenty. It's how your coach gets started." },
  dinner: { title: "What Did You Have For Dinner?", body: "A photo or a few words is plenty. It's how your coach gets started." },
};
// How far back "since they chose a reminder" can reach: the earliest Not Now behind a 1 PM lunch
// follow-up is midnight (13h), behind a 9 AM next-morning one 4 PM the day before (17h).
const FIRST_MEAL_LOOKBACK_MS = 18 * 60 * 60 * 1000;

async function sendFirstMealReminders(
  supabase: ReturnType<typeof adminClient>,
  tokens: Array<{ user_id: string; token: string }>
): Promise<{ sent: number; pushedUsers: Set<string> }> {
  const pushedUsers = new Set<string>();
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
    return { sent: 0, pushedUsers };
  }
  let sent = 0;
  type DueRow = { user_id: string; first_meal_reminder_at: string; timezone_offset_minutes: number | null };
  for (const row of (due ?? []) as DueRow[]) {
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

      // A meal logged since the reminder was chosen (any state, even one still analysing or failed)?
      const sinceMs = atMs - FIRST_MEAL_LOOKBACK_MS;
      const { data: recentMeals, error: mealsErr } = await supabase
        .from("meals").select("id")
        .eq("user_id", userId).gte("created_at", new Date(sinceMs).toISOString()).limit(1);
      if (mealsErr) {
        console.error(`[cron/reminder] first-meal meal check failed for ${userId.slice(0, 8)}:`, mealsErr.message);
        continue;
      }
      if (recentMeals?.length) continue;

      const localHour = new Date(atMs - (row.timezone_offset_minutes ?? 0) * 60 * 1000).getUTCHours();
      const kind = mealKindForLocalHour(localHour);
      const msg = FIRST_MEAL_MESSAGES[kind];
      console.log(`[cron/reminder] first-meal ${kind} reminder for ${userId.slice(0, 8)}`);
      pushedUsers.add(userId);
      // Remembered so the first-week 2pm lunch push skips today (firstWeekLunchNudge). Best effort:
      // without supabase/first_meal_reminder.sql's first_meal_nudged_at this errors, and the 2pm
      // check then falls back to the old behaviour.
      const { error: markErr } = await supabase
        .from("profiles").update({ first_meal_nudged_at: new Date(nowMs).toISOString() }).eq("user_id", userId);
      if (markErr) console.error(`[cron/reminder] couldn't record first-meal push for ${userId.slice(0, 8)}:`, markErr.message);
      for (const t of userTokens) {
        const ok = await sendPush(t.token, { title: msg.title, body: msg.body, data: { screen: "home" }, badge: 1 });
        if (ok) sent++;
      }
    } catch (err) {
      console.error(`[cron/reminder] first-meal reminder error for ${userId.slice(0, 8)}:`, err);
    }
  }
  return { sent, pushedUsers };
}

// First-week 2pm push for onboarded users who still have no meals at all (days 1 to 7, counting
// the day the profile was created as day 1). Uses the lunch wording from the first-meal step.
// Skipped on a day a first-meal reminder already went out (first_meal_nudged_at) or is still due
// later today (first_meal_reminder_at, e.g. the 7 PM dinner follow-up), so it never doubles up.
// handled=false hands the user back to the normal 2pm logic: outside the first week, or when the
// first_meal_nudged_at column isn't there yet (the old behaviour, nothing new sent).
const FIRST_WEEK_DAYS = 7;
async function firstWeekLunchNudge(
  supabase: ReturnType<typeof adminClient>,
  userId: string,
  profile: Record<string, unknown> | null,
  offsetMinutes: number | null | undefined,
  userTokens: Array<{ user_id: string; token: string }>
): Promise<{ handled: boolean; sent: number }> {
  if (profile?.onboarding_done !== true || !profile.created_at) return { handled: false, sent: 0 };
  const createdMs = new Date(profile.created_at as string).getTime();
  if (!Number.isFinite(createdMs)) return { handled: false, sent: 0 };
  const today = userLocalDateStr(offsetMinutes);
  const dayNumber = dayDiff(localDateStrOf(createdMs, offsetMinutes), today) + 1;
  if (dayNumber < 1 || dayNumber > FIRST_WEEK_DAYS) return { handled: false, sent: 0 };
  const { data: fm, error } = await supabase
    .from("profiles").select("first_meal_reminder_at, first_meal_nudged_at").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error(`[cron/reminder] first-week check failed for ${userId.slice(0, 8)} (run first_meal_reminder.sql?):`, error.message);
    return { handled: false, sent: 0 };
  }
  const onToday = (iso: unknown) =>
    typeof iso === "string" && localDateStrOf(new Date(iso).getTime(), offsetMinutes) === today;
  if (onToday(fm?.first_meal_nudged_at) || onToday(fm?.first_meal_reminder_at)) return { handled: true, sent: 0 };
  console.log(`[cron/reminder] first-week lunch push for ${userId.slice(0, 8)} (day ${dayNumber})`);
  const msg = FIRST_MEAL_MESSAGES.lunch;
  let sent = 0;
  for (const t of userTokens) {
    const ok = await sendPush(t.token, { title: msg.title, body: msg.body, data: { screen: "home" }, badge: 1 });
    if (ok) sent++;
  }
  return { handled: true, sent };
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
  const firstMeal = await sendFirstMealReminders(supabase, (tokens ?? []) as Array<{ user_id: string; token: string }>);
  if (!tokens?.length) return NextResponse.json({ ok: true, sent: firstMeal.sent });

  const userIds = [...new Set(tokens.map((t: { user_id: string }) => t.user_id))];
  let sent = firstMeal.sent;

  for (const userId of userIds) {
    // One push per person per run: a first-meal reminder this hour takes the slot.
    if (firstMeal.pushedUsers.has(userId)) continue;
    try {
      // Timezone offset + reflection history drive both the 2pm meal nag and the 7pm reflection
      // reminder. Fixed hours (14 / 19) keep them from colliding, so no cross-nudge cooldown.
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("timezone_offset_minutes, reflections_json, habit_state_json, onboarding_done, created_at")
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

        // First week with nothing logged at all: the trial check below needs a meal, so these
        // users would otherwise only ever get the nightly reflection push. Ask about lunch instead.
        const { data: anyMeal, error: anyMealErr } = await supabase
          .from("meals").select("id").eq("user_id", userId).limit(1);
        if (!anyMealErr && !anyMeal?.length) {
          const firstWeek = await firstWeekLunchNudge(supabase, userId, profileRow as Record<string, unknown> | null, offsetMinutes, userTokens);
          if (firstWeek.handled) { sent += firstWeek.sent; continue; }
        }

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
