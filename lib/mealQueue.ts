
import { notifyMealsUpdated } from "./dataEvents";

type MealJob = {
  mealId: string;
  imageBase64: string;
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
    const response = await fetch("/api/analyze-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64: job.imageBase64,
        mealId: job.mealId
      })
    });

    if (!response.ok) throw new Error("Analyze failed");

    await response.json();

    notifyMealsUpdated();
    window.dispatchEvent(new CustomEvent("meal-analysis-complete", { detail: job.mealId }));
    window.setTimeout(() => {
      notifyMealsUpdated();
    }, 5000);
  } catch {
    notifyMealsUpdated();
  }

  processNext();
}

export function enqueueMeal(mealId: string, imageBase64: string) {
  queue.push({ mealId, imageBase64 });

  if (!isProcessing) {
    processNext();
  }
}
