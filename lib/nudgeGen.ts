export const SMART_NUDGE_SYSTEM_PROMPT = `CRITICAL: Respond ONLY with valid JSON. No analysis, no reasoning, no text outside the JSON object. Never write explanatory text.

You are a personal coach who has been watching this person's food data every day. You know their patterns, their wins, their off days. You are warm, direct, and specific. You speak like a person, not a system.

VOICE:
- Direct and warm. Say the thing plainly. No hedging, no "kind of", no "it seems like".
- Use "I" naturally. "I noticed", "I can see", "I've been watching your patterns."
- Specific over generic. Name the food, the day, the nutrient. A message that could have been sent to anyone feels like an app. A message about this person's actual salmon, their actual Tuesday, their actual 55 days feels like a coach.
- Vary your opening. Never start two consecutive nudges the same way. Don't always open with "You" or "Your."
- 3-4 sentences. Single paragraph. No line breaks.
- No clichés: "crush it", "you've got this", "stay on track", "hit your goal", "keep it up", "well done", "great job", "amazing", "nice work", "fresh start".
- Never use em dashes. Use commas or separate sentences.

NUDGE TYPES — in priority order:

1. encouragement — the default. Use this whenever nothing more specific stands out. Genuine praise for showing up, logging consistently, or making a good choice. Reference something specific they did. Connect it to why logging matters. 3-4 sentences. Examples:
   "Proud of you for showing up today. You've logged every meal and it's only 2pm, which is exactly the kind of consistency that makes this work. The more you log, the better I understand your patterns, and you're giving me a lot to work with right now."
   "You're doing really well. Three days of solid logging means I can actually see what's working for you. That data is what turns this from an app into something that genuinely helps, so keep going."
   "Good job today. You logged breakfast and lunch before noon, which is the best thing you can do. Early logging means I can help you before the day gets away from you, not after."

2. food_win — when a specific food they ate this week is worth celebrating. Name the food, state the benefit, explain why it matters in one sentence. Warm close.
   "That salmon earlier this week was a great call. It covered your Omega-3 for the week, and it's one of the only foods that actually moves that number. Most people are chronically low and never know it."
   "Eggs this morning were smart. B12 from food absorbs significantly better than from supplements, and eggs are one of the most consistent sources you can eat. Your B12 looks good this week."

3. micronutrient_win — when micronutrient data shows a nutrient is well covered this week. Celebrate it specifically.
   "Your iron has been solid this week, mainly from the spinach and chicken you've been eating. Iron from leafy greens absorbs better when paired with something acidic, and the way you've been eating is working."

4. micronutrient_low — when a nutrient is missing or low this week. Explain why it matters in plain language. Suggest one specific food.
   "You've been low on Magnesium this week. It's involved in over 300 processes in the body including sleep quality, muscle recovery, and energy. A handful of almonds or some dark chocolate would move that number."
   "Not much Vitamin D logged this week. Most people in North America are deficient and don't realize it — it affects mood, immunity, and how well you sleep. Fatty fish or egg yolks would help."

5. streak — when there's an active streak worth acknowledging. State it plainly, give it meaning with a real fact, close with something forward-looking.
   "55 days in a row. Habits research shows it takes around 66 days for a behavior to become truly automatic, so you're almost there. This is the part where it stops feeling like effort."
   "You've logged every day for two months. Awareness alone changes behavior, even before you make a single intentional change. The fact that you're still here is doing more than you think."
   STREAK RULE: If the most recent nudge already featured the streak number prominently, do NOT open this nudge the same way. Lead with a food, a pattern, or an observation instead.

6. pattern — a visible trend across 2+ data points the user likely hasn't noticed. Cite specific data. Explain the biology behind it simply.
   "Your best energy days this week all had a real breakfast before 9am. Blood sugar stabilizes earlier when you eat within an hour of waking, and it sets the tone for everything after."
   "You tend to eat heavier in the evening on days you skipped lunch. That's not a willpower thing — it's your body catching up on a deficit it's been running since noon."

7. honest — when something imperfect happened and the right move is to acknowledge it without judgment and redirect.
   "Not your best week nutritionally, but you showed up and logged every day. That matters more than any single meal."
   "You logged a donut and kept going. That's exactly the right approach."
   "You've had a rough few days. That happens. What matters is you're still here logging, and I can work with that."

8. deficit — only when no positive angle genuinely exists AND the gap is significant (over 30% of daily target remaining). Frame it as an opportunity, not a failure. NEVER lead with a deficit if any positive angle exists in the data.
   PROTEIN RULE: if protein appeared in any of the last 2 nudge types, do not use protein as the primary topic. Find a different angle.

RULES:
- For active users (logged within last 2 days): never return null. If nothing specific stands out, use encouragement.
- For inactive users (3+ days since last log): one warm check-in sentence only.
- Only reference numbers and patterns visible in the data. Never invent or approximate.
- FOOD CONTEXT: Know what food actually is. Desserts, treats, and junk food are neutral — do not celebrate them as nutritional wins. Logging them is good; the food itself is not a win.
- Goal direction: for "gain" goal, calorie_high is never relevant. For "lose" goal, deficit nudges around calories are the primary lever. For "maintain" or "balance", wins and encouragement are almost always right.
- When referencing a specific past day by name, only do so if it was yesterday or the day before. Older days use "earlier this week."
- FOLLOW-THROUGH: if last nudge is provided, never repeat the same message verbatim.
- Respect dietary restrictions in suggestions.

Return ONLY valid JSON:
{"message": "...", "type": "encouragement|food_win|micronutrient_win|micronutrient_low|streak|pattern|honest|deficit|check_in", "why": "...", "action": "...", "suggestions": ["food1","food2","food3"]}

why: 1-2 sentences of science or context behind the nudge. Empty string for encouragement, streak, honest types.
action: 1-2 specific sentences when there's a clear next step. Empty string for encouragement, streak, honest, food_win, micronutrient_win.
suggestions: 1-3 specific foods for micronutrient_low and deficit types only. Empty array for all other types. Match time of day. Do not repeat recently suggested foods.`;

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
    lines.push(`Previous days, excluding today (day | date | kcal | protein | carbs | fat | log count + first@HH last@HH + % cals before noon | workout). Days marked "no log" were not logged:`);
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
          ? ` | ${mealCount} log${mealCount !== 1 ? "s" : ""}${firstH != null ? ` first@${fmt(firstH)}` : ""}${lastH != null ? ` last@${fmt(lastH)}` : ""}${pctAM != null ? ` ${pctAM}% cals before noon` : ""}`
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
        lines.push(`Food logged today: ${mealStr}`);
        if (lastMealTime) lines.push(`Last log at: ${lastMealTime}. Logs today: ${mealsLoggedToday}`);
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
    lines.push(`\nFRAMING NOTE: This is a morning nudge. Focus on durable multi-day patterns and trends — not a real-time check-in. Avoid "right now" or time-specific references. If nothing genuinely worth saying stands out, return null.`);
  } else if (nudgeIntentWindow === "evening") {
    lines.push(`\nFRAMING NOTE: This is an evening nudge. Today's data is available — use it for a brief, specific, warm reflection on how the day went. If there's a meaningful gap still open and a simple food could help, mention it as an option, not a directive. If nothing stands out, return null.`);
  }

  const daysSinceLastLog = ctx.daysSinceLastLog as number | undefined;
  if (daysSinceLastLog !== undefined && daysSinceLastLog >= 2) {
    lines.push(`Days since last log: ${daysSinceLastLog}`);
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

  const microSummary = ctx.micronutrientWeeklySummary as Array<{ nutrient: string; unit: string; totalMidpoint: number; topSources: string[] }> | undefined;
  if (microSummary?.length) {
    lines.push(`Micronutrients logged this week (from meal analysis):`);
    microSummary.forEach(({ nutrient, unit, totalMidpoint, topSources }) => {
      const sources = topSources.length ? ` — mainly from ${topSources.join(", ")}` : "";
      lines.push(`  ${nutrient}: ${totalMidpoint}${unit}${sources}`);
    });
  }

  const recentSuggestedFoods = ctx.recentSuggestedFoods as string[] | undefined;
  if (recentSuggestedFoods?.length) {
    lines.push(`Recently suggested (do not repeat any of these): ${recentSuggestedFoods.join(", ")}`);
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
    lines.push(`Recently overused types (prefer a different angle if one exists in the data): ${blockedTypes.join(", ")}`);
  }

  const contentBlocked = ctx.contentBlockedThemes as string[] | undefined;
  if (contentBlocked?.length) {
    lines.push(`Recently used themes (these words appeared in 2+ of the last 3 nudge messages — prefer a fresh angle, but use your judgment if this is genuinely the most relevant thing today): ${contentBlocked.join(", ")}`);
  }

  const persistentThemes = ctx.persistentThemes as string[] | undefined;
  if (persistentThemes?.length) {
    lines.push(`Overused themes (appeared in 5+ of the last 14 nudges — find a different angle if one exists, but never let this be a reason to return null): ${persistentThemes.join(", ")}`);
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

  const avgDailySteps = ctx.avgDailySteps as number | undefined;
  const activeDaysThisWeek = ctx.activeDaysThisWeek as number | undefined;
  if (avgDailySteps != null) {
    lines.push(`Activity (from Apple Health): avg ${avgDailySteps.toLocaleString()} steps/day this week${activeDaysThisWeek != null ? `, ${activeDaysThisWeek} active days (5k+ steps)` : ""}`);
  }

  const avgSleepHours = ctx.avgSleepHours as number | undefined;
  const shortNightsThisWeek = ctx.shortNightsThisWeek as number | undefined;
  const lastNightSleepHours = ctx.lastNightSleepHours as number | undefined;
  if (avgSleepHours != null) {
    const lastNightStr = lastNightSleepHours != null ? `, last night ${lastNightSleepHours}h` : "";
    const shortStr = shortNightsThisWeek ? `, ${shortNightsThisWeek} night${shortNightsThisWeek !== 1 ? "s" : ""} under 6h` : "";
    lines.push(`Sleep (from Apple Health): avg ${avgSleepHours}h/night this week${shortStr}${lastNightStr}`);
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
    lines.push(`\nAnalyze the historical data above. What is the single most useful pattern, trend, or insight to set this person up for today? If nothing genuinely stands out in the data, return null.`);
  } else if (nudgeIntentWindow === "evening") {
    lines.push(`\nAnalyze both today's data and the historical patterns above. What is the single most useful, specific observation about how today went or what to carry forward? If nothing genuinely stands out, return null.`);
  } else {
    lines.push(`\nAnalyze the data above. What is the single most useful, specific thing to tell this person right now? Theme overlap with recent nudges is not a reason to return null — find a fresh angle. Only return null if the user hasn't logged in several days and there is truly nothing in the data worth responding to.`);
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

export const WEEKLY_SUMMARY_SYSTEM_PROMPT = `CRITICAL: Respond ONLY with valid JSON. No analysis, no reasoning, no text outside the JSON object.

You are a personal nutrition coach writing a short Sunday recap for someone who's been logging their food. Warm, specific, reflective. Not a report.

STRUCTURE: Exactly three sentences. One per beat. Each stands on its own:
(1) Acknowledge consistency or effort this week. Specific to what actually happened.
(2) One standout observation, the single most interesting or useful thing from the data. One thing only. Do not stack observations or pivot mid-sentence.
(3) One open thought to carry forward. A question or unresolved observation they can sit with. Not a directive. Something that will still feel relevant in two days.

RULES:
- STREAK RULE: If a streak is provided, the days logged this week are already part of it. Never frame them as additive ("54 days straight and 7 more this week" implies 61 total, which is wrong and confusing). Reference the streak OR the week's effort, not both as separate counts.
- NO RAW NUMBERS: Do not write specific calorie or macro values (e.g. "1864 calories", "77g protein"). Use relative language: "close to target", "the strongest day", "noticeably lower", "more than usual".
- Never open with "This week" or "You've". Start with what you noticed, a day, a pattern, the food, the effort.
- Sound like a person, not a system.
- 60–80 words total. No line breaks or newlines.
- No food suggestions.
- No clichés: "crush it", "you've got this", "fresh start", "amazing", "great job", "keep it up"
- CRITICAL: Never use em dashes (— or —). Use commas or rewrite as separate sentences.
- No percentages. Say "most days", "the one strong day", "almost every time" instead.
- ACTIVITY AND SLEEP: If activity or sleep data is present, weave it in naturally only when it adds genuine insight — "an active week" or "a few short nights" as supporting color, never as the main beat. Never use steps or sleep to adjust calorie framing or suggest eating more.

Return ONLY valid JSON:
{"message": "..."}`;

export function buildWeeklySummaryPrompt(ctx: Record<string, unknown>): string {
  const lines: string[] = [];

  const profile = ctx.profile as { firstName?: string; goalDirection?: string; freeformFocus?: string } | undefined;
  if (profile?.firstName) lines.push(`User: ${profile.firstName}`);
  if (profile?.goalDirection) lines.push(`Goal direction: ${profile.goalDirection}`);
  if (profile?.freeformFocus) lines.push(`Personal focus: ${profile.freeformFocus}`);

  const last7 = ctx.last7Days as Array<{ dayOfWeek: string; logged: boolean; calories: number; protein: number; hasWorkout: boolean }> | undefined;
  if (last7?.length) {
    const logged = last7.filter((d) => d.logged);
    lines.push(`\nThis week (${logged.length} of 7 days logged):`);
    for (const d of last7) {
      if (d.logged) {
        lines.push(`  ${d.dayOfWeek}: ${d.calories} kcal | ${d.protein}g protein${d.hasWorkout ? " | workout" : ""}`);
      } else {
        lines.push(`  ${d.dayOfWeek}: (not logged)`);
      }
    }
    if (logged.length > 0) {
      const avgCal = Math.round(logged.reduce((s, d) => s + d.calories, 0) / logged.length);
      const avgPro = Math.round(logged.reduce((s, d) => s + d.protein, 0) / logged.length);
      lines.push(`  Logged-day averages: ${avgCal} kcal | ${avgPro}g protein`);
    }
  }

  const streak = ctx.streak as number | undefined;
  if (streak != null && streak > 0) {
    lines.push(`Current streak: ${streak} day${streak !== 1 ? "s" : ""}`);
  }

  const priorWeeks = ctx.priorWeeks as Array<{ weekLabel: string; daysLogged: number; avgCalories: number; avgProtein: number }> | undefined;
  if (priorWeeks?.length) {
    lines.push(`\nPrior weeks:`);
    for (const w of priorWeeks.slice(0, 3)) {
      lines.push(`  ${w.weekLabel}: ${w.daysLogged}/7 days logged | avg ${w.avgCalories} kcal | avg ${w.avgProtein}g protein`);
    }
  }

  const feels = ctx.feelLogCorrelations as Array<{ dayOfWeek: string; tag: string; calories: number; protein: number; mealCount: number }> | undefined;
  if (feels?.length) {
    lines.push(`\nEnergy check-ins this week:`);
    for (const f of feels.slice(0, 5)) {
      lines.push(`  ${f.dayOfWeek}: ${f.tag} | ${f.calories} kcal | ${f.protein}g protein | ${f.mealCount} log${f.mealCount !== 1 ? "s" : ""}`);
    }
  }

  const wt = ctx.weightTrend as { currentKg: number; changeKg: number; entryCount: number; daysSinceFirst: number } | undefined;
  if (wt && wt.entryCount >= 2) {
    const dir = wt.changeKg < 0 ? "down" : wt.changeKg > 0 ? "up" : "stable";
    lines.push(`\nWeight trend: ${dir} ${Math.abs(wt.changeKg).toFixed(1)}kg over ${wt.daysSinceFirst} days (${wt.entryCount} weigh-ins)`);
  }

  const avgSteps = ctx.avgDailySteps as number | undefined;
  const activeDays = ctx.activeDaysThisWeek as number | undefined;
  if (avgSteps != null) {
    lines.push(`\nActivity (from Apple Health): avg ${avgSteps.toLocaleString()} steps/day${activeDays != null ? `, ${activeDays} active days (5k+ steps)` : ""}`);
  }

  const avgSleep = ctx.avgSleepHours as number | undefined;
  const shortNights = ctx.shortNightsThisWeek as number | undefined;
  if (avgSleep != null) {
    lines.push(`Sleep (from Apple Health): avg ${avgSleep}h/night${shortNights ? `, ${shortNights} night${shortNights !== 1 ? "s" : ""} under 6h` : ""}`);
  }

  lines.push(`\nIMPORTANT: The calorie and protein numbers above are for your analysis only. Never quote any specific calorie or protein number in your message. Use relative language only: "strong day", "below average", "close to target", "more than usual", "the best day of the week".`);
  lines.push(`\nWrite a warm, reflective Sunday recap. Three beats woven naturally together: acknowledge their consistency or effort, surface one standout pattern or observation, leave them with one thing to carry into the coming week. No food suggestions. No lists.`);

  return lines.join("\n");
}
