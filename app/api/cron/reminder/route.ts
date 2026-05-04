import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPush } from "../../../../lib/apns";

export const maxDuration = 60;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const REMINDER_MESSAGES = [
  "You haven't logged anything yet today. Even a quick entry keeps your data accurate.",
  "No meals logged today. A few seconds to log now keeps your streak and your insights sharp.",
  "Still nothing logged today. Tap to add your first meal when you get a moment.",
  "Your coach hasn't seen any meals today. Log something and I'll have a fresh read for you.",
  "Quick check-in: nothing logged yet. Even a rough log is better than nothing.",
];

function getRandomReminder(): string {
  return REMINDER_MESSAGES[Math.floor(Math.random() * REMINDER_MESSAGES.length)];
}

async function checkProEntitlement(userId: string): Promise<boolean> {
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

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = adminClient();
  const now = new Date();
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

  const { data: tokens } = await supabase
    .from("push_tokens")
    .select("user_id, token")
    .eq("platform", "ios");
  if (!tokens?.length) return NextResponse.json({ ok: true, sent: 0 });

  const userIds = [...new Set(tokens.map((t: { user_id: string }) => t.user_id))];
  let sent = 0;

  for (const userId of userIds) {
    try {
      const isPro = await checkProEntitlement(userId);
      if (!isPro) continue;

      // Skip if any nudge (smart or reminder) was sent in the last 8 hours
      const { data: recentReminder } = await supabase
        .from("nudges")
        .select("id")
        .eq("user_id", userId)
        .gte("created_at", eightHoursAgo)
        .limit(1);
      if (recentReminder?.length) continue;

      // Get user's timezone offset for accurate "today" window
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("timezone_offset_minutes")
        .eq("user_id", userId)
        .maybeSingle();
      const offsetMinutes = (profileRow as Record<string, unknown> | null)?.timezone_offset_minutes as number | null | undefined;
      const todayStartISO = userTodayStartISO(offsetMinutes);

      // Skip if they've logged a meal today (in their local timezone)
      const { data: todayMeals } = await supabase
        .from("meals")
        .select("id")
        .eq("user_id", userId)
        .gte("created_at", todayStartISO)
        .neq("status", "failed")
        .limit(1);
      if (todayMeals?.length) continue;

      const message = getRandomReminder();

      await supabase.from("nudges").insert({
        user_id: userId,
        type: "reminder",
        message,
        created_at: now.toISOString(),
      });

      const userTokens = (tokens as Array<{ user_id: string; token: string }>).filter((t) => t.user_id === userId);
      for (const t of userTokens) {
        const ok = await sendPush(t.token, {
          title: "WhatYouAte • Coach",
          body: message,
          data: { screen: "home" },
          badge: 1,
        });
        if (ok) sent++;
      }
    } catch (err) {
      console.error(`[cron/reminder] error for user ${userId}:`, err);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
