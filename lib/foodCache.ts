import type { SupplementEntry } from "./types";

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
const BARCODE_CACHE_MAX_ENTRIES = 200;
const BARCODE_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function pruneBarcodeCacheIfNeeded(cache: Record<string, FoodCacheEntry>): Record<string, FoodCacheEntry> {
  const now = Date.now();
  // Remove entries older than TTL
  const entries = Object.entries(cache).filter(([, v]) => now - v.savedAt < BARCODE_CACHE_TTL_MS);
  // If still over max, keep the most recently saved
  if (entries.length > BARCODE_CACHE_MAX_ENTRIES) {
    entries.sort(([, a], [, b]) => b.savedAt - a.savedAt);
    entries.splice(BARCODE_CACHE_MAX_ENTRIES);
  }
  return Object.fromEntries(entries);
}

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
    let cache = loadCache();
    // Preserve existing logCount so re-scanning doesn't reset frequency data
    const existingLogCount = cache[barcode]?.logCount;
    cache[barcode] = existingLogCount != null ? { ...entry, logCount: existingLogCount } : entry;
    cache = pruneBarcodeCacheIfNeeded(cache);
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

/**
 * Normalize a food name into a stable cache key.
 * Strips parentheticals, size qualifiers, weight mentions, and articles
 * so "Apple", "Apple (medium)", "apple, medium" and "Fresh apple" all
 * resolve to the same key: "apple".
 */
export function normalizeFoodKey(text: string): string {
  let s = text.toLowerCase().trim();
  // Strip parenthetical qualifiers: "apple (medium, ~182g)" → "apple"
  s = s.replace(/\s*\([^)]*\)/g, "");
  // Strip leading articles/quantifiers: "an apple", "one banana"
  s = s.replace(/^(a|an|one|some|half)\s+/, "");
  // Strip qualifiers after a comma: "chicken breast, grilled" → "chicken breast"
  s = s.replace(/,\s*(small|medium|large|fresh|raw|whole|organic|sliced|diced|chopped|cooked|uncooked|baked|grilled|steamed|boiled|fried|roasted|plain|ripe|dried|frozen|canned|approximately|approx|about)(\s.*)?$/, "");
  // Strip trailing standalone size word: "apple medium" → "apple"
  s = s.replace(/\s+(small|medium|large)$/, "");
  // Strip weight/unit mentions: "100g", "~50g", "2 oz"
  s = s.replace(/\s*~?\d+(\.\d+)?\s*(g|oz|ml|lb|kg|tbsp|tsp|cups?|pieces?|slices?)(\b|$)/g, "");
  // Strip trailing punctuation left after removal
  s = s.replace(/[,.\-–]+\s*$/, "");
  // Collapse multiple spaces
  s = s.replace(/\s{2,}/g, " ");
  return s.trim();
}

/** One-time migration: re-key existing text cache entries using normalizeFoodKey.
 *  Merges duplicates by summing logCounts and keeping the most recent macros. */
export function migrateTextCacheKeys(): void {
  if (typeof window === "undefined") return;
  try {
    const cache = loadTextCache();
    const migrated: Record<string, FoodTextCacheEntry> = {};
    for (const [key, entry] of Object.entries(cache)) {
      const newKey = normalizeFoodKey(key);
      if (!newKey) continue;
      const existing = migrated[newKey];
      if (!existing) {
        migrated[newKey] = entry;
      } else {
        // Merge duplicates: sum logCounts, keep most recent macros
        const mergedLogCount = (existing.logCount ?? 0) + (entry.logCount ?? 0);
        if (entry.savedAt > existing.savedAt) {
          migrated[newKey] = { ...entry, logCount: mergedLogCount };
        } else {
          migrated[newKey] = { ...existing, logCount: mergedLogCount };
        }
      }
    }
    localStorage.setItem(FOOD_TEXT_CACHE_KEY, JSON.stringify(migrated));
  } catch {}
}

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
  detected_brand?: string | null;
  detected_product?: string | null;
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

const TEXT_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export function getFoodTextEntry(normalizedText: string): FoodTextCacheEntry | null {
  const cache = loadTextCache();
  const entry = cache[normalizedText];
  if (!entry) return null;
  if (Date.now() - entry.savedAt > TEXT_CACHE_TTL_MS) return null;
  return entry;
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

const FOOD_TEXT_DELETED_KEY = "wya_food_text_deleted_v1";

function loadDeletedKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(FOOD_TEXT_DELETED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function addDeletedKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const keys = loadDeletedKeys();
    keys.add(key);
    localStorage.setItem(FOOD_TEXT_DELETED_KEY, JSON.stringify([...keys]));
  } catch {}
}

export function deleteFoodTextEntry(normalizedText: string): void {
  if (typeof window === "undefined") return;
  try {
    const cache = loadTextCache();
    delete cache[normalizedText];
    localStorage.setItem(FOOD_TEXT_CACHE_KEY, JSON.stringify(cache));
    addDeletedKey(normalizedText);
  } catch {}
}

