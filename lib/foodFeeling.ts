// Layer 2 of the food->feeling differentiator: correlate the feeling attributes we tag
// onto meals (lib/foodTags.ts) with how the user actually felt. Deterministic + honest —
// every number is a real count with min-sample guards, phrased as association not cause.
//
// Two alignment windows:
//   - same_day: any meal tagged X on day D  ->  energy on the reflection for day D
//   - next_day: an EVENING meal tagged X on day D  ->  energy on day D+1 (the "chips at
//     night -> low energy tomorrow" case)
//
// We only surface the WORSE direction (a NEGATIVE tag that lines up with MORE low-energy
// days), since that's the actionable, honest signal. We scan ONLY NEGATIVE_FEELING_TAGS, so
// a positive tag ("lean_protein", "vegetable_forward"…) can never be spuriously shamed on
// thin/noisy data — positives are captured (lib/foodTags.ts) and wait for the Layer-2 engine
// to surface "what lifts you." Data-gated: returns [] until there's enough tagged history, so
// the UI shows a Preview until then. See project_food_feeling memory.

import { NEGATIVE_FEELING_TAGS, FEELING_TAG_LABEL, type FeelingTag } from "./foodTags";

const MIN_WITH = 4;       // need >=4 days WHERE the tag was present
const MIN_WITHOUT = 4;    // and >=4 comparison days without it
const MIN_DIFF = 0.25;    // low-energy rate must be at least this much higher with the tag
const EVENING_HOUR = 17;  // "evening" meal cutoff for the next-day lag
// The fewest nights (an energy answer, plus meals to compare) before any link can show.
export const MIN_FOOD_FEELING_DAYS = MIN_WITH + MIN_WITHOUT;

// The smallest shapes the engine reads. MealLog and ReflectionEntry satisfy them; the free-access
// math (lib/trial.ts) and the crons pass rows straight from the database.
export type FeelingMeal = { ts: number; analysisJson?: { feeling_tags?: string[] | null } | null };
export type FeelingReflection = { date: string; answers: Record<string, unknown> };

export interface FoodFeelingOptions {
  // The moment to evaluate at (defaults to now). The 45-day window is measured back from it.
  now?: number;
  // getTimezoneOffset() minutes (ET = 300 or 240). When set, days and the evening cutoff are read
  // in that offset, which is how the server matches the phone. When unset, the runtime's own
  // timezone is used, which on the phone is the device's.
  tzOffsetMinutes?: number | null;
}

type Clock = { dayKey: (ts: number) => string; hour: (ts: number) => number };
function clockFor(tzOffsetMinutes: number | null | undefined): Clock {
  if (typeof tzOffsetMinutes === "number" && Number.isFinite(tzOffsetMinutes)) {
    const shift = tzOffsetMinutes * 60_000;
    return {
      dayKey: (ts) => {
        const d = new Date(ts - shift);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      },
      hour: (ts) => new Date(ts - shift).getUTCHours(),
    };
  }
  return { dayKey: dayKeyOf, hour: (ts) => new Date(ts).getHours() };
}

