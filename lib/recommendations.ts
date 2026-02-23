import type { MealLog, UserProfile } from "./types";
import { summarizeDay } from "./summary";
import { todayKey } from "./utils";

const SWEET_HINTS = ["yogurt", "fruit", "berries", "granola", "pancake", "cereal", "smoothie", "ice", "dessert"];
const SAVORY_HINTS = ["chicken", "beef", "rice", "pasta", "salad", "bowl", "sandwich", "egg", "soup", "fish"];
const LIQUID_HINTS = ["smoothie", "shake", "latte", "milk", "juice", "broth"];
const SNACK_HINTS = ["nuts", "bar", "chips", "cracker", "cookie", "toast"];

function toKg(weight: number, units: UserProfile["units"]) {
  return units === "imperial" ? weight * 0.453592 : weight;
}

function estimateMaintenance(profile: UserProfile) {
  const weightKg = toKg(profile.weight, profile.units);
  const base = weightKg * 22;
  return base + 200;
}

function tagType(name: string) {
  const lower = name.toLowerCase();
  if (LIQUID_HINTS.some((hint) => lower.includes(hint))) return "liquid";
  if (SWEET_HINTS.some((hint) => lower.includes(hint))) return "sweet";
  if (SNACK_HINTS.some((hint) => lower.includes(hint))) return "snack";
  if (SAVORY_HINTS.some((hint) => lower.includes(hint))) return "savory";
  return "meal";
}

export function buildSuggestions(meals: MealLog[]) {
  const scores: Record<string, number> = {};
  meals.forEach((meal, index) => {
    const recencyBoost = Math.max(1, 8 - index) * 0.25;
    const items = meal.analysisJson.detected_items.map((item) => item.name);
    if (meal.userCorrection) items.unshift(meal.userCorrection);
    items.forEach((name) => {
      scores[name] = (scores[name] ?? 0) + 1 + recencyBoost;
    });
  });

  const ranked = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => ({ name, type: tagType(name) }));

  const suggestions: string[] = [];
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
  const goalShift = profile.goalDirection === "gain" ? 250 : profile.goalDirection === "lose" ? -250 : 0;
  const target = maintenance + goalShift;

  let fueling_state: "under" | "adequate" | "over" = "adequate";
  if (todayTotals.calories_max < target - 200) fueling_state = "under";
  if (todayTotals.calories_min > target + 300) fueling_state = "over";

  const proteinTarget = toKg(profile.weight, profile.units) * 0.8;
  let energy_support_state: "likely_low" | "mixed" | "likely_ok" = "mixed";
  if (todayTotals.protein_max < proteinTarget * 0.7) energy_support_state = "likely_low";
  if (todayTotals.protein_min > proteinTarget * 0.9) energy_support_state = "likely_ok";

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

export function buildNutrientNotes(meals: MealLog[]) {
  const signals = meals.flatMap((meal) => meal.analysisJson.micronutrient_signals);
  const low = signals.filter((signal) => signal.signal === "low_appearance");
  if (!low.length) return [];

  const top = low.slice(0, 2).map((signal) =>
    `Noticed fewer ${signal.nutrient.toLowerCase()}-rich foods. Consider a small add.`
  );
  return top;
}
