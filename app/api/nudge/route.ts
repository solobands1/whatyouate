import { NextResponse } from "next/server";

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

const NUDGE_SYSTEM_PROMPT = `You are a gentle, non-judgmental nutrition coach. For each nudge, write a short message and suggest 3 relevant foods.

Message rules:
- 1-2 sentences, max 35 words
- Use the exact numbers provided
- Vary the opening — don't always start with "You've" or "Your"
- No em dashes, no exclamation marks (except on_track nudges)
- Sound like a knowledgeable friend, not a fitness app
- Reference the user's actual logged foods by name where it feels natural

Suggestion rules:
- Return exactly 3 simple food names (e.g. "Greek yogurt", "Chicken breast", "Mixed nuts")
- Use the user's recent foods as context only — for deficit nudges (protein_low, calorie_low, fat_low, etc.), suggest foods they are NOT already logging regularly, so they can add something new to close the gap
- Match the nudge signal: protein nudges → protein-rich foods, calorie nudges → energy-dense foods, fat nudges → healthy-fat foods
- Respect dietary restrictions when provided
- Never add serving instructions or modifications to a food name (no "extra scoop of X", no "more X")
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
    const { profile, recentFoods = [] } = body;
    const profileSummary = buildProfileSummary(profile);
    const foodsStr = (recentFoods as string[]).slice(0, 10).join(", ") || "not provided";

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
        // Extract JSON from response (may have markdown fences)
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
