export type Units = "metric" | "imperial";

export type GoalDirection = "gain" | "maintain" | "balance" | "lose";

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
  units: Units;
}

export interface MealAnalysis {
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
}

export interface MealLog {
  id: string;
  ts: number;
  imageBlob?: Blob;
  imageThumb?: string;
  analysisJson: MealAnalysis;
  userCorrection?: string;
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
}

export interface DerivedDaily {
  date: string; // YYYY-MM-DD
  totalsRanges: DailyRange;
}
