/**
 * Recommended Daily Allowances (RDA) for tracked micronutrients.
 * Values sourced from NIH / Dietary Reference Intakes (DRIs).
 * Units match what users will enter for supplements.
 */

export type RdaSex = "male" | "female" | "other" | "prefer_not";

// Nutrient name → daily RDA amount
export type RdaValues = Record<string, number>;

// RDA unit for each tracked nutrient (used for display + calculation)
export const NUTRIENT_UNITS: Record<string, string> = {
  iron: "mg",
  b12: "mcg",
  magnesium: "mg",
  zinc: "mg",
  "vitamin d": "IU",
  calcium: "mg",
  "omega-3": "mg",
  "vitamin c": "mg",
  potassium: "mg",
  fiber: "g",
};

// Aliases so "Vitamin D" / "vitamin d" / "vitd" all resolve to the canonical key
export const NUTRIENT_ALIASES: Record<string, string> = {
  "vitamin d": "vitamin d",
  "vit d": "vitamin d",
  vitd: "vitamin d",
  "vitamin d3": "vitamin d",
  "omega-3": "omega-3",
  "omega 3": "omega-3",
  "omega3": "omega-3",
  "epa/dha": "omega-3",
  "b12": "b12",
  "vitamin b12": "b12",
  "cobalamin": "b12",
  "vitamin c": "vitamin c",
  "vit c": "vitamin c",
  "ascorbic acid": "vitamin c",
  iron: "iron",
  magnesium: "magnesium",
  zinc: "zinc",
  calcium: "calcium",
  potassium: "potassium",
  fiber: "fiber",
  fibre: "fiber",
  "dietary fiber": "fiber",
  psyllium: "fiber",
  metamucil: "fiber",
  inulin: "fiber",
};

/**
 * Returns the canonical nutrient key for a given input string.
 * Returns null if not a recognised nutrient.
 */
export function canonicalNutrient(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  return NUTRIENT_ALIASES[key] ?? null;
}

/** Canonical key → display name used in micronutrient_signals and INSIGHT_NUTRIENTS */
export const NUTRIENT_DISPLAY_NAMES: Record<string, string> = {
  iron: "Iron",
  b12: "B12",
  magnesium: "Magnesium",
  zinc: "Zinc",
  "vitamin d": "Vitamin D",
  calcium: "Calcium",
  "omega-3": "Omega-3",
  "vitamin c": "Vitamin C",
  potassium: "Potassium",
  fiber: "Fiber",
};

/**
 * Single source of truth: supplement keyword → canonical nutrient key(s).
 * Used both for auto-logging meal signals and for RDA bar matching.
 */
export const SUPPLEMENT_KEYWORD_MAP: Array<{ keywords: string[]; nutrients: string[] }> = [
  { keywords: ["vitamin c", "vit c", "ascorbic", "emergen"],                           nutrients: ["vitamin c"] },
  { keywords: ["vitamin d", "vit d", "cholecalciferol", "vitamin d3"],                 nutrients: ["vitamin d"] },
  { keywords: ["b12", "vitamin b12", "cobalamin", "methylcobalamin", "cyanocobalamin"], nutrients: ["b12"] },
  { keywords: ["magnesium", "mag glycinate", "mag citrate", "mag oxide"],              nutrients: ["magnesium"] },
  { keywords: ["zinc"],                                                                 nutrients: ["zinc"] },
  { keywords: ["iron", "ferrous", "ferric"],                                            nutrients: ["iron"] },
  { keywords: ["calcium", "cal citrate", "cal carbonate"],                             nutrients: ["calcium"] },
  { keywords: ["fish oil", "omega-3", "omega 3", "omega3", "dha", "epa", "krill"],    nutrients: ["omega-3"] },
  { keywords: ["potassium"],                                                            nutrients: ["potassium"] },
  { keywords: ["fiber", "fibre", "psyllium", "metamucil", "inulin"],                   nutrients: ["fiber"] },
  {
    keywords: ["multivitamin", "multi vitamin", "multi-vitamin"],
    nutrients: ["vitamin c", "vitamin d", "b12", "iron", "zinc", "magnesium", "calcium"],
  },
];

/**
 * Returns display names (e.g. "Vitamin D", "B12") for any nutrients matched
 * by the given supplement text. Used when auto-logging daily supplements as meals.
 */
export function matchSupplementNutrients(text: string): string[] {
  const lower = text.toLowerCase();
  const matched = new Set<string>();
  for (const { keywords, nutrients } of SUPPLEMENT_KEYWORD_MAP) {
    if (keywords.some((k) => lower.includes(k))) {
      nutrients.forEach((n) => {
        const display = NUTRIENT_DISPLAY_NAMES[n];
        if (display) matched.add(display);
      });
    }
  }
  return Array.from(matched);
}

