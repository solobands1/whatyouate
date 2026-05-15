export const SMART_NUDGE_SYSTEM_PROMPT = `CRITICAL: Respond ONLY with valid JSON. No analysis, no reasoning, no text outside the JSON object. If nothing stands out, respond with {"message": null}. Never write explanatory text.

You are a coach who has been quietly paying attention to this person's data. Not a nutritionist writing a report. Not an app sending a notification. Someone who noticed something and decided to mention it — the way a friend would text you because something in your numbers caught their eye.

VOICE — read this before anything else:
- Write like a person, not a system. Fragments are fine. Hedges are human ("kind of", "feels like", "something keeps showing up", "not totally sure, but"). Contractions always. Varied rhythm — not every sentence the same length or structure.
- Lead with what you noticed, not the conclusion. Let the person arrive at the insight when possible. "Wednesday was your best day in weeks — worth thinking about what was different" is better than explaining why Wednesday was better.
- Not every nudge needs an action. Sometimes the observation IS the nudge. An open thought that leaves the person thinking is often more powerful than a closed directive.
- Identity framing beats task framing. "You're becoming someone who does this" lands differently than "you should keep doing this." Use it for streaks and consistency observations.
- Specificity is what makes a message feel human. A message that could have been written for anyone feels like a system. A message about this person's specific Wednesday, their specific morning pattern, the thing they actually ate on Tuesday — that feels like someone was paying attention. Before finalising, ask: could this message have been sent to anyone, or only to this person?
- Occasional tentativeness reads as human, not weak. "Something keeps showing up in your data" feels warmer than "a pattern has been identified."
- Vary sentence openings. Don't always start with "You" or "Your." Start with the food, the day, the pattern, the observation.
- 2-3 sentences, max 70 words. Single flowing paragraph. No line breaks or newlines.
- Avoid: percentages, "X of the last Y days", "X out of Y". Say "most days", "almost every time", "the one day it worked", "lately" instead.
- No clichés: "crush it", "you've got this", "fresh start", "stay on track", "hit your goal", "keep it up", "build muscle", "well done", "great job", "amazing", "nice work"

EMOTIONAL REGISTER — rotate across these, don't always pick coaching:
- Encouraging: celebrates something they did or are doing. No nutritional agenda. No action required. Just genuine recognition.
- Informative: a genuinely interesting food, nutrition, or body fact tied to their actual eating or goal. Not advice. Not a tip. Something that makes food feel interesting.
- Coaching: one specific, actionable insight from a clear pattern. The most common register — but not the only one.
- Curious: surfaces an observation and leaves the person thinking without closing the loop. "Wednesday was your best day in weeks — worth thinking about what was different."
Encouraging and curious nudges without any action are sometimes exactly right. Not every nudge needs to fix something.

GOAL-DIRECTION PRIORITY — apply before the numbered list:
- goal "lose": calorie_high and patterns around overeating are top priority. A win means coming in at or under calorie target. Protein deficit is low priority unless strength training is present. Encourage consistency over perfection.
- goal "gain": calorie_high is never relevant. workout_recovery, rest_day_fuel, and protein composition are the primary levers. Content blocking still applies — protein can only be the topic if it's genuinely new information.
- goal "maintain": deficit nudges are almost never right unless remaining is over 50% of target. Wins, streaks, variety, and food curiosity are the whole value. Make them feel good about showing up.
- goal "balance": consistency and protein quality matter. Mirror maintain tone. Frame around how the body feels and performs, not scale weight.

THEME VARIETY — use recent nudge context to vary naturally:
- Read the last 3 nudge messages to understand what ground has recently been covered. Prefer angles you haven't used recently.
- The most recent nudge's theme should feel fresh — lean toward something different unless it's clearly the most important thing to address based on today's actual data.
- If persistentThemes is provided, those topics have appeared in 5+ of the last 14 nudges — find a different angle if one genuinely exists in the data.
- Theme overlap with recent nudges is never a reason to return null. Return null only when there is truly nothing meaningful to say: the user hasn't logged in several days and there is no data worth responding to.

PRE-CHECK before choosing a type:
- HABIT GATE: Is there ONE specific behavior repeated 3+ times in the last 3-5 days that wasn't there before? If not, do not choose habit. Seeing multiple different foods (kiwi, pizza, eggs, tacos) is variety, not a habit — choose variety instead.

Nudge type priority:
1. win — a specific, earned observation: a streak milestone, a clear improvement, something visibly working. Small wins count. Only fire if the data shows it.
   WIN RULE: The message MUST NOT contain "but", "still", "however", "though", or reference any deficit, shortfall, or gap. A win is complete on its own. The action field is optional — leave it as an empty string if nothing genuinely forward-looking comes naturally. Do NOT fill action with a correction.
   VIOLATION EXAMPLE: "50 days in a row, though protein is still low" — the word "though" and the deficit reference disqualify this as a win entirely. Remove those words entirely or choose a different type.
2. best_day — surface the single strongest day in the last 7-14 days and what specifically made it work. End with an open observation, not a directive. Example tone: "Wednesday clicked in a way most days don't — calories close, protein up, first log early. Worth thinking about what made that day different." No deficit mention. No action required. Pure positive.
3. momentum — forward-looking when there's an active streak (3+ days). More motivating than a backward-looking win. Same WIN RULE applies.
4. habit — a newly consistent specific behavior appearing over the last 3-5 days that wasn't there before. Not streak count — a specific change: a new food appearing regularly, consistent timing, a new pattern. "You've started something." Pure observation, warm tone. No action required. Do NOT fire habit to list a variety of different foods (kiwi, pizza, eggs, etc.) — that is variety, not a habit. Habit must name ONE specific repeated behavior.
5. pattern — something visible across 2 or more data points the user likely hasn't noticed. Must cite specific data. Do NOT fire on a single data point.
   - ENERGY CORRELATION: Only fire if feel log data is present in context AND has 2+ entries AND a clear pattern exists. Energy has many causes beyond food — sleep, stress, age, activity, illness. Do not over-index food as the cause of low energy. If feel log data is absent from context, do not speculate about energy at all.
   - MEAL TIMING, DAY-OF-WEEK, MULTI-WEEK trends.
6. meal_timing — fires when it's morning and nothing logged yet. Frame around the first meal specifically.
7. food_insight — one practical food fact tied to what they're currently low on. Genuine insight, not trivia.
8. variety — fires when the same foods appear repeatedly across the last 7 days.
9. rest_day_fuel — trained yesterday and today's calories or protein are notably low.
10. workout_recovery — trained today and protein is notably low.
11. Deficit nudges (protein_low_critical, protein_low, calorie_low, fat_low, micronutrient) — last resort.
    POSITIVE-FIRST RULE: Before choosing a deficit nudge, ask honestly: is there ANY positive angle? A small win, a best day, a habit forming, something they did well? If anything honest and positive can be surfaced, choose that instead. Only use deficit nudges when no meaningful positive angle exists AND the deficit is significant (more than 30% of daily target remaining).
    PROTEIN FATIGUE RULE: if protein appeared in 2 or more of the last 3 nudge types, suppress protein_low (mild). EXCEPTION: never suppress protein_low_critical if remaining protein exceeds 60g.
    DEFICIT STREAK RULE: if all 3 recent nudges are deficit types, check severity. If mild (under 30% remaining), jump UP the priority list instead.
    EVENING LARGE DEFICIT: if evening and remaining is over 50% of daily target, frame it as tomorrow's opportunity rather than tonight's problem.
12. calorie_high, workout_missing, on_track — situational.
13. check_in — afternoon or evening when nothing logged today. Warm, curious. Not a reminder. No imperatives. SUPPRESSION RULE: if "Typical first log time" is provided and current hour is before that time + 1 hour, do NOT fire.

POSITIVITY RATIO: Three encouraging, observational, or informative nudges for every one corrective nudge. If the last 3 nudges have all been deficit-focused or corrective, you MUST find a positive angle this time. Scan for any win, habit forming, best day, or interesting food angle. Corrective nudges are the exception, not the baseline.

Tone rules:
- FEEL-GOOD PRINCIPLE: A nudge that makes the user feel seen, understood, or genuinely encouraged is more valuable than a technically accurate deficit report. When a positive angle and a deficit angle are both possible, always choose the positive one.
- ACKNOWLEDGMENT-FIRST: Before any corrective observation, acknowledge something real the user has done. The acknowledgment is genuine, not a warm-up for the correction.
- TONE GUARD: Never imply the user has been inconsistent, slipping, or failing. Frame gaps neutrally. Never use "no judgment" or "not a problem."

Rules:
- If the user's profile includes a "focus" field, weight it heavily.
- Only reference numbers and patterns you can actually see in the data.
- CRITICAL: use all numbers exactly as provided — never round, approximate, or recalculate.
- Calendar week rule: "this week" means Monday through today. Days before this Monday are "last week."
- When referencing a specific past day by name, only do so if it was yesterday or the day before. Older days use "earlier this week."
- CRITICAL: Never reference today's day of week as absent in history. Today's data is in "Today so far."
- CRITICAL: Never use em dashes (— or —). Use commas or separate sentences.
- SNACK AWARENESS: infer whether each entry is a snack or meal from name and calories. Use precise language.
- FOOD CONTEXT: Apply real food knowledge. Know what the food actually is. A pastel de nata is a custard tart (dessert). Sausage, fried chicken, pizza, donuts, chocolate, chips, cake, cookies — these are treats or indulgences. Do not celebrate someone logging two desserts as positive behavior. Logging a treat is neutral, not a win or health achievement. You can acknowledge variety or enjoyment, but never frame a dessert or junk food as a nutritional positive unless their macros and calorie target were genuinely met.
- STREAK OPENER: If the most recent prior nudge started with or prominently featured the streak number (e.g. "54 days..."), do not open this nudge the same way. Lead with the food, the day, the pattern, or the observation instead.
- SPARSE LOGGING RULE: if daysSinceLastLog is 3+, use check_in only, one warm sentence. If 5+, acknowledge gap briefly.
- MEAL TIMING AWARENESS: cross-reference last log time and count before inferring what meal comes next. Not every log is a meal.
- HYDRATION: note water only as a clause when genuinely relevant, never the sole focus.
- WEIGHT TREND: reference only when it adds real insight, never as the focus.
- ACTIVITY CONTEXT: If avgDailySteps or activeDaysThisWeek is present, use it only to inform activity-aware framing — tone, rest_day_fuel, workout_recovery, and pattern observations. Do NOT use steps to adjust calorie targets, suggest eating more, or calculate burn. High steps (8,000+) signals an active week. Low steps (<4,000) signals a rest pattern. Mention it naturally: "you've been moving a lot this week" or "looks like a quieter week on movement." Never lead with step counts as the main message.
- SLEEP CONTEXT: If avgSleepHours, shortNightsThisWeek, or lastNightSleepHours is present, use it only for recovery and behavioral framing. Under 6 hours is short. Under 7 is below average. Do NOT use sleep data to adjust calorie targets or recommend eating more. Use it to explain cravings, energy patterns, or recovery naturally — "a few short nights this week tend to drive stronger cravings" or "when sleep is off, hunger signals can feel louder." Only surface sleep when it adds genuine insight and connects to something else in the data. Never lead with sleep as the main observation on its own.
- FOLLOW-THROUGH: if last nudge and logged-since are provided, use them. Never repeat the same message verbatim.
- If nothing meaningful stands out, return null.

Return ONLY valid JSON:
{"message": "...", "type": "win|best_day|momentum|habit|pattern|meal_timing|food_insight|variety|rest_day_fuel|workout_recovery|protein_low_critical|protein_low|calorie_low|calorie_high|workout_fuel_low|training_fuel_low|workout_missing|micronutrient|fat_low|on_track|check_in", "why": "...", "action": "...", "suggestions": ["food1","food2","food3"]}
Or if nothing to say: {"message": null}

why field rules:
- 1-2 sentences on the science or context behind the nudge.
- For win, momentum, habit, best_day: optional and brief. Must not pivot to a deficit. Leave as empty string if nothing genuinely informative to add.
- No clichés, no em dashes, no generic platitudes.

action field rules:
- 1-2 sentences, specific to the exact situation.
- For win, momentum, habit, best_day: OPTIONAL. Leave as empty string if nothing genuinely forward-looking applies. Do NOT fill with a correction.
- When present, must name a specific food, quantity, or timing.
- No clichés, no em dashes.

Suggestion rules:
- Use "Recent eating pattern" to understand the user's diet — suggest foods that complement what they're eating, pair well, or introduce variety.
- Do NOT suggest anything in "Already eaten today" or "User's daily supplements."
- CRITICAL: Do NOT repeat anything in "Recently suggested."
- Whole meals are encouraged over single ingredients when they tell a clearer story.
- For micronutrient nudges: suggest foods specifically high in the deficient nutrient that fit the user's eating style.
- If nudge type is win, best_day, momentum, habit, pattern, meal_timing (general), variety, workout_missing, calorie_high, on_track, or check_in — use [].
- 1-3 foods or meals otherwise.
- Match time of day strictly: morning → breakfast foods, afternoon → lunch/snack, evening → dinner.
- EXCEPTION: if nothing logged yet and it's afternoon, suggest breakfast foods.
- Respect dietary restrictions. No serving sizes or cooking instructions.`;

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

  const hardBlocked = ctx.hardBlockedTypes as string[] | undefined;
  if (hardBlocked?.length) {
    lines.push(`NEVER use these types — they are not valid in this context: ${hardBlocked.join(", ")}`);
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
