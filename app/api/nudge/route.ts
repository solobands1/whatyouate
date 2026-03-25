import { NextResponse } from "next/server";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const nudgeRateMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = nudgeRateMap.get(key);
  if (!entry || now >= entry.resetAt) {
    nudgeRateMap.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count += 1;
  return true;
}

const NUDGE_SYSTEM_PROMPT = `You are a gentle, non-judgmental nutrition coach. Write short, specific, conversational nudges for a user tracking their food and fitness.

Rules:
- 1-2 sentences, max 35 words
- Use the exact numbers provided
- Vary the opening — don't always start with "You've" or "Your"
- No em dashes, no exclamation marks (except on_track nudges)
- Sound like a knowledgeable friend, not a fitness app
- Return ONLY the nudge text, nothing else`;

function buildNudgePrompt(
  nudgeType: string,
  data: Record<string, unknown>,
  profileSummary: string,
  recentFoods: string[]
): string {
  const dataStr = Object.entries(data)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  const foodsStr = recentFoods.slice(0, 5).join(", ") || "not provided";

  return `Nudge type: ${nudgeType}
Data: ${dataStr || "none"}
User context: ${profileSummary}
Recent foods logged: ${foodsStr}

Write the nudge now.`;
}

export async function POST(req: Request) {
  try {
    const rateLimitKey = req.headers.get("x-forwarded-for") ?? "anon";
    if (!checkRateLimit(rateLimitKey)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "No API key" }, { status: 500 });

    const body = await req.json();
    const { nudgeType, data = {}, profile, recentFoods = [] } = body;

    if (!nudgeType) return NextResponse.json({ error: "Missing nudgeType" }, { status: 400 });

    const profileSummary = profile
      ? [
          profile.goalDirection && `goal: ${profile.goalDirection}`,
          profile.freeformFocus && `focus: ${profile.freeformFocus}`,
          profile.activityLevel && `activity: ${profile.activityLevel}`,
          profile.dietaryRestrictions?.length && `restrictions: ${profile.dietaryRestrictions.join(", ")}`,
        ]
          .filter(Boolean)
          .join(", ")
      : "no profile";

    const prompt = buildNudgePrompt(nudgeType, data, profileSummary, recentFoods);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6_000);

    try {
      const response = await fetch(ANTHROPIC_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 80,
          temperature: 0.7,
          system: NUDGE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) throw new Error("Anthropic request failed");

      const result = await response.json();
      const message = (result.content?.[0]?.text ?? "").trim();
      if (!message) throw new Error("Empty response");

      return NextResponse.json({ message });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
