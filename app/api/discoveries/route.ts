import { NextResponse } from "next/server";

export const maxDuration = 20;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const rateMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || now >= entry.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count += 1;
  return true;
}

type Candidate = { id: string; text: string; confidence: "Building" | "Moderate"; n: number; hits: number };
type Discovery = { text: string; confidence: "Building" | "Moderate" };

const SYSTEM = `You are the coach in a calm wellbeing app. You are given TRUE, pre-computed observations about the user's own nightly reflections, each with exact counts.

Rewrite the most meaningful 1-3 of them as short, warm observations in the coach's voice. Rules:
- Use ONLY the numbers and facts in the provided observations. NEVER invent counts, days, streaks, causes, or anything not given.
- These are associations, not proven causes. Hedge: "tends to", "often", "has lined up with". Never claim one thing "causes" another.
- 1 sentence each, under 22 words. Calm and non-judgmental. No hype, no clichés.
- No em dashes. End each with a period.
- If the observations don't support a genuinely useful point, return fewer (or none).
Return ONLY JSON: {"discoveries":[{"text":"...","confidence":"Building"|"Moderate"}]} with no other text.`;

// Deterministic fallback: the candidate statements are already honest + real-count.
function fallback(candidates: Candidate[]): Discovery[] {
  return candidates.slice(0, 3).map((c) => ({ text: c.text, confidence: c.confidence }));
}

export async function POST(req: Request) {
  try {
    const rateKey = req.headers.get("x-forwarded-for") ?? "anon";
    if (!checkRateLimit(rateKey)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    const body = await req.json();
    const candidates: Candidate[] = Array.isArray(body?.candidates) ? body.candidates.slice(0, 6) : [];
    if (candidates.length === 0) return NextResponse.json({ discoveries: [] });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    // No key or nothing to say -> honest deterministic statements.
    if (!apiKey) return NextResponse.json({ discoveries: fallback(candidates) });

    const prompt = `Observations (each is true, with exact counts):\n${candidates.map((c, i) => `${i + 1}. [confidence: ${c.confidence}] ${c.text}`).join("\n")}\n\nRewrite the strongest 1-3 in the coach's voice. Keep each observation's confidence label.`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(ANTHROPIC_URL, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          temperature: 0.5,
          system: SYSTEM,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok) return NextResponse.json({ discoveries: fallback(candidates) });
      const result = await response.json();
      const raw = (result.content?.[0]?.text ?? "").trim();
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return NextResponse.json({ discoveries: fallback(candidates) });
      const parsed = JSON.parse(match[0]);
      const discoveries: Discovery[] = Array.isArray(parsed?.discoveries)
        ? parsed.discoveries
            .filter((d: unknown): d is Discovery => !!d && typeof (d as Discovery).text === "string")
            .slice(0, 3)
            .map((d: Discovery) => ({ text: String(d.text), confidence: d.confidence === "Moderate" ? "Moderate" : "Building" }))
        : [];
      return NextResponse.json({ discoveries: discoveries.length ? discoveries : fallback(candidates) });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return NextResponse.json({ discoveries: [] });
  }
}
