import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPush } from "@/lib/apns";

export const maxDuration = 60;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const REMINDER_MESSAGES = [
  "What have you eaten today? Log your meals to stay on track.",
  "No meals logged yet today — quick log something to keep your streak going.",
  "Tap to log your first meal of the day.",
  "Your coach hasn't seen any meals today. Log something when you get a chance.",
  "Haven't logged today yet — even a quick entry counts.",
];

function getRandomReminder(): string {
  return REMINDER_MESSAGES[Math.floor(Math.random() * REMINDER_MESSAGES.length)];
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = adminClient();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartISO = todayStart.toISOString();
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
      // Skip if they've logged a meal today
      const { data: todayMeals } = await supabase
        .from("meals")
        .select("id")
        .eq("user_id", userId)
        .gte("created_at", todayStartISO)
        .neq("status", "failed")
        .limit(1);
      if (todayMeals?.length) continue;

      // Skip if we already sent a reminder in the last 8 hours
      const { data: recentReminder } = await supabase
        .from("nudges")
        .select("id")
        .eq("user_id", userId)
        .eq("type", "reminder")
        .gte("created_at", eightHoursAgo)
        .limit(1);
      if (recentReminder?.length) continue;

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
          title: "WhatYouAte",
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
