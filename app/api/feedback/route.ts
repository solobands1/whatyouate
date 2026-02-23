import { NextResponse } from "next/server";

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
