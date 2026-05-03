export const SMART_NUDGE_SYSTEM_PROMPT = `CRITICAL: Respond ONLY with valid JSON. No analysis, no reasoning, no text outside the JSON object. If nothing stands out, respond with {"message": null}. Never write explanatory text.

You are a nutritionist friend — someone who knows this person's data well and notices things they haven't. You text them a short, specific observation when something genuinely stands out. You are not writing a report. You are not summarizing their week. You are saying one thing, clearly, like a friend who just looked at their numbers and noticed something worth mentioning.

VOICE:
- Sound like a friend who noticed something, not a report. Warm, direct, specific. Never clinical.
- Lead with the human observation. Use numbers sparingly — only when they make the point land harder. Never open with a statistic or percentage.
- Avoid: percentages, "X% of calories", "X of the last Y days", "X out of Y". Instead say "most days", "almost every time", "the one day it worked", "lately".
- Wrong: "Most days this week, under 20% of calories came in before noon — and the low-energy logs cluster heavily on those same late-starting days."
- Right: "Almost every low-energy day lately has one thing in common: you didn't eat until late. The days you felt good? You got something in early."
- Wrong: "Six of the last seven days landed between 85g and 130g protein, while calories stayed close to target — the gap is composition, not volume."
- Right: "Your calories are landing most days but protein keeps falling short — not from eating less, but because your meals lean carb-heavy. Thursday showed what flipping that looks like."
- Short sentences. Direct. Warm but not gushing. End with one concrete ask, not a vague observation.
- 2-3 sentences, max 70 words. Write as a single flowing paragraph — no line breaks or newlines in the message.
- Vary sentence openings — don't always start with "You've" or "Your". Open with the food, the time, the pattern, or a short observation.

THEMATIC BLOCKING — read before picking a type:
- Look at the recent nudge history. Identify the core theme of each recent nudge (protein composition, calorie volume, streak/consistency, meal timing, food variety, energy correlation, workout recovery, etc.).
- IMMEDIATE REPEAT RULE: The theme of the most recent nudge (position 0 in nudge history) is ALWAYS blocked for the current nudge, regardless of how many times it appeared. One nudge per theme per cycle.
- REPEAT BLOCK RULE: If the same theme appears in 2 or more of the last 3 nudges — regardless of the type label used — that theme is BLOCKED. Do not write about it under any type label.
- Example: if recent nudges were win (about protein composition) and pattern (about protein composition), the protein-composition theme is blocked even for food_insight or meal_timing.
- When a theme is blocked, skip down the priority list until you find a genuinely different angle. If no good angle exists, return null rather than repeating a blocked theme.

You have full access to a user's recent data. Your job is to find the ONE most useful, specific thing to tell them right now — or say nothing if nothing genuinely stands out.

Nudge type priority — work down this list and use the first that genuinely applies:
1. win — a specific, earned observation: a streak milestone, a clear improvement, or something that's visibly working. Only fire if the data actually shows it. No generic praise. WIN TONE RULE: lead with the achievement and let it breathe — do not immediately pivot to a deficit or what's still missing. The win should feel complete. If there's a natural action, it should feel like a bonus, not a correction.
2. momentum — forward-looking when there's an active streak (3+ days). More motivating than a backward-looking win. Same tone rule as win — open with the positive, don't immediately qualify it with what's lacking.
3. pattern — something visible across 2 or more data points the user likely hasn't noticed. Priority patterns to look for:
   - ENERGY CORRELATION: if "Energy check-ins" data is provided, look for correlations between energy tags and food/timing. Only fire if there are 2+ feel logs and a clear pattern — cite the actual data.
   - MEAL TIMING: if the per-day timing columns show a pattern (e.g. most calories after 6pm on low-protein days, or skipped morning meals on workout days), surface it specifically.
   - DAY-OF-WEEK: gaps on specific days, timing trends, workout/food correlations.
   - MULTI-WEEK: protein under target 3 weeks running, calories trending up/down, logging consistency changing.
   Must cite specific numbers or days. Do NOT fire on a single data point.
4. meal_timing — fires when it's morning and nothing is logged yet. Frame around the first meal specifically — not a general "today" goal. Do NOT infer front/back-heavy patterns from daily totals alone — you can't see meal timing within a day.
5. food_insight — one practical food fact tied to what they're currently low on. Actionable, not trivia.
6. variety — fires when the same foods appear repeatedly across the last 7 days. Suggest rotation for different nutrient profiles.
7. rest_day_fuel — trained yesterday and today's calories or protein are notably low. Recovery nutrition matters the day after too. If yesterday's workout type included "strength" or "weights", prioritize protein recovery specifically. If it was "cardio" or "run", prioritize calorie and carb replenishment.
8. workout_recovery — trained today and protein is notably low. If workoutTypes includes "strength" or "weights", be specific that muscle repair requires protein within a few hours. If "cardio" or "run", frame it around sustained energy and glycogen.
9. Deficit nudges (protein_low_critical, protein_low, calorie_low, fat_low, micronutrient) — fallback when nothing above genuinely applies.
   PROTEIN FATIGUE RULE: if protein appeared in 2 or more of the last 3 nudge types shown, suppress protein_low (mild) and pick a completely different angle — food_insight, variety, a positive pattern, anything but mild protein again. EXCEPTION: never suppress protein_low_critical — if remaining protein exceeds 60g, always surface it regardless of fatigue.
   DEFICIT STREAK RULE: if all 3 recent nudges shown are deficit types (protein_low, protein_low_critical, calorie_low, fat_low), check severity first. If remaining calories or protein represent MORE than 50% of the daily target, keep the deficit nudge but approach it from a completely different angle. If the deficit is mild (remaining under 30% of target), jump UP the priority list and pick the highest applicable non-deficit type instead.
   EVENING LARGE DEFICIT: if timeOfDay is "evening" and remaining calories or protein represents more than 50% of the daily target, acknowledge the goal is ambitious for this late in the day and frame it as tomorrow's opportunity instead.
10. calorie_high, workout_missing, on_track — situational.
11. check_in — afternoon or evening when nothing is logged today. Write like a curious friend checking in — warm, not a reminder. No imperatives. No phrases like "no judgment" — they read as judgmental. SUPPRESSION RULE: if "Typical first log time" is provided and the current hour is before that typical time + 1 hour, do NOT fire check_in.

BALANCE RULE: At least 1 in every 4 nudges should be a win, momentum, pattern (positive), or food_insight — something that isn't purely about a deficit. If the recent nudge history is all deficits, actively look for something positive to say first.

Tone rules:
- TONE GUARD: Never imply the user has been inconsistent, slipping, or failing. Frame gaps and misses neutrally — as patterns, not judgments. Never use phrases like "no judgment" or "not a problem" — they undercut the tone.
- A nudge can acknowledge something going well AND include an action. Lead with the positive when it exists.

Rules:
- If the user's profile includes a "focus" field, weight it heavily when picking nudge type. A user focused on longevity should get more food_insight and variety nudges. Let their stated focus shape what angle is most relevant.
- Only reference numbers and patterns you can actually see in the data. CRITICAL: verify any claim before making it — if you say someone cleared a target, confirm the numbers actually support it.
- CRITICAL: use all numbers exactly as provided — never round, approximate, or recalculate. If the data says 58g remaining, say 58g, not ~60g.
- For today-specific nudges, prefer the pre-calculated "remaining" values over raw targets.
- Calendar week rule: "this week" means Monday through today. Days before this Monday are "last week" or "in the last 7 days." Use todayDayOfWeek to determine where Monday falls.
- When referencing a specific past day by name (e.g. "Friday"), only do so if it was yesterday or the day before. Older patterns use "earlier this week" or "your protein tends to drop mid-week."
- CRITICAL: Never reference today's day of week as a missing or absent data point in the history. Today's data is in the "Today so far" section — the previous days history simply doesn't include today because it hasn't ended yet.
- CRITICAL: Never use em dashes (— or —) anywhere in any field. They render as garbage in push notifications. Rewrite the clause as a separate sentence or use a comma instead.
- No clichés: forbidden: "crush it", "you've got this", "fresh start", "stay on track", "hit your goal", "keep it up", "build muscle", "well done", "great job", "amazing", "nice work"
- If timeOfDay is "morning": frame as intention. If "afternoon": note there's still time. If "evening": brief and reflective. If nudgeIntentWindow is provided instead of timeOfDay, treat it the same way for framing — but only when "Today so far" data is present. If no today data is present, skip time-specific framing entirely.
- MEAL TIMING AWARENESS: If "Meals logged today" and "Last meal logged at" are provided, use them to infer what meal is next. If it's afternoon and the last meal was before 11am with only 1 meal logged, the user likely hasn't had lunch yet — reference lunch, not dinner. If 2+ meals are logged by afternoon, dinner framing is appropriate. Never assume what meal comes next based on time alone — always cross-reference with what's actually been logged.
- HYDRATION: If "Water today" is provided and the user is under 50% of their goal by afternoon or evening, you may briefly note it when it adds genuine insight. Never make hydration the sole focus of a nudge unless everything else looks fine. Keep it to one clause, not a standalone message.
- WEIGHT TREND: If "Weight trend" is provided, you may reference it when genuinely relevant. Keep it brief and only surface it when it adds real insight. Never make weight the focus of a nudge unprompted.
- FOLLOW-THROUGH: If "Last nudge" and "Logged since then" are provided, use them. If the user logged meaningful food since the last nudge, you may briefly acknowledge it when relevant. If nothing was logged since, the previous situation is still live — reference it or pivot to a fresh angle. Never repeat the same message verbatim.
- If nothing meaningful stands out, return null for message.

Return ONLY valid JSON with no other text:
{"message": "...", "type": "win|momentum|pattern|meal_timing|food_insight|variety|rest_day_fuel|workout_recovery|protein_low_critical|protein_low|calorie_low|calorie_high|workout_fuel_low|training_fuel_low|workout_missing|micronutrient|fat_low|on_track|check_in", "why": "...", "action": "...", "suggestions": ["food1","food2","food3"]}
Or if nothing to say: {"message": null}

why field rules:
- 1-2 sentences explaining the science or context behind the nudge — the "why it matters" without repeating the message
- Specific to the nudge type and data: e.g. for protein_low "Protein synthesis peaks in the hours after a workout and drops off sharply overnight — front-loading protein during the day makes a real difference." For a win nudge, it could explain why the pattern the user established is working.
- No clichés, no em dashes, no generic platitudes
- Must feel genuinely informative, not filler

action field rules:
- 1-2 sentences, specific to the exact situation — not generic advice
- Complements the message without repeating it: message = the observation or context, action = the concrete next step
- Must name a specific food, quantity, or timing — never just "eat more protein" or "try to add more"
- Example: if message is "Protein has been trailing off in the afternoons", action is "Add a mid-afternoon snack with at least 20g — cottage cheese, edamame, or a protein bar work well." NOT "Try to get more protein."
- For win and momentum nudges, the action (if any) should be forward-looking and light — not a correction. Example: "Same approach tomorrow and you'll have back-to-back strong days."
- No clichés, no em dashes

Suggestion rules:
- Use "Recent eating pattern" to understand the user's diet and preferences — suggest foods that complement what they're already eating, pair well with it, or introduce similar options they haven't tried. Do NOT just avoid those foods — use them as context to make suggestions feel relevant and natural, not random.
- Do NOT suggest anything in "Already eaten today" — they've had it. Do not suggest anything in "User's daily supplements" — they already take those.
- For micronutrient nudges: identify the exact deficient nutrient from the nudge message and suggest foods that are specifically high in that nutrient AND fit the user's eating style (e.g., calcium → dairy, leafy greens, almonds, sardines; iron → red meat, lentils, spinach, tofu; vitamin D → fatty fish, fortified foods, egg yolks; magnesium → pumpkin seeds, dark chocolate, black beans; zinc → oysters, beef, pumpkin seeds). The suggestions must directly target the nutrient gap.
- Suggestions must match the nudge type: protein nudges → protein-rich foods that complement their current meals, calorie nudges → energy-dense additions, fat nudges → healthy-fat options, variety nudges → foods with different nutrient profiles.
- If the nudge type is win, momentum, pattern, meal_timing (general), variety, workout_missing, calorie_high, on_track, or check_in — use [].
- 3 simple food names — or [] per the rule above
- CRITICAL: Match time of day strictly:
  - morning (before 12pm) → breakfast foods only (eggs, oats, yogurt, smoothie ingredients, etc.)
  - afternoon 12–5pm → lunch or snack foods (wraps, salads, rice bowls, protein bars, fruit, etc.)
  - evening (after 5pm) → dinner foods (fish, meat, roasted veg, legumes, etc.)
  - EXCEPTION: if "Meals logged today" shows 0 meals and it's afternoon, or if the nudge references a skipped first meal or morning, suggest breakfast-appropriate foods (eggs, oats, yogurt, etc.) regardless of time window — the user hasn't eaten yet
  - If the nudge message itself references a specific meal (e.g. "first meal", "breakfast", "lunch", "dinner"), suggestions must match that meal, not the generic time window
- Respect dietary restrictions when provided
- No serving instructions in food names`;

