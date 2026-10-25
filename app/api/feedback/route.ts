import { NextResponse } from "next/server";
import { COLORS, headerDate, sendEmbeds } from "../../../lib/server/discord";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    let payloadJson: any = null;
    try {
      payloadJson = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      payloadJson = { message: rawBody };
    }
    const { message, userId, email, name } = payloadJson ?? {};

    const rateLimitKey = userId ?? req.headers.get("x-forwarded-for") ?? "anon";
    if (!checkRateLimit(rateLimitKey)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const webhookUrl = (process.env.DISCORD_WEBHOOK_URL ?? "").trim();
    if (!webhookUrl) {
      return NextResponse.json({ error: "Missing Discord webhook" }, { status: 500 });
    }

    const cleanMessage = String(message || "").trim();
    if (!cleanMessage) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const fields = [
      name ? { name: "Name", value: String(name).slice(0, 256), inline: true } : null,
      email ? { name: "Email", value: String(email).slice(0, 256), inline: true } : null,
      userId ? { name: "User ID", value: `\`${String(userId).slice(0, 100)}\``, inline: false } : null,
    ].filter(Boolean) as { name: string; value: string; inline: boolean }[];
    const res = await sendEmbeds(webhookUrl, [{
      title: "💬 New Feedback",
      description: cleanMessage.slice(0, 3900),
      color: COLORS.blue,
      fields,
      footer: { text: email ? `Reply to ${String(email).slice(0, 120)} from support@whatyouate.app` : "No email given, so there's no one to reply to." },
      timestamp: new Date().toISOString(),
    }], {
      username: "WhatYouAte · Feedback",
      content: `**💬 Feedback${name ? ` from ${String(name).slice(0, 60)}` : ""} · ${headerDate()}**`,
    });
    if (!res) {
      return NextResponse.json({ error: "Failed to send feedback" }, { status: 500 });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: "Failed to send feedback", status: res.status, detail },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 }
    );
  }
}
