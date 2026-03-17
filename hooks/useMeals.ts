"use client";

import { useCallback, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { MealAnalysis, MealLog } from "../lib/types";
import { addMeal, listMeals, updateMeal } from "../lib/supabaseDb";
import { safeFallbackAnalysis } from "../lib/ai/schema";

export function useMeals(
  user: User | null,
  onError: (msg: string) => void,
  setEditRecents: (val: boolean) => void
) {
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [editingMeal, setEditingMeal] = useState<MealLog | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
  });
  const [updatingMeal, setUpdatingMeal] = useState(false);

  // Manual text entry state
  const [manualText, setManualText] = useState("");
  const [manualAnalysing, setManualAnalysing] = useState(false);
  const [manualResult, setManualResult] = useState<MealAnalysis | null>(null);
  const [manualPortion, setManualPortion] = useState<"small" | "medium" | "large">("medium");
  const [manualError, setManualError] = useState<string | null>(null);

  const load = useCallback(async (userId: string) => {
    const mealsData = await listMeals(userId, 200);
    setMeals(mealsData);
    // Recover meals stuck in "processing" (e.g. tab closed mid-analysis)
    const STUCK_MS = 5 * 60 * 1000;
    const now = Date.now();
    const stuck = mealsData.filter((m) => m.status === "processing" && now - m.ts > STUCK_MS);
    if (stuck.length > 0) {
      await Promise.all(stuck.map((m) => updateMeal(m.id, safeFallbackAnalysis(), undefined, userId).catch(() => {})));
      const refreshed = await listMeals(userId, 200);
      setMeals(refreshed);
    }
  }, []);

  const openManualMealEntry = () => {
    setManualText("");
    setManualResult(null);
    setManualPortion("medium");
    setManualError(null);
    setEditForm({ name: "", calories: "", protein: "", carbs: "", fat: "" });
    setEditingMeal({
      id: "",
      ts: Date.now(),
      analysisJson: {
        name: "",
        estimated_ranges: {
          calories_min: 0,
          calories_max: 0,
          protein_g_min: 0,
          protein_g_max: 0,
          carbs_g_min: 0,
          carbs_g_max: 0,
          fat_g_min: 0,
          fat_g_max: 0,
        },
      },
    } as any);
  };

  const analyzeManualText = async () => {
    if (!manualText.trim()) return;
    setManualAnalysing(true);
    setManualError(null);
    try {
      const res = await fetch("/api/analyze-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ textDescription: manualText.trim() })
      });
      if (!res.ok) throw new Error("Analysis failed");
      const data = await res.json();
      setManualResult(data.analysis ?? null);
      setManualPortion("medium");
    } catch {
      setManualError("Something went wrong. Please try again.");
    } finally {
      setManualAnalysing(false);
    }
  };

  const confirmManualMeal = async () => {
    if (!user || !manualResult) return;
    setUpdatingMeal(true);
    try {
      const multiplier = manualPortion === "small" ? 0.7 : manualPortion === "large" ? 1.4 : 1;
      const scale = (v: number) => Math.round(v * multiplier);
      const r = manualResult.estimated_ranges;
      const scaledAnalysis = {
        ...manualResult,
        estimated_ranges: {
          calories_min: scale(r.calories_min), calories_max: scale(r.calories_max),
          protein_g_min: scale(r.protein_g_min), protein_g_max: scale(r.protein_g_max),
          carbs_g_min: scale(r.carbs_g_min), carbs_g_max: scale(r.carbs_g_max),
          fat_g_min: scale(r.fat_g_min), fat_g_max: scale(r.fat_g_max),
        }
      };
      const created = await addMeal(user.id, scaledAnalysis as any);
      await updateMeal(created.id, scaledAnalysis as any, { userCorrection: manualResult.name }, user.id);
      setManualText("");
      setManualResult(null);
      setManualPortion("medium");
      setEditingMeal(null);
      setEditRecents(false);
      await load(user.id);
    } catch (err) {
      console.error("Manual meal save failed", err);
    } finally {
      setUpdatingMeal(false);
    }
  };

  const openMealEditor = (meal: MealLog) => {
    const displayName =
      meal.analysisJson?.name ??
      meal.analysisJson?.detected_items?.[0]?.name ??
      "Meal";
    setEditForm({
      name: displayName,
      calories: meal.calories?.toString() ?? "",
      protein: meal.protein?.toString() ?? "",
      carbs: meal.carbs?.toString() ?? "",
      fat: meal.fat?.toString() ?? "",
    });
    setEditingMeal(meal);
  };

  const handleUpdateMeal = async () => {
    if (!editingMeal || !user) return;
    try {
      setUpdatingMeal(true);
      const ranges = { ...editingMeal.analysisJson.estimated_ranges };
      const toNumber = (value: string) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const calories =
        editForm.calories.trim() === "" ? editingMeal.calories ?? null : toNumber(editForm.calories);
      const protein =
        editForm.protein.trim() === "" ? editingMeal.protein ?? null : toNumber(editForm.protein);
      const carbs =
        editForm.carbs.trim() === "" ? editingMeal.carbs ?? null : toNumber(editForm.carbs);
      const fat =
        editForm.fat.trim() === "" ? editingMeal.fat ?? null : toNumber(editForm.fat);

      if (calories !== null) { ranges.calories_min = calories; ranges.calories_max = calories; }
      if (protein !== null) { ranges.protein_g_min = protein; ranges.protein_g_max = protein; }
      if (carbs !== null) { ranges.carbs_g_min = carbs; ranges.carbs_g_max = carbs; }
      if (fat !== null) { ranges.fat_g_min = fat; ranges.fat_g_max = fat; }

      const updatedAnalysis = {
        ...(editingMeal.analysisJson as any),
        name: editForm.name,
        estimated_ranges: ranges,
      };

      await updateMeal(editingMeal.id, updatedAnalysis as any, { userCorrection: editForm.name }, user?.id);

      setEditingMeal(null);
      setEditRecents(false);
      await load(user.id);
    } catch (err) {
      console.error("Meal update failed", err);
    } finally {
      setUpdatingMeal(false);
    }
  };

  return {
    meals,
    setMeals,
    editingMeal,
    setEditingMeal,
    editForm,
    setEditForm,
    updatingMeal,
    load,
    manualText,
    setManualText,
    manualAnalysing,
    manualResult,
    setManualResult,
    manualPortion,
    setManualPortion,
    manualError,
    openManualMealEntry,
    analyzeManualText,
    confirmManualMeal,
    openMealEditor,
    handleUpdateMeal,
  };
}
