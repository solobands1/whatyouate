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