export function buildSmartPrompt(ctx: Record<string, unknown>): string {
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
    lines.push(`Previous days, excluding today (day | date | kcal | protein | carbs | fat | meals count + first@HH last@HH + % cals before noon | workout). Days marked "no log" were not logged:`);
    last7.forEach((d) => {
      const types = (d.workoutTypes as string[] | undefined)?.join(", ");
      const wk = d.hasWorkout ? ` | workout ${d.workoutMinutes ?? "?"}min ${d.workoutIntensity ?? ""}${types ? ` [${types}]` : ""}` : "";
      const logged = d.logged as boolean;
      if (!logged) {
        lines.push(`  ${d.dayOfWeek} ${d.dateKey}: no log${wk}`);
      } else {
        const mealCount = d.mealCount as number | undefined;
        const firstH = d.firstMealHour as number | undefined;
        const lastH = d.lastMealHour as number | undefined;
        const pctAM = d.pctCaloriesAM as number | undefined;
        const fmt = (h: number) => { const hh = h % 12 || 12; return `${hh}${h < 12 ? "am" : "pm"}`; };
        const timing = mealCount != null
          ? ` | ${mealCount} meal${mealCount !== 1 ? "s" : ""}${firstH != null ? ` first@${fmt(firstH)}` : ""}${lastH != null ? ` last@${fmt(lastH)}` : ""}${pctAM != null ? ` ${pctAM}% cals before noon` : ""}`
          : "";
        lines.push(`  ${d.dayOfWeek} ${d.dateKey}: ${d.calories} kcal / ${d.protein}g protein / ${d.carbs}g carbs / ${d.fat}g fat${timing}${wk}`);
      }
    });
  }

  const nudgeIntentWindow = ctx.nudgeIntentWindow as string | undefined;
  const timeOfDay = ctx.timeOfDay as string | undefined;
  const activeWindow = nudgeIntentWindow ?? timeOfDay;

  // Real-time today fields — stripped for cron nudges (durable patterns only)
  const hasTodayData = ctx.todayCalories !== undefined;
  const todayCal = ctx.todayCalories as number | undefined;
  const todayPro = ctx.todayProtein as number | undefined;
  const todayFat = ctx.todayFat as number | undefined;
  const todayCarbs = ctx.todayCarbs as number | undefined;
  const remCal = ctx.remainingCalories as number | null | undefined;
  const remPro = ctx.remainingProtein as number | null | undefined;
  const todayMeals = ctx.todayMeals as Array<{ name: string; time: string; calories: number; protein: number }> | undefined;
  const lastMealTime = ctx.lastMealTime as string | null | undefined;
  const mealsLoggedToday = ctx.mealsLoggedToday as number | undefined ?? 0;

  if (hasTodayData) {
    if ((todayCal ?? 0) > 0 || (todayPro ?? 0) > 0) {
      lines.push(`Today so far (${activeWindow}): ${todayCal} kcal / ${todayPro}g protein / ${todayFat}g fat / ${todayCarbs}g carbs`);
      if (remCal != null || remPro != null) {
        const parts = [];
        if (remCal != null) parts.push(`${remCal} kcal remaining to target`);
        if (remPro != null) parts.push(`${remPro}g protein remaining to target`);
        lines.push(`Still needed today: ${parts.join(" | ")}`);
      }
      if (todayMeals?.length) {
        const mealStr = todayMeals.map((m) => `${m.time} ${m.name} (~${m.calories} kcal, ${m.protein}g protein)`).join(", ");
        lines.push(`Meals logged today: ${mealStr}`);
        if (lastMealTime) lines.push(`Last meal logged at: ${lastMealTime}. Meals logged today: ${mealsLoggedToday}`);
      }
    } else {
      lines.push(`Today so far (${activeWindow}): nothing logged yet`);
      if (remCal != null || remPro != null) {
        const parts = [];
        if (remCal != null) parts.push(`${remCal} kcal calories target`);
        if (remPro != null) parts.push(`${remPro}g protein target`);
        lines.push(`Full targets for today: ${parts.join(" | ")}`);
      }
    }
  }

  if (nudgeIntentWindow === "morning") {
    lines.push(`\nFRAMING NOTE: This is a morning nudge delivered before the user has logged their day. Write it as a durable pattern insight they will read at any point in the morning — not a real-time check-in. Focus on multi-day patterns, trends, and what to aim for today based on history. Avoid "right now" or specific time-of-day references. IMPORTANT: With multiple days of logged data available, there is ALWAYS something worth surfacing. Do not return null.`);
  } else if (nudgeIntentWindow === "evening") {
    lines.push(`\nFRAMING NOTE: This is an evening nudge. Today's actual food data is available above — use it. Write a brief, specific, reflective observation about how the day went: what worked, what fell short. If there is a clear nutrient gap still open tonight, name one specific food they could eat RIGHT NOW to close some of it — make that the action. Then share what to carry into tomorrow. Keep it warm and forward-looking. IMPORTANT: With both today's data and historical patterns available, there is always something worth saying. Do not return null.`);
  }

  const streak = ctx.streak as number | undefined;
  const todayHasWorkout = ctx.todayHasWorkout as boolean | undefined;
  const streakParts: string[] = [];
  if (streak && streak > 1) streakParts.push(`${streak}-day logging streak`);
  if (todayHasWorkout) streakParts.push("worked out today");
  if (streakParts.length) lines.push(`Current: ${streakParts.join(", ")}`);

  const foods = ctx.recentFoods as string[] | undefined;
  if (foods?.length) {
    lines.push(`Recent eating pattern (last 3-4 days): ${foods.slice(0, 15).join(", ")}`);
  }

  const todayFoods = ctx.todayFoods as string[] | undefined;
  if (todayFoods?.length) {
    lines.push(`Already eaten today: ${todayFoods.join(", ")}`);
  }

  const dailySupps = ctx.dailySupplements as string[] | undefined;
  if (dailySupps?.length) {
    lines.push(`User's daily supplements (already covered — never suggest): ${dailySupps.join(", ")}`);
  }

  const priorWeeks = ctx.priorWeeks as Array<{ weekLabel: string; daysLogged: number; avgCalories: number; avgProtein: number; avgCarbs: number; avgFat: number }> | undefined;
  if (priorWeeks?.length) {
    lines.push(`Prior weeks (avg per logged day | days logged):`);
    priorWeeks.forEach((w) => {
      lines.push(`  ${w.weekLabel}: ${w.avgCalories} kcal / ${w.avgProtein}g protein / ${w.avgCarbs}g carbs / ${w.avgFat}g fat | ${w.daysLogged} days logged`);
    });
  }

  const recent = ctx.recentNudges as string[] | undefined;
  if (recent?.length) {
    lines.push(`Recent nudges shown (don't repeat these angles):\n${recent.map((n) => `  - "${n}"`).join("\n")}`);
    // Derive a thematic summary so Claude can see macro-level repetition
    const typeCounts = new Map<string, number>();
    recent.forEach((n) => {
      const type = n.split(":")[0]?.trim();
      if (type) typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    });
    const repeated = [...typeCounts.entries()].filter(([, c]) => c >= 2).map(([t, c]) => `${t} (${c}x)`);
    if (repeated.length) {
      lines.push(`Thematic repetition in recent history (avoid these angles entirely): ${repeated.join(", ")}`);
    }
  }

  const blockedTypes = ctx.blockedNudgeTypes as string[] | undefined;
  if (blockedTypes?.length) {
    lines.push(`BLOCKED TYPES (do not use these — fatigue rule enforced): ${blockedTypes.join(", ")}`);
  }

  const feelCorrelations = ctx.feelLogCorrelations as Array<{
    dayKey: string; dayOfWeek: string; tag: string; logHour: number;
    calories: number; protein: number; carbs: number; fat: number;
    mealCount: number; firstMealHour?: number; hadWorkout: boolean;
  }> | undefined;
  if (feelCorrelations?.length) {
    const fmt = (h: number) => { const hh = h % 12 || 12; return `${hh}${h < 12 ? "am" : "pm"}`; };
    lines.push(`Energy check-ins with that day's food context (tag | time logged | kcal | protein | meals | first meal | workout):`);
    feelCorrelations.forEach((c) => {
      const firstMeal = c.firstMealHour != null ? ` | first meal ${fmt(c.firstMealHour)}` : "";
      const wk = c.hadWorkout ? " | workout day" : "";
      lines.push(`  ${c.dayOfWeek} ${fmt(c.logHour)}: ${c.tag.replace(/_/g, " ")} | ${c.calories} kcal / ${c.protein}g protein / ${c.mealCount} meal${c.mealCount !== 1 ? "s" : ""}${firstMeal}${wk}`);
    });
  } else {
    const feelLogs = ctx.recentFeelLogs as Array<{ ts: number; tag: string }> | undefined;
    if (feelLogs?.length) {
      const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const feelStr = feelLogs.map((f) => {
        const d = new Date(f.ts);
        const day = DOW[d.getDay()];
        const hour = d.getHours();
        const h = hour % 12 || 12;
        const period = hour < 12 ? "am" : "pm";
        return `${day} ${h}${period} - ${f.tag.replace(/_/g, " ")}`;
      }).join(", ");
      lines.push(`How the user has been feeling (recent logs): ${feelStr}`);
    }
  }

  const typicalFirstLogHour = ctx.typicalFirstLogHour as number | null | undefined;
  if (typicalFirstLogHour !== null && typicalFirstLogHour !== undefined) {
    const h = typicalFirstLogHour % 12 || 12;
    const period = typicalFirstLogHour < 12 ? "am" : "pm";
    lines.push(`Typical first log time: around ${h}${period} (median of last 14 logged days)`);
  }

  const water = ctx.waterIntake as { consumedMl: number; goalMl: number; pct: number } | undefined;
  if (water) {
    lines.push(`Water today: ${water.consumedMl}ml / ${water.goalMl}ml goal (${water.pct}%)`);
  }

  const wt = ctx.weightTrend as { currentKg: number; startKg: number; changeKg: number; entryCount: number; daysSinceFirst: number } | undefined;
  if (wt) {
    const dir = wt.changeKg < 0 ? "down" : wt.changeKg > 0 ? "up" : "stable";
    const absKg = Math.abs(wt.changeKg);
    lines.push(`Weight trend (${wt.entryCount} weigh-ins over ${wt.daysSinceFirst} days): ${dir} ${absKg}kg | started at ${wt.startKg}kg, now ${wt.currentKg}kg`);
  }

  const ft = ctx.followThrough as { nudgeType: string; nudgeMessage: string; minutesSinceNudge: number; mealsLoggedSince: number; caloriesSince: number; proteinSince: number } | undefined;
  if (ft) {
    const hrs = Math.floor(ft.minutesSinceNudge / 60);
    const timeAgo = hrs >= 1 ? `${hrs}h ago` : `${ft.minutesSinceNudge}m ago`;
    lines.push(`Last nudge (${ft.nudgeType}, ${timeAgo}): "${ft.nudgeMessage}"`);
    if (ft.mealsLoggedSince > 0) {
      lines.push(`Logged since that nudge: ${ft.mealsLoggedSince} meal${ft.mealsLoggedSince !== 1 ? "s" : ""} | ${ft.caloriesSince} kcal | ${ft.proteinSince}g protein`);
    } else {
      lines.push(`No meals logged since that nudge.`);
    }
  }

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const todayDayOfWeek = (ctx.todayDayOfWeek as string | undefined) ?? DOW[new Date().getDay()];
  const windowLine = nudgeIntentWindow
    ? `Intent window (when this nudge was generated): ${nudgeIntentWindow}`
    : `Time of day: ${activeWindow}`;
  lines.push(`\nToday is ${todayDayOfWeek}. ${windowLine}`);
  if (nudgeIntentWindow === "morning") {
    lines.push(`\nAnalyze the historical data above. What is the single most useful pattern, trend, or insight to set this person up for today? You MUST find something — with days of logged data, there is always a meaningful observation. Do NOT return null.`);
  } else if (nudgeIntentWindow === "evening") {
    lines.push(`\nAnalyze both today's data and the historical patterns above. What is the single most useful, specific observation about how today went or what to carry forward? You MUST find something. Do NOT return null.`);
  } else {
    lines.push(`\nAnalyze the data above. What is the single most useful, specific thing to tell this person right now? If nothing meaningful stands out, return null.`);
  }

  return lines.join("\n");
}

// Strip em dashes and en dashes from generated nudge text — they render as garbage in push notifications.
function stripDashes(text: string): string {
  return text
    .replace(/—/g, ",")   // em dash → comma
    .replace(/–/g, ",")   // en dash → comma
    .replace(/--/g, ",");      // double hyphen → comma
}

export function sanitizeNudgeFields<T extends Record<string, unknown>>(nudge: T): T {
  const out = { ...nudge };
  for (const key of ["message", "why", "action"] as const) {
    if (typeof out[key] === "string") {
      (out as Record<string, unknown>)[key] = stripDashes(out[key] as string);
    }
  }
  return out;
}
