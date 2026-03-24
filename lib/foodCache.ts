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
  logCount?: number;
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

export function deleteFoodCacheEntry(barcode: string): void {
  if (typeof window === "undefined") return;
  try {
    const cache = loadCache();
    delete cache[barcode];
    localStorage.setItem(FOOD_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

export function setFoodCacheEntry(barcode: string, entry: FoodCacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    const cache = loadCache();
    // Preserve existing logCount so re-scanning doesn't reset frequency data
    const existingLogCount = cache[barcode]?.logCount;
    cache[barcode] = existingLogCount != null ? { ...entry, logCount: existingLogCount } : entry;
    localStorage.setItem(FOOD_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures (quota, private mode)
  }
}

export function incrementFoodCacheLogCount(barcode: string): void {
  if (typeof window === "undefined") return;
  try {
    const cache = loadCache();
    if (!cache[barcode]) return;
    cache[barcode] = { ...cache[barcode], logCount: (cache[barcode].logCount ?? 0) + 1 };
    localStorage.setItem(FOOD_CACHE_KEY, JSON.stringify(cache));
  } catch {}
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
  logCount?: number;
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
    // Preserve existing logCount so re-analyzing doesn't reset frequency data
    const existingLogCount = cache[normalizedText]?.logCount;
    cache[normalizedText] = existingLogCount != null ? { ...entry, logCount: existingLogCount } : entry;
    localStorage.setItem(FOOD_TEXT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures
  }
}

export function incrementFoodTextLogCount(normalizedText: string): void {
  if (typeof window === "undefined") return;
  try {
    const cache = loadTextCache();
    if (!cache[normalizedText]) return;
    cache[normalizedText] = { ...cache[normalizedText], logCount: (cache[normalizedText].logCount ?? 0) + 1 };
    localStorage.setItem(FOOD_TEXT_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

export function deleteFoodTextEntry(normalizedText: string): void {
  if (typeof window === "undefined") return;
  try {
    const cache = loadTextCache();
    delete cache[normalizedText];
    localStorage.setItem(FOOD_TEXT_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

// ── Daily supplements ────────────────────────────────────────────────────────
// Stores the user's fixed daily supplement list. Auto-logged once per day on
// first app load — silently, without any user action required.

function dailySuppKey(userId: string) {
  return `wya_daily_supps_${userId}`;
}

function dailySuppLoggedKey(userId: string) {
  const today = new Date().toISOString().split("T")[0];
  return `wya_daily_supps_logged_${userId}_${today}`;
}

export function getDailySupplements(userId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(dailySuppKey(userId)) ?? "[]");
  } catch {
    return [];
  }
}

export function setDailySupplements(userId: string, names: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(dailySuppKey(userId), JSON.stringify(names));
  } catch {}
}

export function hasDailySuppsLoggedToday(userId: string): boolean {
  if (typeof window === "undefined") return true;
  return !!localStorage.getItem(dailySuppLoggedKey(userId));
}

export function markDailySuppsLoggedToday(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(dailySuppLoggedKey(userId), "1");
  } catch {}
}

// ── Quick Add ────────────────────────────────────────────────────────────────
// Merges both caches into a deduplicated, sorted list for the Quick Add modal.

export type QuickAddItem = {
  key: string; // name.toLowerCase()
  name: string;
  type: "text" | "barcode";
  // text items
  ranges?: FoodTextCacheEntry["ranges"];
  micronutrient_signals?: FoodTextCacheEntry["micronutrient_signals"];
  // barcode items
  barcode?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  brand?: string;
  valuePer?: "serving" | "100g";
  savedAt: number;
  logCount: number;
};

export function getQuickAddItems(): QuickAddItem[] {
  const seen = new Map<string, QuickAddItem>();

  // Text cache entries
  const textCache = loadTextCache();
  for (const entry of Object.values(textCache)) {
    const key = entry.name.toLowerCase().trim();
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing || entry.savedAt > existing.savedAt) {
      seen.set(key, {
        key,
        name: entry.name,
        type: "text",
        ranges: entry.ranges,
        micronutrient_signals: entry.micronutrient_signals,
        savedAt: entry.savedAt,
        logCount: entry.logCount ?? 0,
      });
    }
  }

  // Barcode cache entries
  const barcodeCache = loadCache();
  for (const [barcode, entry] of Object.entries(barcodeCache)) {
    const key = entry.name.toLowerCase().trim();
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing || entry.savedAt > existing.savedAt) {
      seen.set(key, {
        key,
        name: entry.name,
        type: "barcode",
        barcode,
        calories: entry.calories,
        protein: entry.protein,
        carbs: entry.carbs,
        fat: entry.fat,
        brand: entry.brand,
        valuePer: entry.valuePer,
        savedAt: entry.savedAt,
        logCount: entry.logCount ?? 0,
      });
    }
  }

  // Sort by log frequency first, then by most recently saved as tiebreaker
  return Array.from(seen.values()).sort((a, b) => {
    const countDiff = b.logCount - a.logCount;
    if (countDiff !== 0) return countDiff;
    return b.savedAt - a.savedAt;
  });
}