/** Rebuild the text cache from Supabase meal history when localStorage was cleared.
 *  Only runs if the cache is currently empty — never overwrites existing data. */
export function seedTextCacheFromMeals(meals: Array<{
  ts: number;
  status?: string;
  analysisJson: {
    name?: string;
    source?: string;
    estimated_ranges: FoodTextCacheEntry["ranges"];
    micronutrient_signals?: FoodTextCacheEntry["micronutrient_signals"];
  };
}>): void {
  if (typeof window === "undefined") return;
  const existing = loadTextCache();
  const deleted = loadDeletedKeys();
  // Only seed if cache is empty (ignoring deleted keys which are intentionally absent)
  const nonDeletedExisting = Object.keys(existing).filter((k) => !deleted.has(k));
  if (nonDeletedExisting.length > 0) return; // cache already populated

  const foodMap = new Map<string, { name: string; ranges: FoodTextCacheEntry["ranges"]; signals: FoodTextCacheEntry["micronutrient_signals"]; count: number; latestTs: number }>();
  for (const meal of meals) {
    if (meal.status === "processing" || meal.status === "failed") continue;
    if (meal.analysisJson?.source === "supplement") continue;
    const name = meal.analysisJson?.name;
    if (!name) continue;
    const key = normalizeFoodKey(name);
    if (!key) continue;
    if (deleted.has(key)) continue; // respect user deletion
    const entry = foodMap.get(key);
    if (entry) {
      entry.count++;
      if (meal.ts > entry.latestTs) { entry.latestTs = meal.ts; entry.ranges = meal.analysisJson.estimated_ranges; }
    } else {
      foodMap.set(key, { name, ranges: meal.analysisJson.estimated_ranges, signals: meal.analysisJson.micronutrient_signals ?? [], count: 1, latestTs: meal.ts });
    }
  }

  if (foodMap.size === 0) return;
  const rebuilt: Record<string, FoodTextCacheEntry> = {};
  for (const [key, data] of foodMap.entries()) {
    rebuilt[key] = { name: data.name, ranges: data.ranges, micronutrient_signals: data.signals, source: "ai", savedAt: data.latestTs, logCount: data.count };
  }
  try { localStorage.setItem(FOOD_TEXT_CACHE_KEY, JSON.stringify(rebuilt)); } catch {}
}

// ── Daily supplements ────────────────────────────────────────────────────────
// Stores the user's fixed daily supplement list. Auto-logged once per day on
// first app load — silently, without any user action required.

function dailySuppKey(userId: string) {
  return `wya_daily_supps_${userId}`;
}

function dailySuppLoggedKey(userId: string) {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `wya_daily_supps_logged_${userId}_${today}`;
}

export function getDailySupplements(userId: string): SupplementEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(dailySuppKey(userId)) ?? "[]");
  } catch {
    return [];
  }
}

export function setDailySupplements(userId: string, entries: SupplementEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(dailySuppKey(userId), JSON.stringify(entries));
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

export function clearDailySuppsLoggedToday(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(dailySuppLoggedKey(userId));
  } catch {}
}

export function clearAllFoodCaches(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(FOOD_CACHE_KEY);
    localStorage.removeItem(FOOD_TEXT_CACHE_KEY);
    localStorage.removeItem(FOOD_TEXT_DELETED_KEY);
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
  for (const [cacheKey, entry] of Object.entries(textCache)) {
    const key = normalizeFoodKey(entry.name) || cacheKey;
    if (!key) continue;
    const existing = seen.get(key);
    const combinedLogCount = (existing?.logCount ?? 0) + (entry.logCount ?? 0);
    if (!existing || entry.savedAt > existing.savedAt) {
      seen.set(key, {
        key,
        name: entry.name,
        type: "text",
        ranges: entry.ranges,
        micronutrient_signals: entry.micronutrient_signals,
        savedAt: entry.savedAt,
        logCount: combinedLogCount,
      });
    } else {
      seen.set(key, { ...existing, logCount: combinedLogCount });
    }
  }

  // Barcode cache entries
  const barcodeCache = loadCache();
  for (const [barcode, entry] of Object.entries(barcodeCache)) {
    const key = normalizeFoodKey(entry.name) || entry.name.toLowerCase().trim();
    if (!key) continue;
    const existing = seen.get(key);
    const combinedLogCount = (existing?.logCount ?? 0) + (entry.logCount ?? 0);
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
        logCount: combinedLogCount,
      });
    } else {
      seen.set(key, { ...existing, logCount: combinedLogCount });
    }
  }

  // Sort by log frequency first, then by most recently saved as tiebreaker; cap at 25
  return Array.from(seen.values()).sort((a, b) => {
    const countDiff = b.logCount - a.logCount;
    if (countDiff !== 0) return countDiff;
    return b.savedAt - a.savedAt;
  }).slice(0, 25);
}