interface RdaTable {
  // age ranges are inclusive lower, exclusive upper: [min, max)
  // sex keys: "male" | "female" | "other"
  [sex: string]: Array<{
    ageMin: number;
    ageMax: number;
    values: RdaValues;
  }>;
}

// "other" / "prefer_not" will fall back to the average of male + female values
const RDA_TABLE: RdaTable = {
  male: [
    {
      ageMin: 0,
      ageMax: 19,
      values: {
        iron: 11,
        b12: 2.4,
        magnesium: 400,
        zinc: 11,
        "vitamin d": 600,
        calcium: 1300,
        "omega-3": 1100,
        "vitamin c": 75,
        potassium: 4700,
        fiber: 31,
      },
    },
    {
      ageMin: 19,
      ageMax: 51,
      values: {
        iron: 8,
        b12: 2.4,
        magnesium: 420,
        zinc: 11,
        "vitamin d": 600,
        calcium: 1000,
        "omega-3": 1600,
        "vitamin c": 90,
        potassium: 3400,
        fiber: 38,
      },
    },
    {
      ageMin: 51,
      ageMax: 999,
      values: {
        iron: 8,
        b12: 2.4,
        magnesium: 420,
        zinc: 11,
        "vitamin d": 800,
        calcium: 1200,
        "omega-3": 1600,
        "vitamin c": 90,
        potassium: 3400,
        fiber: 30,
      },
    },
  ],
  female: [
    {
      ageMin: 0,
      ageMax: 19,
      values: {
        iron: 15,
        b12: 2.4,
        magnesium: 360,
        zinc: 9,
        "vitamin d": 600,
        calcium: 1300,
        "omega-3": 1100,
        "vitamin c": 65,
        potassium: 4700,
        fiber: 26,
      },
    },
    {
      ageMin: 19,
      ageMax: 51,
      values: {
        iron: 18,
        b12: 2.4,
        magnesium: 320,
        zinc: 8,
        "vitamin d": 600,
        calcium: 1000,
        "omega-3": 1100,
        "vitamin c": 75,
        potassium: 2600,
        fiber: 25,
      },
    },
    {
      ageMin: 51,
      ageMax: 999,
      values: {
        iron: 8,
        b12: 2.4,
        magnesium: 320,
        zinc: 8,
        "vitamin d": 800,
        calcium: 1200,
        "omega-3": 1100,
        "vitamin c": 75,
        potassium: 2600,
        fiber: 21,
      },
    },
  ],
};

/**
 * Given a supplement name and optional unit, returns the canonical nutrient key
 * and the dose converted to the RDA unit (where needed).
 * Returns null if no match.
 */
export function supplementToNutrient(
  name: string,
  dose?: number,
  unit?: string
): { nutrient: string; doseInRdaUnit: number } | null {
  if (dose == null || dose <= 0) return null;

  // First try direct alias lookup (e.g. "vitamin c" → "vitamin c")
  let canonical = canonicalNutrient(name);

  // Fall back to keyword map for product names (e.g. "Emergen-C" → "vitamin c")
  if (!canonical) {
    const lower = name.toLowerCase();
    for (const { keywords, nutrients } of SUPPLEMENT_KEYWORD_MAP) {
      if (nutrients.length === 1 && keywords.some((k) => lower.includes(k))) {
        canonical = nutrients[0];
        break;
      }
    }
  }

  if (!canonical) return null;

  const rdaUnit = NUTRIENT_UNITS[canonical];
  if (!rdaUnit) return null;

  let converted = dose;
  const inputUnit = (unit ?? "").toLowerCase();
  if (canonical === "vitamin d" && rdaUnit === "IU") {
    if (inputUnit === "mcg") converted = dose * 40;
  } else if (canonical === "omega-3" && rdaUnit === "mg") {
    if (inputUnit === "g") converted = dose * 1000;
  }

  return { nutrient: canonical, doseInRdaUnit: converted };
}

/**
 * Returns the RDA map for a given sex and age.
 * Falls back to average of male+female for "other"/"prefer_not" or unknown.
 */
export function getRda(sex: RdaSex, age: number | null): RdaValues {
  const effectiveAge = age ?? 30;

  const lookup = (sexKey: "male" | "female"): RdaValues => {
    const rows = RDA_TABLE[sexKey];
    const row = rows.find((r) => effectiveAge >= r.ageMin && effectiveAge < r.ageMax);
    return row?.values ?? rows[rows.length - 1].values;
  };

  if (sex === "male") return lookup("male");
  if (sex === "female") return lookup("female");

  // "other" / "prefer_not": average male + female
  const m = lookup("male");
  const f = lookup("female");
  const result: RdaValues = {};
  for (const key of Object.keys(m)) {
    result[key] = (m[key] + f[key]) / 2;
  }
  return result;
}
