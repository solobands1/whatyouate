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

import type { ReflectionEntry } from "./habitState";
import type { MealLog } from "./types";
import { NEGATIVE_FEELING_TAGS, FEELING_TAG_LABEL, type FeelingTag } from "./foodTags";

const MIN_WITH = 4;       // need >=4 days WHERE the tag was present
const MIN_WITHOUT = 4;    // and >=4 comparison days without it
const MIN_DIFF = 0.25;    // low-energy rate must be at least this much higher with the tag
const EVENING_HOUR = 17;  // "evening" meal cutoff for the next-day lag

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
  meals: MealLog[],
  reflections: ReflectionEntry[],
  windowDays = 45,
): FoodFeelingLink[] {
  const cutoffTs = Date.now() - windowDays * 86_400_000;
  const cutoffKey = dayKeyOf(cutoffTs);

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
    const key = dayKeyOf(m.ts);
    const all = dayTags.get(key) ?? new Set<FeelingTag>();
    tags.forEach((t) => all.add(t));
    dayTags.set(key, all);
    if (new Date(m.ts).getHours() >= EVENING_HOUR) {
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
