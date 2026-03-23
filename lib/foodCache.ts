export type FoodCacheEntry = {
  name: string;
  brand: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  valuePer: "serving" | "100g";
  source: "openfoodfacts" | "user_corrected";
  savedAt: number;
};

const FOOD_CACHE_KEY = "wya_food_cache_v1";

function loadCache(): Record<string, FoodCacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(FOOD_CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function getFoodCacheEntry(barcode: string): FoodCacheEntry | null {
  const cache = loadCache();
  return cache[barcode] ?? null;
}

export function setFoodCacheEntry(barcode: string, entry: FoodCacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    const cache = loadCache();
    cache[barcode] = entry;
    localStorage.setItem(FOOD_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures (quota, private mode)
  }
}

// ── Text / manual-entry food cache ─────────────────────────────────────────
// Keyed by normalized food text so typing the same food always returns the
// same macros instead of calling the AI fresh each time.

export type FoodTextCacheEntry = {
  name: string;
  ranges: {
    calories_min: number; calories_max: number;
    protein_g_min: number; protein_g_max: number;
    carbs_g_min: number; carbs_g_max: number;
    fat_g_min: number; fat_g_max: number;
  };
  micronutrient_signals: Array<{ nutrient: string; signal: string; notes?: string }>;
  source: "ai" | "user_corrected";
  savedAt: number;
};

const FOOD_TEXT_CACHE_KEY = "wya_food_text_cache_v1";

function loadTextCache(): Record<string, FoodTextCacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(FOOD_TEXT_CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function getFoodTextEntry(normalizedText: string): FoodTextCacheEntry | null {
  const cache = loadTextCache();
  return cache[normalizedText] ?? null;
}

export function setFoodTextEntry(normalizedText: string, entry: FoodTextCacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    const cache = loadTextCache();
    cache[normalizedText] = entry;
    localStorage.setItem(FOOD_TEXT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures
  }
}
