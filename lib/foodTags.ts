// Food "feeling" attributes — a small, fixed vocabulary the food analyzer tags onto
// each meal. These are FOOD-INTRINSIC properties the model can infer from the food
// itself (not timing — late-night / late-caffeine are derived later from the meal's
// timestamp by the correlation engine). Attributes recur across many different foods
// (chips, fries, and fried chicken all share "fried_greasy"), so the food->feeling
// signal concentrates instead of fragmenting the way specific ingredients would.
//
// This is the capture layer (Layer 1): tag now on every meal so there's tagged history
// to analyze when the correlation engine (Layer 2) ships. See project_food_feeling memory.

export const FEELING_TAGS = [
  "fried_greasy",
  "high_sugar",
  "refined_carbs",
  "heavy_large",
  "alcohol",
  "caffeine",
  "highly_processed",
  "low_protein",
  "dairy_heavy",
  "very_spicy",
] as const;

export type FeelingTag = (typeof FEELING_TAGS)[number];

const TAG_SET = new Set<string>(FEELING_TAGS);

// Human-readable phrasing for display / correlation copy (association, never a verdict).
export const FEELING_TAG_LABEL: Record<FeelingTag, string> = {
  fried_greasy: "fried or greasy food",
  high_sugar: "sugary food",
  refined_carbs: "refined carbs",
  heavy_large: "a large, heavy meal",
  alcohol: "alcohol",
  caffeine: "caffeine",
  highly_processed: "highly processed food",
  low_protein: "a low-protein meal",
  dairy_heavy: "dairy-heavy food",
  very_spicy: "very spicy food",
};

// Keep only known tags, normalized + deduped, capped so a meal can't carry noise.
export function sanitizeFeelingTags(input: unknown): FeelingTag[] {
  if (!Array.isArray(input)) return [];
  const out: FeelingTag[] = [];
  for (const raw of input) {
    const t = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (TAG_SET.has(t) && !out.includes(t as FeelingTag)) out.push(t as FeelingTag);
    if (out.length >= 6) break;
  }
  return out;
}
