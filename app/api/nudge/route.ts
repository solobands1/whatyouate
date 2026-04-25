import { NextResponse } from "next/server";
import { SMART_NUDGE_SYSTEM_PROMPT, buildSmartPrompt } from "../../../lib/nudgeGen";

export const maxDuration = 30;

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

const NUDGE_SYSTEM_PROMPT = `You are a warm, knowledgeable friend who tracks nutrition. Write short, honest messages — the kind a trusted friend who actually knows this stuff would send.

Message rules:
- 1-2 sentences, max 40 words
- Only use numbers and facts explicitly provided in the nudge data. Never invent streaks, days, or context you weren't given.
- Be direct and warm, not clinical. Acknowledge the situation, then give one clear action.
- End every message with a period or exclamation mark.
- No em dashes (—). Exclamation marks are fine where they feel natural, especially for workout and on_track nudges.
- No fitness-app clichés. Forbidden: "fresh chance", "build muscle", "crush it", "you've got this", "tomorrow is a new day", "stay on track", "hit your goal", "keep it up"
- Vary sentence openings — don't always start with "You've" or "Your"
- If timeOfDay is "morning", frame it as something to aim for today. If "afternoon", note there is still time. If "evening", keep it brief and reflective.

Suggestion rules:
- Return exactly 3 simple food names (e.g. "Greek yogurt", "Chicken breast", "Mixed nuts")
- For deficit nudges, suggest foods the user is NOT already logging regularly
- Match the nudge type: protein nudges -> protein-rich foods, calorie nudges -> energy-dense foods, fat nudges -> healthy-fat foods
- Respect dietary restrictions when provided
- No serving instructions or modifications in food names
- For workout_missing, calorie_high, and on_track nudges return an empty suggestions array []`;

function buildProfileSummary(profile: Record<string, unknown> | null): string {
  if (!profile) return "no profile";
  return [
    profile.goalDirection && `goal: ${profile.goalDirection}`,
    profile.freeformFocus && `focus: ${profile.freeformFocus}`,
    profile.activityLevel && `activity: ${profile.activityLevel}`,
    (profile.dietaryRestrictions as string[] | undefined)?.length &&
      `restrictions: ${(profile.dietaryRestrictions as string[]).join(", ")}`,
  ]
    .filter(Boolean)
    .join(", ") || "no profile";
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
    const { profile, recentFoods = [], timeOfDay = "morning" } = body;
    const profileSummary = buildProfileSummary(profile);
    const foodsStr = (recentFoods as string[]).slice(0, 10).join(", ") || "not provided";

    // Smart mode: accepts full context, AI decides what to say
    if (body.mode === "smart") {
      const prompt = buildSmartPrompt(body);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12_000);
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
            model: "claude-sonnet-4-6",
            max_tokens: 400,
            temperature: 0.7,
            system: SMART_NUDGE_SYSTEM_PROMPT,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!response.ok) throw new Error("Anthropic request failed");
        const result = await response.json();
        const raw = (result.content?.[0]?.text ?? "").trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return NextResponse.json({ nudge: null });
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.message) return NextResponse.json({ nudge: null });
        return NextResponse.json({ nudge: parsed });
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Batch mode: accepts nudges:[{nudgeType, data}] — one Claude call for all
    const nudges = body.nudges as Array<{ nudgeType: string; data?: Record<string, unknown> }> | undefined;
    if (nudges?.length) {
      const nudgeBlocks = nudges.map((n) => {
        const dataStr = Object.entries(n.data ?? {})
          .filter(([, v]) => v != null)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        return `${n.nudgeType}: ${dataStr || "no data"}`;
      }).join("\n");

      const prompt = `Write one nudge for each type below. Return ONLY a JSON object like {"nudgeType":{"message":"...","suggestions":["food1","food2","food3"]},...} with no other text.

Nudge types and data:
${nudgeBlocks}

User context: ${profileSummary}
Time of day: ${timeOfDay}
Recent foods the user has logged: ${foodsStr}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
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
            max_tokens: 600,
            temperature: 0.7,
            system: NUDGE_SYSTEM_PROMPT,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!response.ok) throw new Error("Anthropic request failed");
        const result = await response.json();
        const raw = (result.content?.[0]?.text ?? "").trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        const messages = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
        return NextResponse.json({ messages });
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Single mode (legacy)
    const { nudgeType, data = {} } = body;
    if (!nudgeType) return NextResponse.json({ error: "Missing nudgeType" }, { status: 400 });
    const dataStr = Object.entries(data as Record<string, unknown>)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    const prompt = `Nudge type: ${nudgeType}\nData: ${dataStr || "none"}\nUser context: ${profileSummary}\nRecent foods logged: ${foodsStr}\n\nWrite the nudge now.`;

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
