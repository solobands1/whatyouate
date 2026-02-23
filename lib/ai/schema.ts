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

function applyNameOverrides(items: Array<{ name: string; confidence_0_1: number; notes?: string }>) {
  if (!items.length) return items;
  const combined = items
    .map((item) => `${item.name} ${item.notes ?? ""}`.trim())
    .join(" ")
    .toLowerCase();

  let overrideName: string | null = null;
  if (combined.includes("poutine") || (combined.includes("fries") && combined.includes("gravy"))) {
    overrideName = "Poutine";
  }
  if (combined.includes("fries") && (combined.includes("curd") || combined.includes("cheese curds"))) {
    overrideName = "Poutine";
  }
  if (combined.includes("cheesesteak") || (combined.includes("philly") && combined.includes("steak"))) {
    overrideName = "Philly cheesesteak";
  }
  if (
    (combined.includes("ramen") || combined.includes("noodle bowl")) &&
    (combined.includes("broth") || combined.includes("noodle"))
  ) {
    overrideName = "Ramen bowl";
  }
  if ((combined.includes("poke") && combined.includes("bowl")) || combined.includes("poke bowl")) {
    overrideName = "Poke bowl";
  }
  if (
    (combined.includes("burrito") && combined.includes("bowl")) ||
    (combined.includes("rice bowl") && combined.includes("beans"))
  ) {
    overrideName = "Burrito bowl";
  }
  if (combined.includes("taco") && combined.includes("plate")) {
    overrideName = "Taco plate";
  }
  if ((combined.includes("shawarma") || combined.includes("gyro")) && combined.includes("wrap")) {
    overrideName = "Shawarma wrap";
  }
  if (combined.includes("fried chicken") || (combined.includes("chicken") && combined.includes("wings"))) {
    overrideName = "Chicken wings";
  }
  if (combined.includes("sushi") && combined.includes("roll")) {
    overrideName = "Sushi roll";
  }
  if (combined.includes("salad") && combined.includes("chicken")) {
    overrideName = "Chicken salad";
  }
  if (combined.includes("salad") && combined.includes("cobb")) {
    overrideName = "Cobb salad";
  }
  if (combined.includes("salad") && combined.includes("greek")) {
    overrideName = "Greek salad";
  }
  if (combined.includes("salad") && combined.includes("caesar")) {
    overrideName = "Caesar salad";
  }
  if (combined.includes("salad") && combined.includes("tuna")) {
    overrideName = "Tuna salad";
  }
  if (combined.includes("salad") && combined.includes("poke")) {
    overrideName = "Poke salad";
  }
  if (combined.includes("bibimbap")) {
    overrideName = "Bibimbap";
  }
  if (combined.includes("pad thai")) {
    overrideName = "Pad thai";
  }
  if (combined.includes("stir fry") || combined.includes("stir-fry")) {
    overrideName = "Stir-fry";
  }
  if (combined.includes("fried rice")) {
    overrideName = "Fried rice";
  }
  if (combined.includes("rice") && combined.includes("chicken") && combined.includes("beans")) {
    overrideName = "Chicken rice bowl";
  }
  if (combined.includes("teriyaki") && combined.includes("bowl")) {
    overrideName = "Teriyaki bowl";
  }
  if (combined.includes("bento")) {
    overrideName = "Bento box";
  }
  if (combined.includes("pho")) {
    overrideName = "Pho";
  }
  if (combined.includes("curry") && combined.includes("rice")) {
    overrideName = "Curry with rice";
  }
  if (combined.includes("tikka") && combined.includes("masala")) {
    overrideName = "Chicken tikka masala";
  }
  if (combined.includes("butter") && combined.includes("chicken")) {
    overrideName = "Butter chicken";
  }
  if (combined.includes("naan") && combined.includes("curry")) {
    overrideName = "Curry with naan";
  }
  if (combined.includes("sushi") && combined.includes("combo")) {
    overrideName = "Sushi combo";
  }
  if (combined.includes("sashimi")) {
    overrideName = "Sashimi";
  }
  if (combined.includes("poke") && combined.includes("salmon")) {
    overrideName = "Salmon poke bowl";
  }
  if (combined.includes("poke") && combined.includes("tuna")) {
    overrideName = "Tuna poke bowl";
  }
  if (combined.includes("ramen") && combined.includes("tonkotsu")) {
    overrideName = "Tonkotsu ramen";
  }
  if (combined.includes("ramen") && combined.includes("shoyu")) {
    overrideName = "Shoyu ramen";
  }
  if (combined.includes("ramen") && combined.includes("miso")) {
    overrideName = "Miso ramen";
  }
  if (combined.includes("noodle") && combined.includes("stir fry")) {
    overrideName = "Stir-fry noodles";
  }
  if (combined.includes("spaghetti") && combined.includes("meatballs")) {
    overrideName = "Spaghetti and meatballs";
  }
  if (combined.includes("lasagna")) {
    overrideName = "Lasagna";
  }
  if (combined.includes("pizza") && combined.includes("pepperoni")) {
    overrideName = "Pepperoni pizza";
  }
  if (combined.includes("pizza") && combined.includes("cheese")) {
    overrideName = "Cheese pizza";
  }
  if (combined.includes("pizza") && combined.includes("veggie")) {
    overrideName = "Veggie pizza";
  }
  if (combined.includes("taco") && combined.includes("bowl")) {
    overrideName = "Taco bowl";
  }
  if (combined.includes("quesadilla")) {
    overrideName = "Quesadilla";
  }
  if (combined.includes("nacho")) {
    overrideName = "Nachos";
  }
  if (combined.includes("burrito")) {
    overrideName = "Burrito";
  }
  if (combined.includes("taco")) {
    overrideName = "Tacos";
  }
  if (combined.includes("wrap") && combined.includes("chicken")) {
    overrideName = "Chicken wrap";
  }
  if (combined.includes("wrap") && combined.includes("veggie")) {
    overrideName = "Veggie wrap";
  }
  if (combined.includes("sandwich") && combined.includes("grilled cheese")) {
    overrideName = "Grilled cheese";
  }
  if (combined.includes("sandwich") && combined.includes("club")) {
    overrideName = "Club sandwich";
  }
  if (combined.includes("sandwich") && combined.includes("tuna")) {
    overrideName = "Tuna sandwich";
  }
  if (combined.includes("panini")) {
    overrideName = "Panini";
  }
  if (combined.includes("bagel") && combined.includes("cream cheese")) {
    overrideName = "Bagel with cream cheese";
  }
  if (combined.includes("avocado") && combined.includes("toast")) {
    overrideName = "Avocado toast";
  }
  if (combined.includes("oatmeal")) {
    overrideName = "Oatmeal";
  }
  if (combined.includes("pancake") || combined.includes("pancakes")) {
    overrideName = "Pancakes";
  }
  if (combined.includes("waffle") || combined.includes("waffles")) {
    overrideName = "Waffles";
  }
  if (combined.includes("omelet") || combined.includes("omelette")) {
    overrideName = "Omelet";
  }
  if (combined.includes("scrambled") && combined.includes("egg")) {
    overrideName = "Scrambled eggs";
  }
  if (combined.includes("breakfast") && combined.includes("burrito")) {
    overrideName = "Breakfast burrito";
  }
  if (combined.includes("breakfast") && combined.includes("sandwich")) {
    overrideName = "Breakfast sandwich";
  }
  if (combined.includes("smoothie")) {
    overrideName = "Smoothie";
  }
  if (combined.includes("protein") && combined.includes("shake")) {
    overrideName = "Protein shake";
  }
  if (combined.includes("yogurt") && combined.includes("parfait")) {
    overrideName = "Yogurt parfait";
  }
  if (combined.includes("granola") && combined.includes("yogurt")) {
    overrideName = "Yogurt with granola";
  }
  if (combined.includes("fruit") && combined.includes("salad")) {
    overrideName = "Fruit salad";
  }
  if (combined.includes("soup") && combined.includes("chicken")) {
    overrideName = "Chicken soup";
  }
  if (combined.includes("soup") && combined.includes("tomato")) {
    overrideName = "Tomato soup";
  }
  if (combined.includes("soup") && combined.includes("noodle")) {
    overrideName = "Noodle soup";
  }
  if (combined.includes("chili")) {
    overrideName = "Chili";
  }
  if (combined.includes("burger") && combined.includes("cheese")) {
    overrideName = "Cheeseburger";
  }
  if (combined.includes("burger") && combined.includes("chicken")) {
    overrideName = "Chicken burger";
  }
  if (combined.includes("burger") && combined.includes("veggie")) {
    overrideName = "Veggie burger";
  }
  if (combined.includes("hot dog")) {
    overrideName = "Hot dog";
  }
  if (combined.includes("fries") && combined.includes("sweet potato")) {
    overrideName = "Sweet potato fries";
  }
  if (combined.includes("fish") && combined.includes("chips")) {
    overrideName = "Fish and chips";
  }
  if (combined.includes("steak") && combined.includes("potato")) {
    overrideName = "Steak with potatoes";
  }
  if (combined.includes("salmon") && combined.includes("rice")) {
    overrideName = "Salmon with rice";
  }
  if (combined.includes("salmon") && combined.includes("salad")) {
    overrideName = "Salmon salad";
  }
  if (combined.includes("sushi") && combined.includes("bowl")) {
    overrideName = "Sushi bowl";
  }
  if (combined.includes("rice") && combined.includes("beans")) {
    overrideName = "Rice and beans";
  }
  if (combined.includes("falafel")) {
    overrideName = "Falafel";
  }
  if (combined.includes("hummus") && combined.includes("pita")) {
    overrideName = "Hummus with pita";
  }
  if (combined.includes("shawarma") && combined.includes("plate")) {
    overrideName = "Shawarma plate";
  }
  if (combined.includes("gyro") && combined.includes("plate")) {
    overrideName = "Gyro plate";
  }
  if (combined.includes("cereal")) {
    overrideName = "Cereal";
  }
  if (combined.includes("granola") && combined.includes("bowl")) {
    overrideName = "Granola bowl";
  }
  if (combined.includes("ice cream")) {
    overrideName = "Ice cream";
  }
  if (combined.includes("cookie") || combined.includes("cookies")) {
    overrideName = "Cookies";
  }

  if (overrideName) {
    const next = [...items];
    next[0] = { ...next[0], name: overrideName };
    return next;
  }
  return items;
}

