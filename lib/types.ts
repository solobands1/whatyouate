export type Units = "metric" | "imperial";

/** A nutrient entry within a multi-supplement */
export type SupplementNutrient = { nutrient: string; dose: number; unit: string };

/** A supplement entry. `name` is always present; dose + unit are optional.
 *  Multi-supplements store their contents in `nutrients[]`.
 *  Legacy rows stored as plain strings are migrated on read. */
export type SupplementEntry = string | { name: string; dose?: number; unit?: string; nutrients?: SupplementNutrient[] };

/** Extract the name string from a SupplementEntry. */
export function suppName(entry: SupplementEntry): string {
  return typeof entry === "string" ? entry : entry.name;
}

/** Formatted label: "Vitamin D 2000 IU", "Younited (multi)", or just "Vitamin D". */
export function suppLabel(entry: SupplementEntry): string {
  if (typeof entry === "string") return entry;
  if (entry.nutrients?.length) return `${entry.name} (${entry.nutrients.length} nutrients)`;
  if (entry.dose != null && entry.unit) return `${entry.name} ${entry.dose} ${entry.unit}`;
  if (entry.dose != null) return `${entry.name} ${entry.dose}`;
  return entry.name;
}

export type GoalDirection = "gain" | "maintain" | "balance" | "lose";

export type ActivityLevel = "sedentary" | "lightly_active" | "moderately_active" | "very_active";

export interface UserProfile {
  id: string;
  firstName?: string;
  lastName?: string;
  height: number | null;
  weight: number | null;
  age: number | null;
  sex: "female" | "male" | "other" | "prefer_not";
  goalDirection: GoalDirection;
  bodyPriority?: string;
  freeformFocus?: string;
  activityLevel?: ActivityLevel;
  dietaryRestrictions?: string[];
  units: Units;
  dailySupplements?: SupplementEntry[];
  streak?: number;
  streakLastDate?: string; // YYYY-MM-DD
}

export interface MicronutrientAmount {
  nutrient: string;
  amount_min: number;
  amount_max: number;
  unit: string;
}

export interface MealAnalysis {
  name?: string;
  detected_items: Array<{
    name: string;
    confidence_0_1: number;
    notes?: string;
  }>;
  estimated_ranges: {
    calories_min: number;
    calories_max: number;
    protein_g_min: number;
    protein_g_max: number;
    carbs_g_min: number;
    carbs_g_max: number;
    fat_g_min: number;
    fat_g_max: number;
  };
  micronutrient_amounts?: MicronutrientAmount[];
  micronutrient_signals: Array<{
    nutrient: string;
    signal: "low_appearance" | "adequate_appearance" | "uncertain";
    rationale_short: string;
  }>;
  confidence_overall_0_1: number;
  detected_brand?: string | null;
  detected_product?: string | null;
  database_match_confidence_0_1?: number | null;
  precision_mode_available: boolean;
  optional_quick_confirm_options?: string[];
  source?: "supplement";
}

export interface MealLog {
  id: string;
  ts: number;
  imageBlob?: Blob;
  imageThumb?: string;
  analysisJson: MealAnalysis;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  userCorrection?: string;
  status?: "processing" | "done" | "failed";
}

export interface WorkoutSession {
  id: string;
  startTs: number;
  startImageBlob?: Blob;
  endTs?: number;
  endImageBlob?: Blob;
  durationMin?: number;
  workoutTypes?: string[];
  intensity?: "low" | "medium" | "high";
}

export interface DailyRange {
  calories_min: number;
  calories_max: number;
  protein_g_min: number;
  protein_g_max: number;
  carbs_g_min: number;
  carbs_g_max: number;
  fat_g_min: number;
  fat_g_max: number;
}

export interface DerivedDaily {
  date: string; // YYYY-MM-DD
  totalsRanges: DailyRange;
}
