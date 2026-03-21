import type { MealLog, UserProfile } from "./types";
import { summarizeDay } from "./summary";
import { dayKeyFromTs, todayKey } from "./utils";
import { estimateMaintenance } from "./digestEngine";

const SWEET_HINTS = ["yogurt", "fruit", "berries", "granola", "pancake", "cereal", "smoothie", "ice", "dessert"];
const SAVORY_HINTS = ["chicken", "beef", "rice", "pasta", "salad", "bowl", "sandwich", "egg", "soup", "fish"];
const LIQUID_HINTS = ["smoothie", "shake", "latte", "milk", "juice", "broth"];
const SNACK_HINTS = ["nuts", "bar", "chips", "cracker", "cookie", "toast"];

const PROTEIN_POOL = [
  "Greek yogurt", "Eggs", "Chicken breast", "Cottage cheese", "Tuna",
  "Edamame", "Turkey", "Salmon", "Tofu", "Lentils", "Hard-boiled eggs", "Sardines",
];
const CALORIE_POOL = [
  "Avocado", "Nut butter", "Granola", "Mixed nuts", "Cheese",
  "Banana", "Brown rice", "Oats", "Whole milk", "Peanut butter toast",
];

export type SuggestionSignal = "protein" | "calorie" | "balanced";

function toKg(weight: number, units: UserProfile["units"]) {
  return units === "imperial" ? weight * 0.453592 : weight;
}


function tagType(name: string) {
  const lower = name.toLowerCase();
  if (LIQUID_HINTS.some((hint) => lower.includes(hint))) return "liquid";
  if (SWEET_HINTS.some((hint) => lower.includes(hint))) return "sweet";
  if (SNACK_HINTS.some((hint) => lower.includes(hint))) return "snack";
  if (SAVORY_HINTS.some((hint) => lower.includes(hint))) return "savory";
  return "meal";
}

export function buildSuggestions(meals: MealLog[], profile?: UserProfile, signal: SuggestionSignal = "balanced") {
  const restrictions = (profile?.dietaryRestrictions ?? []).map((r) => r.toLowerCase());
  const isRestricted = (name: string) => {
    if (!restrictions.length) return false;
    const lower = name.toLowerCase();
    return restrictions.some((r) => lower.includes(r) || r.includes(lower.split(" ")[0]));
  };

  // Frequency-ranked history • keyed by lowercase for case-insensitive dedup
  const scores: Record<string, number> = {};
  const displayNames: Record<string, string> = {}; // lowercase key → most-recent display name
  meals.forEach((meal, index) => {
    const recencyBoost = Math.max(1, 8 - index) * 0.25;
    const items = (meal.analysisJson.detected_items ?? []).map((item) => item.name);
    if (meal.userCorrection) items.unshift(meal.userCorrection);
    items.forEach((name) => {
      const key = name.toLowerCase();
      scores[key] = (scores[key] ?? 0) + 1 + recencyBoost;
      if (!displayNames[key]) displayNames[key] = name; // first seen = most recent (meals[0] is newest)
    });
  });

  const todayNames = new Set(
    meals
      .filter((meal) => dayKeyFromTs(meal.ts) === todayKey())
      .flatMap((meal) => {
        const items = (meal.analysisJson.detected_items ?? []).map((item) => item.name.toLowerCase());
        if (meal.userCorrection) items.unshift(meal.userCorrection.toLowerCase());
        return items;
      })
  );

  const historyRanked = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => displayNames[key])
    .filter((name) => !isRestricted(name) && !todayNames.has(name.toLowerCase()));

  const lowerHistory = new Set(historyRanked.map((n) => n.toLowerCase()));

  // Curated pool based on signal (exclude restricted and already in history)
  const curatedPool = signal === "protein" ? PROTEIN_POOL
    : signal === "calorie" ? CALORIE_POOL
    : [];
  const curated = curatedPool.filter(
    (name) => !isRestricted(name) && !lowerHistory.has(name.toLowerCase())
  );

  const suggestions: string[] = [];

  if (signal !== "balanced" && curated.length > 0) {
    // 2–3 curated new foods, rest from history
    suggestions.push(...curated.slice(0, 3));
    suggestions.push(...historyRanked.slice(0, 5 - suggestions.length));
  } else {
    // Balanced: type-bucketed history picks (original behavior)
    const ranked = historyRanked.map((name) => ({ name, type: tagType(name) }));
    const typeBuckets: Record<string, string[]> = {};
    ranked.forEach((item) => {
      if (!typeBuckets[item.type]) typeBuckets[item.type] = [];
      if (!typeBuckets[item.type].includes(item.name)) typeBuckets[item.type].push(item.name);
    });
    const pickOrder = ["meal", "savory", "snack", "sweet", "liquid"];
    for (const type of pickOrder) {
      const list = typeBuckets[type] ?? [];
      for (const name of list) {
        if (suggestions.length >= 5) break;
        if (!suggestions.includes(name)) suggestions.push(name);
      }
      if (suggestions.length >= 5) break;
    }
  }

  return suggestions.slice(0, 5);
}

