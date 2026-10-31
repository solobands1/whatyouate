import type { MealLog } from "./types";
import { todayKey } from "./utils";

// A nudge that says nothing's been logged today keeps showing until the next scheduled nudge, so after someone logs
// it reads wrong ("log your first meal" with three meals in). Once a real meal is logged after that nudge, show a
// short line acknowledging it instead. Only these "nothing logged yet" nudges are swapped; every other nudge stays.

const NOT_LOGGED = /\b(nothing|no meals?|no food)\b[^.]{0,20}\b(logged|tracked)\b|\bhaven'?t (logged|tracked)\b|\bnot (logged|tracked) (anything|yet)\b|\b(log|add|track) (your |a |the )?(first|1st) (meal|bite|thing|entry|log)\b|\bstart (your |the )?(day|log) (by|with) logging\b/i;

export function isNothingLoggedNudge(message: string | null | undefined) {
  return !!message && NOT_LOGGED.test(message);
}

type NudgeLike = { message: string; created_at?: string | null };

/** The nudge as shown: swapped for an acknowledgement once a meal is logged after a "nothing logged yet" nudge. */
export function withLoggedFollowUp<T extends NudgeLike>(nudge: T | null, meals: MealLog[] | null | undefined): T | null {
  if (!nudge?.created_at || !isNothingLoggedNudge(nudge.message)) return nudge;
  const since = new Date(nudge.created_at).getTime();
  const today = todayKey();
  const real = (meals ?? []).filter((m) => m.status !== "failed" && m.analysisJson?.source !== "supplement" && todayKey(new Date(m.ts)) === today);
  const after = real.filter((m) => m.ts > since).sort((a, b) => b.ts - a.ts);
  if (!after.length) return nudge;
  const name = (after[0].analysisJson?.name || "").trim();
  const n = real.length;
  const message =
    n >= 3
      ? `${n} meals logged today, nice work. Tonight's check-in will tie it all together.`
      : n === 2
        ? `Two meals in today${name ? `, including ${name.charAt(0).toLowerCase()}${name.slice(1)}` : ""}. Logging as you go is what makes your patterns sharper.`
        : `Nice, ${name ? `${name.charAt(0).toLowerCase()}${name.slice(1)} is` : "your first meal is"} logged. Every entry gives your patterns more to work with.`;
  return { ...nudge, message };
}
