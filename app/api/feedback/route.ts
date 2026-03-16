import { NextResponse } from "next/server";

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

    const lines = [
      "**New Feedback**",
      name ? `**Name:** ${name}` : null,
      email ? `**Email:** ${email}` : null,
      userId ? `**User ID:** ${userId}` : null,
      "",
      cleanMessage
    ].filter(Boolean);

    const payload = {
      content: lines.join("\n")
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

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