function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shiftKey(key: string, deltaDays: number): string {
  const d = new Date(key + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface FoodFeelingLink {
  tag: FeelingTag;
  label: string;
  lag: "same_day" | "next_day";
  lowWith: number;     // fraction of low-energy days WITH the tag (0..1)
  lowWithout: number;  // fraction of low-energy days without it
  nWith: number;       // sample size (days with the tag present)
  confidence: "Building" | "Moderate";
}

export function computeFoodFeelingLinks(
  meals: FeelingMeal[],
  reflections: FeelingReflection[],
  windowDays = 45,
  opts: FoodFeelingOptions = {},
): FoodFeelingLink[] {
  const clock = clockFor(opts.tzOffsetMinutes);
  const cutoffTs = (opts.now ?? Date.now()) - windowDays * 86_400_000;
  const cutoffKey = clock.dayKey(cutoffTs);

  // dayKey -> was energy low that day (only days with an energy answer, within window)
  const energyLow = new Map<string, boolean>();
  for (const e of reflections) {
    if (e.date < cutoffKey) continue;
    const ev = e.answers["energy"];
    if (typeof ev !== "number") continue;
    energyLow.set(e.date, ev <= 1); // Drained/Low
  }
  if (energyLow.size < MIN_WITH + MIN_WITHOUT) return [];

  // dayKey -> tags present across all meals that day / across evening meals only
  const dayTags = new Map<string, Set<FeelingTag>>();
  const eveTags = new Map<string, Set<FeelingTag>>();
  for (const m of meals) {
    if (m.ts < cutoffTs) continue;
    const tags = (m.analysisJson?.feeling_tags ?? []) as FeelingTag[];
    if (!tags.length) continue;
    const key = clock.dayKey(m.ts);
    const all = dayTags.get(key) ?? new Set<FeelingTag>();
    tags.forEach((t) => all.add(t));
    dayTags.set(key, all);
    if (clock.hour(m.ts) >= EVENING_HOUR) {
      const eve = eveTags.get(key) ?? new Set<FeelingTag>();
      tags.forEach((t) => eve.add(t));
      eveTags.set(key, eve);
    }
  }

  const links: FoodFeelingLink[] = [];
  for (const tag of NEGATIVE_FEELING_TAGS) {
    for (const lag of ["same_day", "next_day"] as const) {
      const src = lag === "same_day" ? dayTags : eveTags;
      let withLow = 0, withN = 0, woLow = 0, woN = 0;
      for (const [outcomeDay, isLow] of energyLow) {
        // Antecedent day: same day for same_day, the day before for the next-day lag.
        const antDay = lag === "same_day" ? outcomeDay : shiftKey(outcomeDay, -1);
        const present = src.get(antDay);
        // Only compare days we actually have meal data for, so tag-absence is meaningful.
        if (!present) continue;
        if (present.has(tag)) { withN++; if (isLow) withLow++; }
        else { woN++; if (isLow) woLow++; }
      }
      if (withN < MIN_WITH || woN < MIN_WITHOUT) continue;
      const lowWith = withLow / withN;
      const lowWithout = woLow / woN;
      if (lowWith - lowWithout < MIN_DIFF) continue; // only the "worse" direction
      links.push({
        tag,
        label: FEELING_TAG_LABEL[tag],
        lag,
        lowWith,
        lowWithout,
        nWith: withN,
        confidence: withN >= 8 ? "Moderate" : "Building",
      });
    }
  }

  // Strongest gap first, then keep one entry per tag (its best lag), cap at 3.
  links.sort((a, b) => (b.lowWith - b.lowWithout) - (a.lowWith - a.lowWithout) || b.nWith - a.nWith);
  const seen = new Set<FeelingTag>();
  return links.filter((l) => (seen.has(l.tag) ? false : (seen.add(l.tag), true))).slice(0, 3);
}

// Plain words for a link's confidence, on Patterns and the paywall.
export const CONFIDENCE_CHIP: Record<FoodFeelingLink["confidence"], string> = { Building: "Early Pattern", Moderate: "Clearer Pattern" };

// The one sentence for a link, used word for word by Patterns and the paywall. It says the two
// things lined up, never that one caused the other.
export function foodLinkSentence(l: Pick<FoodFeelingLink, "label" | "lag">): string {
  const label = l.label.charAt(0).toUpperCase() + l.label.slice(1);
  return l.lag === "next_day"
    ? `${label} the night before has lined up with more of your low-energy days.`
    : `Days with ${l.label} have lined up with more of your low-energy days.`;
}

// Days the engine can already compare: an energy answer that night plus at least one tagged meal
// that day. It needs MIN_FOOD_FEELING_DAYS of them before a link can show (more if the days are
// all alike). Drives the Free Access progress bar on Home.
export function foodFeelingDays(meals: FeelingMeal[], reflections: FeelingReflection[], windowDays = 45, opts: FoodFeelingOptions = {}): number {
  const clock = clockFor(opts.tzOffsetMinutes);
  const cutoffTs = (opts.now ?? Date.now()) - windowDays * 86_400_000;
  const cutoffKey = clock.dayKey(cutoffTs);
  const tagged = new Set<string>();
  for (const m of meals) {
    if (m.ts < cutoffTs || !(m.analysisJson?.feeling_tags ?? []).length) continue;
    tagged.add(clock.dayKey(m.ts));
  }
  const days = new Set<string>();
  for (const e of reflections) {
    if (e.date < cutoffKey || typeof e.answers["energy"] !== "number") continue;
    if (tagged.has(e.date)) days.add(e.date);
  }
  return days.size;
}
