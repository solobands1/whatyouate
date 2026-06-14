
import { notifyMealsUpdated } from "./dataEvents";
import { clearMealsCache, markMealFailed } from "./supabaseDb";
import { setFoodTextEntry, incrementFoodTextLogCount, normalizeFoodKey } from "./foodCache";

type MealJob = {
  mealId: string;
  imageBase64: string;
  userId?: string;
  hint?: string;
  attempts?: number;
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
    // Must exceed the server's own processing budget (maxDuration 60s, with a 25s
    // Anthropic vision call + possible OpenAI fallback). A shorter client timeout
    // aborts slow-but-successful analyses, triggering wasteful retries that race the
    // original request on the same meal row.
    const clientTimeout = setTimeout(() => clientController.abort(), 55_000);
    let response: Response;
    try {
      response = await fetch("/api/analyze-food", {
        method: "POST",
        signal: clientController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: job.imageBase64,
          mealId: job.mealId,
          userId: job.userId,
          ...(job.hint ? { hints: job.hint } : {}),
        })
      });
    } finally {
      clearTimeout(clientTimeout);
    }

    if (response.status === 429) {
      let dailyLimitReached = false;
      try {
        const body = await response.json();
        dailyLimitReached = typeof body?.error === "string" && body.error.includes("Daily limit");
      } catch {}
      if (dailyLimitReached) {
        markMealFailed(job.mealId).catch(() => {});
        clearMealsCache(job.userId);
        notifyMealsUpdated();
        window.dispatchEvent(new CustomEvent("meal-analysis-error", { detail: { mealId: job.mealId, dailyLimitReached: true } }));
      } else {
        window.dispatchEvent(new CustomEvent("meal-analysis-error", { detail: { mealId: job.mealId, rateLimited: true } }));
        notifyMealsUpdated();
      }
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
  } catch (err) {
    // Client-side timeout (abort): the server is likely still processing and will
    // write a result on its own. Retrying here would start a second concurrent
    // analysis racing the first on the same meal row, so don't retry and don't mark
    // failed — leave it processing. Realtime picks up a success; the stale-recovery
    // modal catches a genuine failure.
    const isTimeout = (err as { name?: string } | null)?.name === "AbortError";
    if (isTimeout) {
      processNext();
      return;
    }
    const attempts = (job.attempts ?? 0) + 1;
    if (attempts < 3) {
      // Retry genuine network errors (request never reached the server) up to 2 times
      setTimeout(() => {
        queue.unshift({ ...job, attempts });
        if (!isProcessing) processNext();
      }, 3000);
    } else {
      window.dispatchEvent(new CustomEvent("meal-analysis-error", { detail: { mealId: job.mealId, rateLimited: false } }));
      markMealFailed(job.mealId).catch(() => {});
      clearMealsCache(job.userId);
      notifyMealsUpdated();
    }
  }

  processNext();
}

export function enqueueMeal(mealId: string, imageBase64: string, userId?: string, hint?: string) {
  queue.push({ mealId, imageBase64, userId, hint });

  if (!isProcessing) {
    processNext();
  }
}