export function generateRecommendations(profile: UserProfile | undefined, meals: MealLog[]) {
  if (meals.length === 0) {
    return {
      fueling_state: "adequate" as const,
      energy_support_state: "mixed" as const,
      notes: ["Nothing logged yet."]
    };
  }

  if (!profile || !profile.weight) {
    return {
      fueling_state: "adequate" as const,
      energy_support_state: "mixed" as const,
      notes: ["No profile yet."]
    };
  }

  const todayTotals = summarizeDay(meals, todayKey());
  const maintenance = estimateMaintenance(profile);
  if (!maintenance) {
    return {
      fueling_state: "adequate" as const,
      energy_support_state: "mixed" as const,
      notes: ["Complete your profile for personalised estimates."]
    };
  }
  const goalShift = profile.goalDirection === "gain" ? 250 : profile.goalDirection === "lose" ? -250 : 0;
  const target = maintenance + goalShift;

  let fueling_state: "under" | "adequate" | "over" = "adequate";
  if (todayTotals.calories_max < target - 200) fueling_state = "under";
  if (todayTotals.calories_min > target + 300) fueling_state = "over";

  const proteinTarget = toKg(profile.weight, profile.units) * 0.8;
  let energy_support_state: "likely_low" | "mixed" | "likely_ok" = "mixed";
  if (todayTotals.protein_g_max < proteinTarget * 0.7) energy_support_state = "likely_low";
  if (todayTotals.protein_g_min > proteinTarget * 0.9) energy_support_state = "likely_ok";

  const notes: string[] = [];
  if (fueling_state === "under") {
    notes.push("Intake appears lighter today.");
  } else if (fueling_state === "over") {
    notes.push("Intake appears fuller today.");
  } else {
    notes.push("Intake appears steady today.");
  }

  if (energy_support_state === "likely_low") {
    notes.push("Energy support may be lower on training days.");
  } else if (energy_support_state === "likely_ok") {
    notes.push("Protein appears steady today.");
  }

  return { fueling_state, energy_support_state, notes };
}

const NUTRIENT_EXAMPLES: Record<string, string> = {
  fibre: "an apple, pear, or handful of oats",
  fiber: "an apple, pear, or handful of oats",
  iron: "some spinach, lentils, or a small steak",
  calcium: "yogurt, a glass of milk, or some cheese",
  vitamin_c: "an orange, some berries, or bell pepper",
  "vitamin c": "an orange, some berries, or bell pepper",
  vitamin_d: "salmon, eggs, or fortified milk",
  "vitamin d": "salmon, eggs, or fortified milk",
  omega_3: "salmon, walnuts, or chia seeds",
  "omega-3": "salmon, walnuts, or chia seeds",
  magnesium: "dark chocolate, almonds, or leafy greens",
  zinc: "pumpkin seeds, beef, or chickpeas",
  potassium: "a banana, sweet potato, or avocado",
  folate: "lentils, spinach, or edamame",
  b12: "eggs, dairy, or fortified cereal",
  "vitamin b12": "eggs, dairy, or fortified cereal",
};

export function buildNutrientNotes(meals: MealLog[]) {
  if (meals.length < 5) return [];
  const signals = meals.flatMap((meal) => meal.analysisJson.micronutrient_signals ?? []);
  const low = signals.filter((signal) => signal?.signal === "low_appearance");
  if (!low.length) return [];

  const top = low.slice(0, 2).map((signal) => {
    const key = signal.nutrient.toLowerCase().replace(/\s+/g, "_");
    const altKey = signal.nutrient.toLowerCase();
    const examples = NUTRIENT_EXAMPLES[key] ?? NUTRIENT_EXAMPLES[altKey];
    if (examples) {
      return `Low on ${signal.nutrient.toLowerCase()} lately • try adding ${examples}.`;
    }
    return `Low on ${signal.nutrient.toLowerCase()} lately • try adding a small source today.`;
  });
  return top;
}
