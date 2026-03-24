import type { MealAnalysis } from "../types";
import { clampNumber } from "../utils";

export const LOW_CONFIDENCE_THRESHOLD = 0.55;
const GENERIC_ITEM_NAMES = new Set([
  "meal",
  "food",
  "dish",
  "plate",
  "bowl",
  "snack",
  "lunch",
  "dinner",
  "breakfast"
]);

function normalizeItemName(value: string) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.]+$/g, "");
  return cleaned || "Meal";
}

function scoreDetectedItem(name: string, confidence: number) {
  const lower = name.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const isGeneric = GENERIC_ITEM_NAMES.has(lower);
  let score = confidence;
  if (words.length > 1) score += 0.15;
  if (name.length >= 8) score += 0.05;
  if (isGeneric) score -= 0.25;
  return score;
}

function applyNameOverrides(items: Array<{ name: string; confidence_0_1: number; notes?: string }>): { items: typeof items; overrideName: string | null } {
  // Claude Sonnet 4.6 names dishes accurately — trust its output directly.
  return { items, overrideName: null };
}

function normalizeDetectedItems(
  items: Array<{ name: string; confidence_0_1: number; notes?: string }>
): { items: Array<{ name: string; confidence_0_1: number; notes?: string }>; overrideName: string | null } {
  if (!items.length) return { items, overrideName: null };
  const cleaned = items.map((item) => ({
    ...item,
    name: normalizeItemName(item.name)
  }));
  const ordered = [...cleaned].sort(
    (a, b) => scoreDetectedItem(b.name, b.confidence_0_1) - scoreDetectedItem(a.name, a.confidence_0_1)
  );
  return applyNameOverrides(ordered);
}

export function safeFallbackAnalysis(): MealAnalysis {
  return {
    detected_items: [
      { name: "Meal", confidence_0_1: 0.25, notes: "Photo not analyzed yet." }
    ],
    estimated_ranges: {
      calories_min: 350,
      calories_max: 700,
      protein_g_min: 10,
      protein_g_max: 30,
      carbs_g_min: 30,
      carbs_g_max: 80,
      fat_g_min: 10,
      fat_g_max: 30
    },
    micronutrient_signals: [
      {
        nutrient: "General variety",
        signal: "uncertain",
        rationale_short: "Limited visual signal from the photo."
      }
    ],
    confidence_overall_0_1: 0.25,
    detected_brand: null,
    detected_product: null,
    database_match_confidence_0_1: null,
    precision_mode_available: true,
    optional_quick_confirm_options: ["Mixed plate", "Sandwich", "Bowl", "Other"]
  };
}

export function coerceAnalysis(input: any): MealAnalysis {
  if (!input || typeof input !== "object") return safeFallbackAnalysis();
  try {
    const rawItems = Array.isArray(input.detected_items)
      ? input.detected_items.map((item: any) => ({
          name: String(item?.name ?? "Meal"),
          confidence_0_1: clampNumber(Number(item?.confidence_0_1 ?? 0.3), 0, 1),
          notes: item?.notes ? String(item.notes) : undefined
        }))
      : [];
    const { items: normalizedItems, overrideName } = normalizeDetectedItems(rawItems);
    let detected_items = normalizedItems.length ? normalizedItems : [{ name: "Meal", confidence_0_1: 0.3 }];

    const ranges = input.estimated_ranges ?? {};
    const calMin = clampNumber(Number(ranges.calories_min ?? 350), 0, 5000);
    const calMax = clampNumber(Number(ranges.calories_max ?? 700), 0, 6000);
    const protMin = clampNumber(Number(ranges.protein_g_min ?? 10), 0, 300);
    const protMax = clampNumber(Number(ranges.protein_g_max ?? 30), 0, 350);
    const carbMin = clampNumber(Number(ranges.carbs_g_min ?? 30), 0, 500);
    const carbMax = clampNumber(Number(ranges.carbs_g_max ?? 80), 0, 600);
    const fatMin = clampNumber(Number(ranges.fat_g_min ?? 10), 0, 200);
    const fatMax = clampNumber(Number(ranges.fat_g_max ?? 30), 0, 250);
    const estimated_ranges = {
      calories_min: Math.min(calMin, calMax),
      calories_max: Math.max(calMin, calMax),
      protein_g_min: Math.min(protMin, protMax),
      protein_g_max: Math.max(protMin, protMax),
      carbs_g_min: Math.min(carbMin, carbMax),
      carbs_g_max: Math.max(carbMin, carbMax),
      fat_g_min: Math.min(fatMin, fatMax),
      fat_g_max: Math.max(fatMin, fatMax)
    };

    const micronutrient_signals = Array.isArray(input.micronutrient_signals)
      ? input.micronutrient_signals.slice(0, 4).map((signal: any) => ({
          nutrient: String(signal?.nutrient ?? "General"),
          signal: ["low_appearance", "adequate_appearance", "uncertain"].includes(signal?.signal)
            ? signal.signal
            : "uncertain",
          rationale_short: String(signal?.rationale_short ?? "Signal unclear")
        }))
      : [];

    const confidence_overall_0_1 = clampNumber(Number(input.confidence_overall_0_1 ?? 0.4), 0, 1);
    const detected_brand = input?.detected_brand;
    const detected_product = input?.detected_product;
    const database_match_confidence_0_1 =
      input?.database_match_confidence_0_1 == null ? null : clampNumber(Number(input.database_match_confidence_0_1), 0, 1);
    const calorieSpread = estimated_ranges.calories_max - estimated_ranges.calories_min;
    const calorieSpreadPct =
      estimated_ranges.calories_max > 0 ? calorieSpread / estimated_ranges.calories_max : 0;
    const precision_mode_available =
      (Boolean(detected_brand) && (database_match_confidence_0_1 == null || database_match_confidence_0_1 < 0.7)) ||
      confidence_overall_0_1 < 0.65 ||
      calorieSpreadPct > 0.3;

    const optional_quick_confirm_options = Array.isArray(input.optional_quick_confirm_options)
      ? input.optional_quick_confirm_options.map((option: any) => String(option)).slice(0, 4)
      : undefined;

    const displayName = overrideName ?? (input.name ? String(input.name) : undefined);
    return {
      ...(displayName ? { name: displayName } : {}),
      detected_items,
      estimated_ranges,
      micronutrient_signals,
      confidence_overall_0_1,
      detected_brand: detected_brand == null ? null : String(detected_brand),
      detected_product: detected_product == null ? null : String(detected_product),
      database_match_confidence_0_1,
      precision_mode_available,
      optional_quick_confirm_options
    };
  } catch {
    return safeFallbackAnalysis();
  }
}
