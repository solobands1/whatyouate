"use client";

import { useCallback, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { MealLog } from "../lib/types";
import { addMeal, listMeals, updateMeal } from "../lib/supabaseDb";

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

  const load = useCallback(async (userId: string) => {
    const mealsData = await listMeals(userId, 50);
    setMeals(mealsData);
  }, []);

  const openManualMealEntry = () => {
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

      if (!editingMeal.id) {
        const created = await addMeal(user.id, updatedAnalysis as any);
        await updateMeal(created.id, updatedAnalysis as any, { userCorrection: editForm.name });
      } else {
        await updateMeal(editingMeal.id, updatedAnalysis as any, { userCorrection: editForm.name });
      }

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
    openManualMealEntry,
    openMealEditor,
    handleUpdateMeal,
  };
}