function normalizeDetectedItems(
  items: Array<{ name: string; confidence_0_1: number; notes?: string }>
) {
  if (!items.length) return items;
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
    let detected_items = Array.isArray(input.detected_items)
      ? normalizeDetectedItems(
          input.detected_items.map((item: any) => ({
            name: String(item?.name ?? "Meal"),
            confidence_0_1: clampNumber(Number(item?.confidence_0_1 ?? 0.3), 0, 1),
            notes: item?.notes ? String(item.notes) : undefined
          }))
        )
      : [{ name: "Meal", confidence_0_1: 0.3 }];
    if (!detected_items.length) {
      detected_items = [{ name: "Meal", confidence_0_1: 0.3 }];
    }

    const ranges = input.estimated_ranges ?? {};
    const estimated_ranges = {
      calories_min: clampNumber(Number(ranges.calories_min ?? 350), 0, 5000),
      calories_max: clampNumber(Number(ranges.calories_max ?? 700), 0, 6000),
      protein_g_min: clampNumber(Number(ranges.protein_g_min ?? 10), 0, 300),
      protein_g_max: clampNumber(Number(ranges.protein_g_max ?? 30), 0, 350),
      carbs_g_min: clampNumber(Number(ranges.carbs_g_min ?? 30), 0, 500),
      carbs_g_max: clampNumber(Number(ranges.carbs_g_max ?? 80), 0, 600),
      fat_g_min: clampNumber(Number(ranges.fat_g_min ?? 10), 0, 200),
      fat_g_max: clampNumber(Number(ranges.fat_g_max ?? 30), 0, 250)
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
      Boolean(detected_brand) || confidence_overall_0_1 < 0.65 || calorieSpreadPct > 0.3;

    const optional_quick_confirm_options = Array.isArray(input.optional_quick_confirm_options)
      ? input.optional_quick_confirm_options.map((option: any) => String(option)).slice(0, 4)
      : undefined;

    return {
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
