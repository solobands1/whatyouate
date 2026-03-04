import { coerceAnalysis, LOW_CONFIDENCE_THRESHOLD, safeFallbackAnalysis } from "./ai/schema";
import { updateMeal } from "./supabaseDb";

type MealJob = {
  mealId: string;
  imageBase64: string;
};

const queue: MealJob[] = [];
let isProcessing = false;

function widenRangesIfLowConfidence(input: any) {
  if (input.confidence_overall_0_1 >= LOW_CONFIDENCE_THRESHOLD) return input;

  const ranges = input.estimated_ranges;

  const widen = (min: number, max: number, cap: number) => {
    const span = Math.max(10, max - min);
    return {
      min: Math.max(0, Math.round(min - Math.min(span * 0.2, cap))),
      max: Math.round(max + Math.min(span * 0.2, cap))
    };
  };

  const cals = widen(ranges.calories_min, ranges.calories_max, 120);
  const protein = widen(ranges.protein_g_min, ranges.protein_g_max, 8);
  const carbs = widen(ranges.carbs_g_min, ranges.carbs_g_max, 25);
  const fat = widen(ranges.fat_g_min, ranges.fat_g_max, 10);

  return {
    ...input,
    estimated_ranges: {
      calories_min: cals.min,
      calories_max: cals.max,
      protein_g_min: protein.min,
      protein_g_max: protein.max,
      carbs_g_min: carbs.min,
      carbs_g_max: carbs.max,
      fat_g_min: fat.min,
      fat_g_max: fat.max
    }
  };
}

async function processNext() {
  if (queue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;

  const job = queue.shift();
  if (!job) {
    isProcessing = false;
    return;
  }

  try {
    const response = await fetch("/api/analyze-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: job.imageBase64,
        mealId: job.mealId
      })
    });

    if (!response.ok) throw new Error("Analyze failed");

    const data = await response.json();
    const parsed = coerceAnalysis(data?.analysis);
    parsed.name = data.analysis?.name ?? parsed.name;

    const adjusted =
      parsed.estimated_ranges.calories_min === parsed.estimated_ranges.calories_max
        ? parsed
        : widenRangesIfLowConfidence(parsed);

    await updateMeal(job.mealId, adjusted);
    window.dispatchEvent(new Event("meals-updated"));
  } catch {
    await updateMeal(job.mealId, safeFallbackAnalysis());
    window.dispatchEvent(new Event("meals-updated"));
  }

  processNext();
}

export function enqueueMeal(mealId: string, imageBase64: string) {
  queue.push({ mealId, imageBase64 });

  if (!isProcessing) {
    processNext();
  }
}
