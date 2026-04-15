
import { notifyMealsUpdated } from "./dataEvents";
import { clearMealsCache, markMealFailed } from "./supabaseDb";
import { setFoodTextEntry, incrementFoodTextLogCount, normalizeFoodKey } from "./foodCache";

type MealJob = {
  mealId: string;
  imageBase64: string;
  userId?: string;
};

const queue: MealJob[] = [];
let isProcessing = false;

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
    const clientController = new AbortController();
    const clientTimeout = setTimeout(() => clientController.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch("/api/analyze-food", {
        method: "POST",
        signal: clientController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: job.imageBase64,
          mealId: job.mealId,
          userId: job.userId
        })
      });
    } finally {
      clearTimeout(clientTimeout);
    }

    if (response.status === 429) {
      window.dispatchEvent(new CustomEvent("meal-analysis-error", { detail: { mealId: job.mealId, rateLimited: true } }));
      notifyMealsUpdated();
      processNext();
      return;
    }

    if (!response.ok) throw new Error("Analyze failed");

    const data = await response.json();

    // Write photo analysis result to text cache so manual entry and quick add
    // for the same food name return the same macros as the photo analysis did.
    const analysis = data?.analysis;
    if (analysis?.name && analysis?.estimated_ranges) {
      const normalizedName = normalizeFoodKey(analysis.name as string);
      setFoodTextEntry(normalizedName, {
        name: analysis.name,
        ranges: analysis.estimated_ranges,
        micronutrient_signals: analysis.micronutrient_signals ?? [],
        source: "ai",
        savedAt: Date.now(),
        detected_brand: analysis.detected_brand ?? null,
        detected_product: analysis.detected_product ?? null,
      });
      incrementFoodTextLogCount(normalizedName);
    }

    clearMealsCache(job.userId);
    notifyMealsUpdated();
    window.dispatchEvent(new CustomEvent("meal-analysis-complete", { detail: job.mealId }));
  } catch {
    window.dispatchEvent(new CustomEvent("meal-analysis-error", { detail: { mealId: job.mealId, rateLimited: false } }));
    markMealFailed(job.mealId).catch(() => {});
    clearMealsCache(job.userId);
    notifyMealsUpdated();
  }

  processNext();
}

export function enqueueMeal(mealId: string, imageBase64: string, userId?: string) {
  queue.push({ mealId, imageBase64, userId });

  if (!isProcessing) {
    processNext();
  }
}
