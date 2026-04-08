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

const SMART_NUDGE_SYSTEM_PROMPT = `You are a sharp, perceptive nutrition coach. You have full access to a user's recent data. Your job is to find the ONE most useful, specific thing to tell them right now — or say nothing if nothing genuinely stands out.

Nudge type priority — work down this list and use the first that genuinely applies:
1. win — a specific, earned observation: a streak, an improvement, or a pattern that's working. Only fire this if the data actually shows it. No generic praise.
2. pattern — something you can see across the 7-day history that the user likely hasn't noticed: a day-of-week trend, a consistent gap, a correlation between workouts and intake. Only fire if you can cite something specific from the data.
3. food_insight — one practical, specific food fact directly tied to what they're currently low on. Useful and actionable, not trivia. E.g. "Greek yogurt has as much protein as most chicken portions and takes no prep."
4. workout_recovery — fires when they trained today and protein is notably low. More specific than a generic protein nudge.
5. Deficit nudges (protein_low_critical, protein_low, calorie_low, fat_low, micronutrient) — use these as a fallback when nothing above applies. They're useful but should not dominate every session.
6. calorie_high, workout_missing, on_track — situational.

Rules:
- 1-2 sentences, max 40 words
- Only reference numbers and patterns you can actually see in the data
- CRITICAL: use all numbers exactly as provided — never round, approximate, or recalculate them. If the data says 58g protein remaining, say 58g, not ~60g or "around 60"
- For today-specific nudges, prefer referencing the pre-calculated "remaining" values over the raw targets
- Use day-of-week and workout context when it adds specificity
- Be honest, direct, and specific — not generic
- No em dashes (—). End with a period or exclamation mark.
- Write as a single flowing paragraph — no line breaks, no newlines within the message
- No clichés: forbidden: "crush it", "you've got this", "fresh start", "stay on track", "hit your goal", "keep it up", "build muscle", "well done", "great job", "amazing", "nice work"
- Don't repeat the same angle as recent nudges — avoid the same type AND the same thematic angle under a different type
- If timeOfDay is "morning": frame as intention. If "afternoon": note there's still time. If "evening": brief and reflective.
- When referencing a specific past day by name (e.g. "Friday"), only do so if it was yesterday or the day before. For older patterns use general language like "earlier this week" or "your protein tends to drop mid-week".
- If nothing meaningful stands out, return null for message

Return ONLY valid JSON with no other text:
{"message": "...", "type": "win|pattern|food_insight|workout_recovery|protein_low_critical|protein_low|calorie_low|calorie_high|workout_fuel_low|training_fuel_low|workout_missing|micronutrient|fat_low|on_track", "action": "...", "suggestions": ["food1","food2","food3"]}
Or if nothing to say: {"message": null}

action field rules:
- 1-2 sentences, specific to the exact situation you noticed — not generic advice
- Complements the message (message = observation, action = what to do about it today)
- Different wording from the message — don't just restate it
- No clichés, no em dashes

Suggestion rules:
- 3 simple food names matching the nudge type
- CRITICAL: match suggestions to time of day — if morning suggest breakfast foods (eggs, yogurt, oats, smoothie), if afternoon suggest lunch/snack foods, if evening suggest dinner foods
- Empty array [] for win, pattern, workout_missing, calorie_high, on_track`;

function buildSmartPrompt(ctx: Record<string, unknown>): string {
  const profile = ctx.profile as Record<string, unknown> | null;
  const lines: string[] = [];

  if (profile) {
    const parts = [
      profile.goalDirection && `goal: ${profile.goalDirection}`,
      profile.age && `age: ${profile.age}`,
      profile.weight && `weight: ${profile.weight}kg`,
      profile.activityLevel && `activity: ${profile.activityLevel}`,
      profile.freeformFocus && `focus: ${profile.freeformFocus}`,
      (profile.dietaryRestrictions as string[] | undefined)?.length &&
        `restrictions: ${(profile.dietaryRestrictions as string[]).join(", ")}`,
    ].filter(Boolean);
    lines.push(`Profile: ${parts.join(", ")}`);
  }

  const targetCal = ctx.targetCalories as number | null;
  const targetPro = ctx.targetProtein as number | null;
  if (targetCal || targetPro) {
    lines.push(`Targets: ${targetCal ? `${targetCal} kcal` : ""}${targetCal && targetPro ? " | " : ""}${targetPro ? `${targetPro}g protein` : ""}`);
  }

  const last7 = ctx.last7Days as Array<Record<string, unknown>> | undefined;
  if (last7?.length) {
    lines.push(`Previous days, excluding today (day | date | kcal | protein | carbs | fat | workout). Days marked "no log" were not logged:`);
    last7.forEach((d) => {
      const wk = d.hasWorkout ? ` | workout ${d.workoutMinutes ?? "?"}min ${d.workoutIntensity ?? ""}` : "";
      const logged = d.logged as boolean;
      if (!logged) {
        lines.push(`  ${d.dayOfWeek} ${d.dateKey}: no log${wk}`);
      } else {
        lines.push(`  ${d.dayOfWeek} ${d.dateKey}: ${d.calories} kcal / ${d.protein}g protein / ${d.carbs}g carbs / ${d.fat}g fat${wk}`);
      }
    });
  }

  const todayCal = ctx.todayCalories as number;
  const todayPro = ctx.todayProtein as number;
  const todayFat = ctx.todayFat as number;
  const todayCarbs = ctx.todayCarbs as number;
  const remCal = ctx.remainingCalories as number | null;
  const remPro = ctx.remainingProtein as number | null;
  if (todayCal > 0 || todayPro > 0) {
    lines.push(`Today so far (${ctx.timeOfDay}): ${todayCal} kcal / ${todayPro}g protein / ${todayFat}g fat / ${todayCarbs}g carbs`);
    if (remCal !== null || remPro !== null) {
      const parts = [];
      if (remCal !== null) parts.push(`${remCal} kcal remaining to target`);
      if (remPro !== null) parts.push(`${remPro}g protein remaining to target`);
      lines.push(`Still needed today: ${parts.join(" | ")}`);
    }
  } else {
    lines.push(`Today so far (${ctx.timeOfDay}): nothing logged yet`);
    if (remCal !== null || remPro !== null) {
      const parts = [];
      if (remCal !== null) parts.push(`${remCal} kcal calories target`);
      if (remPro !== null) parts.push(`${remPro}g protein target`);
      lines.push(`Full targets for today: ${parts.join(" | ")}`);
    }
  }

  const streak = ctx.streak as number | undefined;
  const todayHasWorkout = ctx.todayHasWorkout as boolean | undefined;
  const streakParts: string[] = [];
  if (streak && streak > 1) streakParts.push(`${streak}-day logging streak`);
  if (todayHasWorkout) streakParts.push("worked out today");
  if (streakParts.length) lines.push(`Current: ${streakParts.join(", ")}`);

  const foods = ctx.recentFoods as string[] | undefined;
  if (foods?.length) {
    lines.push(`Foods logged in the last 1-2 days (excluding today): ${foods.slice(0, 12).join(", ")}`);
  }

  const recent = ctx.recentNudges as string[] | undefined;
  if (recent?.length) {
    lines.push(`Recent nudges shown (don't repeat these angles):\n${recent.map((n) => `  - "${n}"`).join("\n")}`);
  }

  lines.push(`\nTime of day: ${ctx.timeOfDay}`);
  lines.push(`\nAnalyze the data above. What is the single most useful, specific thing to tell this person right now? If nothing meaningful stands out, return null.`);

  return lines.join("\n");
}

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
            max_tokens: 300,
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
