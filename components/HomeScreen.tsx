"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Joyride, { CallBackProps, STATUS, type Step } from "react-joyride";
import { useRouter } from "next/navigation";
import type { MealLog, UserProfile, WorkoutSession } from "../lib/types";
import { suppName, suppLabel } from "../lib/types";
import { matchSupplementNutrients } from "../lib/rda";
import {
  PROFILE_UPDATED_EVENT,
  notifyMealsUpdated,
  notifyWorkoutsUpdated
} from "../lib/dataEvents";
import { formatApprox, formatDateShort, todayKey, dayKeyFromTs } from "../lib/utils";
import { supabase } from "../lib/supabaseClient";
import "../lib/mealQueue";
import BarcodeScannerOverlay from "./BarcodeScannerOverlay";
import { getFoodCacheEntry, setFoodCacheEntry, deleteFoodCacheEntry, deleteFoodTextEntry, incrementFoodCacheLogCount, incrementFoodTextLogCount, getQuickAddItems, getDailySupplements, setDailySupplements, hasDailySuppsLoggedToday, markDailySuppsLoggedToday, type QuickAddItem } from "../lib/foodCache";
import BottomNav from "./BottomNav";
import Card from "./Card";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import {
  addMeal,
  clearMealsCache,
  deleteMeal,
  deleteWorkout,
  updateMeal,
  updateMealTs,
} from "../lib/supabaseDb";
import { computeHomeMarkers, computeNudges, computeRecent } from "../lib/digestEngine";
import { useTrialStatus } from "../hooks/useTrialStatus";
import { openUpgradeModal } from "./UpgradeModal";
import { safeFallbackAnalysis } from "../lib/ai/schema";
import { useWorkout, WORKOUT_TYPE_OPTIONS } from "../hooks/useWorkout";
import { useMeals } from "../hooks/useMeals";


function makeDemoMeals(): MealLog[] {
  const at = (h: number, m: number) => {
    const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime();
  };
  return [
    {
      id: "demo-supp", ts: at(0, 1), status: "done",
      analysisJson: {
        name: "Supplements", source: "supplement",
        detected_items: [{ name: "Vitamin D", confidence_0_1: 1 }, { name: "Fish Oil", confidence_0_1: 1 }],
        estimated_ranges: { calories_min: 0, calories_max: 0, protein_g_min: 0, protein_g_max: 0, carbs_g_min: 0, carbs_g_max: 0, fat_g_min: 0, fat_g_max: 0 },
        micronutrient_signals: [{ nutrient: "Vitamin D", signal: "adequate_appearance", rationale_short: "Supplement logged" }, { nutrient: "Omega-3", signal: "adequate_appearance", rationale_short: "Supplement logged" }],
        confidence_overall_0_1: 1, precision_mode_available: false,
      },
    },
    {
      id: "demo-1", ts: at(7, 30), status: "done",
      analysisJson: {
        name: "Scrambled Eggs & Avocado Toast",
        detected_items: [{ name: "Scrambled eggs", confidence_0_1: 0.95 }, { name: "Avocado toast", confidence_0_1: 0.92 }],
        estimated_ranges: { calories_min: 380, calories_max: 440, protein_g_min: 18, protein_g_max: 22, carbs_g_min: 32, carbs_g_max: 40, fat_g_min: 18, fat_g_max: 24 },
        micronutrient_signals: [{ nutrient: "Vitamin E", signal: "adequate_appearance", rationale_short: "From avocado" }, { nutrient: "Choline", signal: "adequate_appearance", rationale_short: "From eggs" }],
        confidence_overall_0_1: 0.88, precision_mode_available: false,
      },
    },
    {
      id: "demo-2", ts: at(12, 15), status: "done",
      analysisJson: {
        name: "Grilled Chicken & Rice Bowl",
        detected_items: [{ name: "Grilled chicken breast", confidence_0_1: 0.95 }, { name: "White rice", confidence_0_1: 0.90 }, { name: "Roasted vegetables", confidence_0_1: 0.85 }],
        estimated_ranges: { calories_min: 520, calories_max: 580, protein_g_min: 38, protein_g_max: 44, carbs_g_min: 55, carbs_g_max: 68, fat_g_min: 8, fat_g_max: 14 },
        micronutrient_signals: [{ nutrient: "Iron", signal: "adequate_appearance", rationale_short: "From chicken" }, { nutrient: "Fiber", signal: "adequate_appearance", rationale_short: "From vegetables" }],
        confidence_overall_0_1: 0.85, precision_mode_available: false,
      },
    },
    {
      id: "demo-3", ts: at(15, 30), status: "done",
      analysisJson: {
        name: "Protein Shake",
        detected_items: [{ name: "Protein shake", confidence_0_1: 0.97 }],
        estimated_ranges: { calories_min: 160, calories_max: 180, protein_g_min: 20, protein_g_max: 24, carbs_g_min: 8, carbs_g_max: 12, fat_g_min: 2, fat_g_max: 4 },
        micronutrient_signals: [],
        confidence_overall_0_1: 0.95, precision_mode_available: false,
      },
    },
    {
      id: "demo-4", ts: at(19, 0), status: "done",
      analysisJson: {
        name: "Salmon, Sweet Potato & Broccoli",
        detected_items: [{ name: "Baked salmon", confidence_0_1: 0.92 }, { name: "Sweet potato", confidence_0_1: 0.88 }, { name: "Steamed broccoli", confidence_0_1: 0.90 }],
        estimated_ranges: { calories_min: 520, calories_max: 580, protein_g_min: 35, protein_g_max: 42, carbs_g_min: 42, carbs_g_max: 55, fat_g_min: 14, fat_g_max: 20 },
        micronutrient_signals: [{ nutrient: "Omega-3", signal: "adequate_appearance", rationale_short: "From salmon" }, { nutrient: "Vitamin C", signal: "adequate_appearance", rationale_short: "From broccoli" }, { nutrient: "Potassium", signal: "adequate_appearance", rationale_short: "From sweet potato" }],
        confidence_overall_0_1: 0.87, precision_mode_available: false,
      },
    },
  ];
}

function makeDemoWorkouts(): WorkoutSession[] {
  const at = (h: number, m: number) => {
    const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime();
  };
  return [{ id: "demo-w1", startTs: at(6, 0), endTs: at(6, 45), durationMin: 45, workoutTypes: ["Strength"], intensity: "medium" }];
}

// Module-level cache — survives navigation, resets on full page reload

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function minDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatManualDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ManualDateRow({ manualDate, setManualDate }: { manualDate: string; setManualDate: (d: string) => void }) {
  const isToday = manualDate === todayDateStr();
  return (
    <div className="relative mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition"
      style={isToday
        ? { borderColor: "rgba(15,23,42,0.10)", background: "transparent" }
        : { borderColor: "rgba(99,133,255,0.35)", background: "rgba(99,133,255,0.06)" }
      }
    >
      <svg className={`h-3 w-3 shrink-0 ${isToday ? "text-ink/35" : "text-primary/70"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      <span className={`text-[11px] select-none ${isToday ? "text-ink/45" : "font-medium text-primary/80"}`}>
        {isToday ? "Today" : formatManualDate(manualDate)}
      </span>
      <input
        type="date"
        className="absolute inset-0 cursor-pointer opacity-0"
        value={manualDate}
        max={todayDateStr()}
        min={minDateStr()}
        onChange={(e) => { if (e.target.value && e.target.value <= todayDateStr()) setManualDate(e.target.value); }}
      />
    </div>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { profile: ctxProfile, meals: ctxMeals, workouts: ctxWorkouts, loading: dataLoading, reload } = useAppData();

  const [profile, setProfile] = useState<UserProfile | undefined>(undefined);
  const [runTour, setRunTour] = useState(false);
  const [showTourGate, setShowTourGate] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [demoData] = useState(() => ({ meals: makeDemoMeals(), workouts: makeDemoWorkouts() }));
  const loadingData = dataLoading;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [barcodeNotFound, setBarcodeNotFound] = useState(false);
  const [barcodeSuccess, setBarcodeSuccess] = useState(false);
  const [barcodeLookingUp, setBarcodeLookingUp] = useState(false);
  const [barcodeProduct, setBarcodeProduct] = useState<{
    name: string; brand: string; calories: number; protein: number;
    carbs: number; fat: number; valuePer: "serving" | "100g";
  } | null>(null);
  const [barcodeGrams, setBarcodeGrams] = useState("100");
  const [isAddingBarcode, setIsAddingBarcode] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [barcodeFromCache, setBarcodeFromCache] = useState(false);
  const [barcodeEditMode, setBarcodeEditMode] = useState(false);
  const [barcodeEdit, setBarcodeEdit] = useState({ name: "", calories: "", protein: "", carbs: "", fat: "" });
  const [editRecents, setEditRecents] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    type: "meal" | "workout";
    id: string;
  } | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);
  const [visibleRecentCount, setVisibleRecentCount] = useState(6);
  const [visibleGroupCount, setVisibleGroupCount] = useState(3);
  const [barsReady, setBarsReady] = useState(false);
  const [pendingQuickConfirmId, setPendingQuickConfirmId] = useState<string | null>(null);
  const [quickConfirmMeal, setQuickConfirmMeal] = useState<MealLog | null>(null);
  const [quickConfirmName, setQuickConfirmName] = useState("");
  const [quickConfirmOriginalName, setQuickConfirmOriginalName] = useState("");
  const [quickConfirmPortion, setQuickConfirmPortion] = useState<"small" | "medium" | "large">("medium");
  const [failedMealPrompt, setFailedMealPrompt] = useState<{ mealId: string; thumb?: string } | null>(null);
  const [failedMealText, setFailedMealText] = useState("");
  const [failedMealAnalyzing, setFailedMealAnalyzing] = useState(false);
  const [showProfileBell, setShowProfileBell] = useState(false);
  const [quickConfirming, setQuickConfirming] = useState(false);
  const [editPortion, setEditPortion] = useState<"small" | "medium" | "large">("medium");
  const [showTargetInfo, setShowTargetInfo] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddItems, setQuickAddItems] = useState<QuickAddItem[]>([]);
  const [quickAddSelected, setQuickAddSelected] = useState<Record<string, "small" | "medium" | "large">>({});
  const [quickAddAdding, setQuickAddAdding] = useState(false);
  const [quickAddDate, setQuickAddDate] = useState(todayDateStr);
  const [streakSaverDismissed, setStreakSaverDismissed] = useState(false);
  const [recentlyLogged, setRecentlyLogged] = useState(false);
  const prevDoneMealCountRef = useRef<number | null>(null);
  const logFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mountedRef = useRef(true);
  const recentSentinelRef = useRef<HTMLDivElement | null>(null);
  const foodInputRef = useRef<HTMLInputElement | null>(null);
  const realtimeRefreshRef = useRef<number | null>(null);
  const nudgesLoadedRef = useRef(false);
  const savedThisSessionRef = useRef<Set<string>>(new Set());
  const dailySuppsAttemptedRef = useRef(false);

  const onError = useCallback((msg: string) => setLoadError(msg), []);

  const workout = useWorkout(user, onError, setEditRecents, []);
  const meals = useMeals(user, onError, setEditRecents, []);
  const trial = useTrialStatus();

  const handleOpenQuickAdd = () => {
    setQuickAddItems(getQuickAddItems());
    setQuickAddSelected({});
    setQuickAddDate(todayDateStr());
    setShowQuickAdd(true);
  };

  const handleQuickAddConfirm = async () => {
    if (!user) return;
    const selected = Object.entries(quickAddSelected);
    if (!selected.length) return;
    setQuickAddAdding(true);
    try {
      const newMeals: typeof meals.meals = [];
      for (const [key, portion] of selected) {
        const item = quickAddItems.find((i) => i.key === key);
        if (!item) continue;
        const multiplier = portion === "small" ? 0.7 : portion === "large" ? 1.4 : 1;
        const scale = (v: number) => Math.round(v * multiplier);
        let ranges: {
          calories_min: number; calories_max: number;
          protein_g_min: number; protein_g_max: number;
          carbs_g_min: number; carbs_g_max: number;
          fat_g_min: number; fat_g_max: number;
        };
        if (item.type === "text" && item.ranges) {
          const r = item.ranges;
          ranges = {
            calories_min: scale(r.calories_min), calories_max: scale(r.calories_max),
            protein_g_min: scale(r.protein_g_min), protein_g_max: scale(r.protein_g_max),
            carbs_g_min: scale(r.carbs_g_min), carbs_g_max: scale(r.carbs_g_max),
            fat_g_min: scale(r.fat_g_min), fat_g_max: scale(r.fat_g_max),
          };
        } else {
          const cal = scale(item.calories ?? 0);
          const prot = scale(item.protein ?? 0);
          const carbs = scale(item.carbs ?? 0);
          const fat = scale(item.fat ?? 0);
          ranges = {
            calories_min: cal, calories_max: cal,
            protein_g_min: prot, protein_g_max: prot,
            carbs_g_min: carbs, carbs_g_max: carbs,
            fat_g_min: fat, fat_g_max: fat,
          };
        }
        const analysis = {
          name: item.name,
          detected_items: [{ name: item.name, confidence_0_1: 1 }],
          estimated_ranges: ranges,
          micronutrient_signals: item.micronutrient_signals ?? [],
          confidence_overall_0_1: 1,
          precision_mode_available: false,
        } as any;
        const created = await addMeal(user.id, analysis);
        if (created?.id) {
          await updateMeal(created.id, analysis, { userCorrection: item.name }, user.id);
          if (quickAddDate !== todayDateStr()) {
            const d = new Date(quickAddDate + "T12:00:00");
            if (d.getTime() < Date.now()) await updateMealTs(created.id, d.getTime()).catch(() => {});
          }
          newMeals.push({ ...created, analysisJson: analysis, status: "done" as const });
          if (item.type === "text") {
            incrementFoodTextLogCount(item.key);
          } else if (item.barcode) {
            incrementFoodCacheLogCount(item.barcode);
          }
        }
      }
      if (newMeals.length > 0) {
        meals.setMeals((prev) => [...newMeals, ...prev]);
        notifyMealsUpdated();
      }
      setShowQuickAdd(false);
      setQuickAddSelected({});
    } catch (err) {
      console.error("[quick add] failed:", err);
    } finally {
      setQuickAddAdding(false);
    }
  };

  const handleRemoveQuickAddItem = (item: QuickAddItem) => {
    if (item.type === "text") {
      deleteFoodTextEntry(item.key);
    } else if (item.barcode) {
      deleteFoodCacheEntry(item.barcode);
    }
    setQuickAddItems((prev) => prev.filter((i) => i.key !== item.key));
    setQuickAddSelected((prev) => {
      const next = { ...prev };
      delete next[item.key];
      return next;
    });
  };

  // Sync from shared context → local hook states
  useEffect(() => {
    setProfile(ctxProfile ?? undefined);
    // Restore daily supplements from profile if localStorage was cleared
    if (ctxProfile?.dailySupplements?.length && user && !getDailySupplements(user.id).length) {
      setDailySupplements(user.id, ctxProfile.dailySupplements);
    }
    // Backfill daily-supp guard from DB so PWA restores don't double-log
    if (user && ctxMeals.length > 0 && !hasDailySuppsLoggedToday(user.id)) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      if (ctxMeals.some((m) => m.analysisJson?.source === "supplement" && m.ts >= todayStart.getTime())) {
        markDailySuppsLoggedToday(user.id);
      }
    }
  }, [ctxProfile, ctxMeals, user]);

  useEffect(() => {
    meals.setMeals(ctxMeals);
  }, [ctxMeals]);

  useEffect(() => {
    workout.setWorkouts(ctxWorkouts);
  }, [ctxWorkouts]);

  useEffect(() => {
    if (loadingData) { setBarsReady(false); return; }
    const t = setTimeout(() => setBarsReady(true), 60);
    return () => clearTimeout(t);
  }, [loadingData]);



  const handleConfirmDelete = async () => {
    if (!pendingDelete || !user) return;
    setDeletingItem(true);
    const { type, id } = pendingDelete;
    try {
      if (type === "meal") {
        const deletedMeal = meals.meals.find((m) => m.id === id);
        await deleteMeal(id, user.id);
        meals.setMeals((prev) => prev.filter((m) => m.id !== id));
        meals.setEditingMeal(null);
        setEditRecents(false);
        // If the deleted meal was a supplement entry, keep the daily guard set
        // so auto-log does not re-add them. The user explicitly removed it.
      } else {
        await deleteWorkout(id, user.id);
        workout.setWorkouts((prev) => prev.filter((w) => w.id !== id));
        workout.setEditingWorkout(null);
        setEditRecents(false);
        notifyWorkoutsUpdated();
      }
    } catch (err) {
      console.error("[delete] FAILED", err);
      setLoadError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeletingItem(false);
      setPendingDelete(null);
    }
  };

  const handleQuickConfirm = async () => {
    if (!quickConfirmMeal || !user) return;
    setQuickConfirming(true);
    const nameChanged = quickConfirmName.trim().toLowerCase() !== quickConfirmOriginalName.trim().toLowerCase();
    try {
      if (nameChanged && quickConfirmName.trim()) {
        // Re-analyze with the corrected name — macros will update in DB
        await fetch("/api/analyze-food", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            textDescription: quickConfirmName.trim(),
            mealId: quickConfirmMeal.id,
            userId: user.id,
          }),
        });
        clearMealsCache(user.id);
        notifyMealsUpdated();
      } else {
        // Name unchanged — just apply portion scaling
        const multiplier = quickConfirmPortion === "small" ? 0.7 : quickConfirmPortion === "large" ? 1.4 : 1;
        const scale = (v: number) => Math.round(v * multiplier);
        const r = quickConfirmMeal.analysisJson.estimated_ranges;
        const updatedAnalysis = {
          ...quickConfirmMeal.analysisJson,
          name: quickConfirmName,
          estimated_ranges: {
            calories_min: scale(r.calories_min), calories_max: scale(r.calories_max),
            protein_g_min: scale(r.protein_g_min), protein_g_max: scale(r.protein_g_max),
            carbs_g_min: scale(r.carbs_g_min), carbs_g_max: scale(r.carbs_g_max),
            fat_g_min: scale(r.fat_g_min), fat_g_max: scale(r.fat_g_max),
          },
        };
        await updateMeal(quickConfirmMeal.id, updatedAnalysis as any, { userCorrection: quickConfirmName }, user?.id);
        await meals.load(user.id);
      }
      setQuickConfirmMeal(null);
    } catch (err) {
      console.error("Quick confirm failed", err);
    } finally {
      setQuickConfirming(false);
    }
  };

  const handleFailedMealSubmit = async () => {
    if (!failedMealPrompt || !failedMealText.trim() || !user) return;
    setFailedMealAnalyzing(true);
    try {
      const res = await fetch("/api/analyze-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ textDescription: failedMealText.trim(), mealId: failedMealPrompt.mealId, userId: user.id })
      });
      if (!res.ok) throw new Error("Analysis failed");
      clearMealsCache(user.id);
      notifyMealsUpdated();
      setFailedMealPrompt(null);
    } catch {
      // Fall back to marking as failed
      updateMeal(failedMealPrompt.mealId, safeFallbackAnalysis(), undefined, user.id, "failed").catch(() => {});
      clearMealsCache(user.id);
      notifyMealsUpdated();
      setLoadError("Something went wrong. You can edit the meal manually.");
      setFailedMealPrompt(null);
    } finally {
      setFailedMealAnalyzing(false);
    }
  };

  const handleFailedMealDismiss = () => {
    if (!failedMealPrompt || !user) { setFailedMealPrompt(null); return; }
    updateMeal(failedMealPrompt.mealId, safeFallbackAnalysis(), undefined, user.id, "failed").catch(() => {}).finally(() => {
      clearMealsCache(user.id);
      notifyMealsUpdated();
    });
    setFailedMealPrompt(null);
  };

  const applyEditPortion = (portion: "small" | "medium" | "large") => {
    if (!meals.editingMeal) return;
    setEditPortion(portion);
    const multiplier = portion === "small" ? 0.7 : portion === "large" ? 1.4 : 1;
    const m = meals.editingMeal;
    const r = m.analysisJson.estimated_ranges;
    const base = {
      calories: m.calories ?? Math.round((r.calories_min + r.calories_max) / 2),
      protein: m.protein ?? Math.round((r.protein_g_min + r.protein_g_max) / 2),
      carbs: m.carbs ?? Math.round((r.carbs_g_min + r.carbs_g_max) / 2),
      fat: m.fat ?? Math.round((r.fat_g_min + r.fat_g_max) / 2),
    };
    meals.setEditForm({
      ...meals.editForm,
      calories: String(Math.round(base.calories * multiplier)),
      protein: String(Math.round(base.protein * multiplier)),
      carbs: String(Math.round(base.carbs * multiplier)),
      fat: String(Math.round(base.fat * multiplier)),
    });
  };

  const handleFoodPhotoClick = () => {
    foodInputRef.current?.click();
  };

  const handleFoodFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(selected);
    });
    try {
      sessionStorage.setItem(
        "wya_pending_capture",
        JSON.stringify({ name: selected.name, type: selected.type, dataUrl })
      );
    } catch {
      // If storage fails, fall back to capture screen.
    }
    router.push("/capture?type=food&from=home");
  };

  const handleBarcodeDetected = async (barcode: string) => {
    if (!user) return;
    setScannedBarcode(barcode);

    // Check local cache first — skips API call entirely
    const cached = getFoodCacheEntry(barcode);
    if (cached) {
      setBarcodeProduct({
        name: cached.name,
        brand: cached.brand,
        calories: cached.calories,
        protein: cached.protein,
        carbs: cached.carbs,
        fat: cached.fat,
        valuePer: cached.valuePer,
      });
      setBarcodeGrams("100");
      setBarcodeFromCache(true);
      setBarcodeEditMode(false);
      return;
    }

    setBarcodeFromCache(false);
    setBarcodeLookingUp(true);
    let res: Response;
    try {
      res = await fetch("/api/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode }),
      });
    } catch {
      setBarcodeLookingUp(false);
      setBarcodeNotFound(true);
      return;
    }
    setBarcodeLookingUp(false);
    if (!res.ok) {
      setBarcodeNotFound(true);
      return;
    }
    const product = await res.json();
    const name = String(product?.name ?? "").trim() || String(product?.brand ?? "").trim();
    if (!name) {
      setBarcodeNotFound(true);
      return;
    }
    const toVal = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    setBarcodeProduct({
      name,
      brand: String(product?.brand ?? "").trim(),
      calories: toVal(product?.calories),
      protein: toVal(product?.protein),
      carbs: toVal(product?.carbs),
      fat: toVal(product?.fat),
      valuePer: product?.valuePer === "100g" ? "100g" : "serving",
    });
    setBarcodeGrams("100");
    setBarcodeEditMode(false);
  };

  const handleConfirmBarcodeProduct = async () => {
    if (!user || !barcodeProduct || isAddingBarcode) return;
    setIsAddingBarcode(true);
    const { name, brand, valuePer } = barcodeProduct;
    const barcodeGramsNum = Number(barcodeGrams);
    const scale = valuePer === "100g" ? Math.max(1, Number.isFinite(barcodeGramsNum) && barcodeGrams.trim() !== "" ? barcodeGramsNum : 100) / 100 : 1;
    const round = (v: number) => Math.round(v * scale);
    const calories = round(barcodeProduct.calories ?? 0);
    const protein = round(barcodeProduct.protein ?? 0);
    const carbs = round(barcodeProduct.carbs ?? 0);
    const fat = round(barcodeProduct.fat ?? 0);
    const analysis = {
      name,
      detected_items: [{ name, confidence_0_1: 1 }],
      estimated_ranges: {
        calories_min: calories, calories_max: calories,
        protein_g_min: protein, protein_g_max: protein,
        carbs_g_min: carbs, carbs_g_max: carbs,
        fat_g_min: fat, fat_g_max: fat,
      },
      micronutrient_signals: [],
      confidence_overall_0_1: 1,
      detected_brand: brand || null,
      detected_product: name,
      database_match_confidence_0_1: 1,
      precision_mode_available: false,
    } as any;
    // Save to food cache before clearing state
    if (scannedBarcode) {
      setFoodCacheEntry(scannedBarcode, {
        name: barcodeProduct.name,
        brand: barcodeProduct.brand,
        calories,
        protein,
        carbs,
        fat,
        valuePer: "serving",
        source: "openfoodfacts",
        savedAt: Date.now(),
      });
      incrementFoodCacheLogCount(scannedBarcode);
    }
    setBarcodeProduct(null);
    setBarcodeGrams("100");
    setBarcodeEditMode(false);
    setBarcodeFromCache(false);
    try {
      const created = await addMeal(user.id, analysis);
      if (created?.id) {
        await updateMeal(created.id, analysis, undefined, user?.id);
        const finishedMeal = { ...created, analysisJson: analysis, status: "done" as const };
        meals.setMeals((prev) => [finishedMeal, ...prev]);
        notifyMealsUpdated();
      }
      setBarcodeSuccess(true);
      setTimeout(() => setBarcodeSuccess(false), 1500);
    } catch (err) {
      console.error("[barcode] save failed:", err);
    } finally {
      setIsAddingBarcode(false);
    }
  };

  const handleSaveAndAddBarcode = async () => {
    if (!barcodeProduct || !user || isAddingBarcode) return;
    const cal = Math.round(Number(barcodeEdit.calories) || 0);
    const prot = Math.round(Number(barcodeEdit.protein) || 0);
    const carb = Math.round(Number(barcodeEdit.carbs) || 0);
    const fat = Math.round(Number(barcodeEdit.fat) || 0);
    const name = barcodeEdit.name.trim() || barcodeProduct.name;
    // Save correction to cache
    if (scannedBarcode) {
      setFoodCacheEntry(scannedBarcode, { name, brand: barcodeProduct.brand, calories: cal, protein: prot, carbs: carb, fat, valuePer: "serving", source: "user_corrected", savedAt: Date.now() });
      incrementFoodCacheLogCount(scannedBarcode);
    }
    // Log the meal using corrected values directly
    setIsAddingBarcode(true);
    const analysis = {
      name,
      detected_items: [{ name, confidence_0_1: 1 }],
      estimated_ranges: { calories_min: cal, calories_max: cal, protein_g_min: prot, protein_g_max: prot, carbs_g_min: carb, carbs_g_max: carb, fat_g_min: fat, fat_g_max: fat },
      micronutrient_signals: [],
      confidence_overall_0_1: 1,
      detected_brand: barcodeProduct.brand || null,
      detected_product: name,
      database_match_confidence_0_1: 1,
      precision_mode_available: false,
    } as any;
    setBarcodeProduct(null);
    setBarcodeGrams("100");
    setBarcodeEditMode(false);
    setBarcodeFromCache(false);
    try {
      const created = await addMeal(user.id, analysis);
      if (created?.id) {
        await updateMeal(created.id, analysis, undefined, user?.id);
        const finishedMeal = { ...created, analysisJson: analysis, status: "done" as const };
        meals.setMeals((prev) => [finishedMeal, ...prev]);
        notifyMealsUpdated();
      }
      setBarcodeSuccess(true);
      setTimeout(() => setBarcodeSuccess(false), 1500);
    } catch (err) {
      console.error("[barcode] save failed:", err);
    } finally {
      setIsAddingBarcode(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (logFlashTimerRef.current) clearTimeout(logFlashTimerRef.current);
    };
  }, []);

  // Flash "✓ Logged" on the Today card when a new meal finishes analyzing
  useEffect(() => {
    if (loadingData || isDemoMode) return;
    const count = meals.meals.filter(
      (m) => m.status === "done" && m.analysisJson?.source !== "supplement"
    ).length;
    if (prevDoneMealCountRef.current !== null && count > prevDoneMealCountRef.current) {
      setRecentlyLogged(true);
      if (logFlashTimerRef.current) clearTimeout(logFlashTimerRef.current);
      logFlashTimerRef.current = setTimeout(() => setRecentlyLogged(false), 2200);
    }
    prevDoneMealCountRef.current = count;
  }, [meals.meals, loadingData, isDemoMode]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  // Auto-log daily supplements once per calendar day, silently
  useEffect(() => {
    if (!user || loadingData) return;
    if (dailySuppsAttemptedRef.current) return;
    dailySuppsAttemptedRef.current = true;
    if (hasDailySuppsLoggedToday(user.id)) return;
    const supplements = getDailySupplements(user.id);
    if (!supplements.length) return;
    (async () => {
      const allNutrients = supplements.flatMap((s) => matchSupplementNutrients(suppName(s)));
      const uniqueNutrients = [...new Set(allNutrients)];
      const analysis = {
        name: "Supplements",
        source: "supplement" as const,
        detected_items: supplements.map((s) => ({ name: suppLabel(s), confidence_0_1: 1 as number })),
        estimated_ranges: {
          calories_min: 0, calories_max: 0,
          protein_g_min: 0, protein_g_max: 0,
          carbs_g_min: 0, carbs_g_max: 0,
          fat_g_min: 0, fat_g_max: 0,
        },
        micronutrient_signals: uniqueNutrients.map((n) => ({
          nutrient: n,
          signal: "adequate_appearance" as const,
          rationale_short: "Supplement logged",
        })),
        confidence_overall_0_1: 1,
        precision_mode_available: false,
      };
      try {
        const created = await addMeal(user.id, analysis);
        if (created?.id) {
          await updateMeal(created.id, analysis, undefined, user.id);
          // Stamp to 12:01am today so it anchors to the start of the day
          const midnight = new Date();
          midnight.setHours(0, 1, 0, 0);
          await updateMealTs(created.id, midnight.getTime());
          // Only mark as logged after confirmed DB save
          markDailySuppsLoggedToday(user.id);
        }
      } catch {
        // silently fail — supplements are non-critical; flag not set so next load retries
      }
      notifyMealsUpdated();
    })();
  }, [user, loadingData]);

  useEffect(() => {
    setEditRecents(false);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const mealId = (e as CustomEvent<string>).detail;
      if (mealId) setPendingQuickConfirmId(mealId);
    };
    window.addEventListener("meal-analysis-complete", handler);
    return () => window.removeEventListener("meal-analysis-complete", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { mealId, rateLimited } = (e as CustomEvent<{ mealId: string; rateLimited: boolean }>).detail ?? {};
      if (rateLimited) {
        setLoadError("Too many requests. Please wait a moment before adding another photo.");
        return;
      }
      if (mealId) {
        // Find thumbnail for the failed meal if it's in local state
        const thumb = meals.meals.find((m) => m.id === mealId)?.imageThumb ?? undefined;
        setFailedMealText("");
        setFailedMealPrompt({ mealId, thumb });
      }
    };
    window.addEventListener("meal-analysis-error", handler);
    return () => window.removeEventListener("meal-analysis-error", handler);
  }, [meals.meals]);

  useEffect(() => {
    if (!pendingQuickConfirmId) return;
    const meal = meals.meals.find((m) => m.id === pendingQuickConfirmId && m.status === "done");
    if (!meal) return;
    setPendingQuickConfirmId(null);
    const confidence = meal.analysisJson?.confidence_overall_0_1 ?? 1;
    const needsConfirm = meal.analysisJson?.precision_mode_available === true || confidence < 0.7;
    if (!needsConfirm) return;
    const name =
      meal.analysisJson?.name ??
      meal.analysisJson?.detected_items?.[0]?.name ??
      "Meal";
    setQuickConfirmName(name);
    setQuickConfirmOriginalName(name);
    setQuickConfirmPortion("medium");
    setQuickConfirmMeal(meal);
  }, [pendingQuickConfirmId, meals.meals]);

  useEffect(() => {
    if (meals.editingMeal?.id) setEditPortion("medium");
  }, [meals.editingMeal?.id]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("meals-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meals" },
        (payload: any) => {
          const rowUserId = payload?.new?.user_id ?? payload?.old?.user_id;
          if (rowUserId !== user.id) return;
          if (realtimeRefreshRef.current) {
            window.clearTimeout(realtimeRefreshRef.current);
          }
          realtimeRefreshRef.current = window.setTimeout(() => {
            reload();
          }, 250);
        }
      )
      .subscribe();

    return () => {
      if (realtimeRefreshRef.current) {
        window.clearTimeout(realtimeRefreshRef.current);
        realtimeRefreshRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [user, reload]);

  useEffect(() => {
    document.body.style.overflow = showQuickAdd ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [showQuickAdd]);

  // When a meal is still processing, the "Analyzing food…" label is time-gated
  // at render time (< 90s shows spinner text, >= 90s shows "Analysis failed").
  // React won't re-render from time alone, so schedule a reload at the moment
  // each young processing meal crosses the 90s threshold.
  useEffect(() => {
    const processingMeals = meals.meals.filter((m) => m.status === "processing");
    if (!processingMeals.length) return;
    const now = Date.now();
    const THRESHOLD = 90_000;
    const delays = processingMeals
      .map((m) => THRESHOLD - (now - m.ts))
      .filter((d) => d > 0);
    if (!delays.length) return;
    const earliest = Math.min(...delays);
    const timer = window.setTimeout(() => reload(), earliest + 50);
    return () => window.clearTimeout(timer);
  }, [meals.meals, reload]);

  useEffect(() => {
    if (!user) return;
    const key = `wya_walkthrough_${user.id}`;
    const seen = localStorage.getItem(key);
    const gateKey = `wya_walkthrough_gate_${user.id}`;
    const gateSeen = localStorage.getItem(gateKey);
    const activeKey = `wya_walkthrough_active_${user.id}`;
    const stageKey = `wya_walkthrough_stage_${user.id}`;
    const active = localStorage.getItem(activeKey) === "true";
    const stage = localStorage.getItem(stageKey) ?? "home";
    if (active && stage === "home") {
      if (localStorage.getItem(`wya_demo_mode_${user.id}`) === "true") setIsDemoMode(true);
      setRunTour(true);
      setShowTourGate(false);
      return;
    }
    // If user has meals, they're not new — skip the tour gate regardless of localStorage
    const hasMeals = ctxMeals.some((m) => m.analysisJson?.source !== "supplement" && m.status !== "failed");
    if (!seen && !active && !gateSeen && !hasMeals) {
      localStorage.setItem(gateKey, "true");
      setShowTourGate(true);
    }
    // Check if streak saver was already dismissed today
    if (localStorage.getItem(`wya_streak_saver_dismissed_${user.id}_${todayKey()}`) === "true") {
      setStreakSaverDismissed(true);
    }
  }, [user]);

  const displayMeals = isDemoMode ? demoData.meals : meals.meals;
  const displayWorkouts = isDemoMode ? demoData.workouts : workout.workouts;

  const homeVisibleNotes = useMemo(
    () => computeNudges(displayMeals, displayWorkouts, profile),
    [displayMeals, displayWorkouts, profile]
  );

  // Bell notification: mark unseen nudge when new types appear today
  // Exclude auto-supplement meals so adding vitamins doesn't trigger the dot
  const homeNotifyNotes = useMemo(
    () => computeNudges(
      displayMeals.filter((m) => (m as any).analysisJson?.source !== "supplement"),
      displayWorkouts,
      profile
    ),
    [displayMeals, displayWorkouts, profile]
  );

  useEffect(() => {
    if (!user || homeNotifyNotes.length === 0) return;
    const todayStr = todayKey();
    const notifiedTypesKey = `wya_notified_types_${todayStr}`;
    const notifiedTypes = new Set<string>(JSON.parse(localStorage.getItem(notifiedTypesKey) ?? "[]"));
    const newTypes = homeNotifyNotes.filter((note) => !notifiedTypes.has(note.type));
    if (newTypes.length === 0) return;
    newTypes.forEach((note) => notifiedTypes.add(note.type));
    localStorage.setItem(notifiedTypesKey, JSON.stringify([...notifiedTypes]));
    localStorage.setItem("wya_nudge_ts", Date.now().toString());
    window.dispatchEvent(new Event("wya_nudge_update"));
  }, [user, homeNotifyNotes]);

  const homeMarkers = useMemo(
    () => computeHomeMarkers(displayMeals, displayWorkouts, profile),
    [displayMeals, displayWorkouts, profile]
  );
  const completedWorkouts = useMemo(
    () => displayWorkouts.filter((w) => w.endTs),
    [displayWorkouts]
  );
  const recentItems = useMemo(() => {
    return computeRecent(displayMeals, completedWorkouts);
  }, [displayMeals, completedWorkouts]);

  useEffect(() => {
    if (!user) { setShowProfileBell(false); return; }
    const compute = () => {
      const updatedKey = `wya_profile_updated_${user.id}`;
      const openedKey = `wya_profile_prompt_opened_${user.id}`;
      const lastPromptKey = `wya_profile_prompt_last_${user.id}`;
      const updatedAt = Number(localStorage.getItem(updatedKey) ?? 0);
      if (!updatedAt) { setShowProfileBell(false); return; }
      const now = Date.now();
      const threeMonths = 90 * 24 * 60 * 60 * 1000;
      if (now - updatedAt < threeMonths) { setShowProfileBell(false); return; }
      const lastPromptAt = Number(localStorage.getItem(lastPromptKey) ?? 0);
      if (lastPromptAt && now - lastPromptAt < threeMonths) { setShowProfileBell(false); return; }
      const openedAt = Number(localStorage.getItem(openedKey) ?? 0);
      setShowProfileBell(!openedAt);
    };
    compute();
    const handler = () => compute();
    window.addEventListener("profile-prompt-opened", handler as EventListener);
    window.addEventListener(PROFILE_UPDATED_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener("profile-prompt-opened", handler as EventListener);
      window.removeEventListener(PROFILE_UPDATED_EVENT, handler as EventListener);
    };
  }, [user]);

  const formatTitle = (value: string) =>
    value
      .split(" ")
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
      .join(" ");
  const formatClean = (min: number, max: number, unit = "") =>
    formatApprox(min, max, unit).replace(/^~/, "");
  const formatWorkoutDurationLines = (w: WorkoutSession) => {
    let minutes: number;
    if (w.durationMin != null) {
      minutes = w.durationMin;
    } else {
      const endTs = w.endTs ?? Date.now();
      const rawMinutes = (endTs - w.startTs) / 60000;
      minutes = rawMinutes < 1 ? 0 : Math.ceil(rawMinutes);
    }
    if (minutes === 0) return { title: "Workout", detail: "<1 min" };
    if (minutes < 60) return { title: "Workout", detail: `${minutes} mins` };
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return { title: "Workout", detail: mins === 0 ? `${hours}h` : `${hours}h ${mins} mins` };
  };

  const formatDayLabel = (ts: number) => {
    const key = todayKey(new Date(ts));
    const today = todayKey();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = todayKey(yesterdayDate);
    if (key === today) return "Today";
    if (key === yesterday) return "Yesterday";
    return formatDateShort(ts);
  };

  const recentFiltered = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return recentItems.filter((item) => !item.ts || item.ts >= cutoff);
  }, [recentItems]);

  useEffect(() => {
    setVisibleRecentCount(6);
    setVisibleGroupCount(3);
  }, [recentFiltered.length]);

  const groupedRecent = useMemo(() => {
    const groups: Array<{ label: string; meals: MealLog[]; workouts: WorkoutSession[] }> = [];
    recentFiltered.forEach((item) => {
      const label = formatDayLabel(item.ts);
      let group = groups.find((entry) => entry.label === label);
      if (!group) {
        group = { label, meals: [], workouts: [] };
        groups.push(group);
      }
      if (item.type === "meal") {
        group.meals.push(item.meal);
      } else {
        group.workouts.push(item.workout);
      }
    });
    // Sort workouts within each group newest-first, regardless of upstream order
    groups.forEach(g => {
      g.workouts.sort((a, b) => {
        const aTs = a.endTs ?? a.startTs;
        const bTs = b.endTs ?? b.startTs;
        if (bTs !== aTs) return bTs - aTs;
        return b.startTs - a.startTs;
      });
    });
    return groups;
  }, [recentFiltered]);

  useEffect(() => {
    if (!recentSentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        setVisibleRecentCount((current) => {
          if (current >= recentFiltered.length) return current;
          return Math.min(current + 6, recentFiltered.length);
        });
      },
      { rootMargin: "120px" }
    );
    observer.observe(recentSentinelRef.current);
    return () => observer.disconnect();
  }, [recentFiltered.length]);

  if (!user) return null;

  const gentleTargetsDisplay = homeMarkers.gentleTargets ?? { calories: 2300, protein: 125 };
  const mealCount = homeMarkers.mealCount;
  const streak = homeMarkers.streak ?? 0;

  // Streak saver: detect if yesterday was missed but there's still a saveable streak
  const streakSaverInfo = (() => {
    if (isDemoMode || streakSaverDismissed) return null;
    const realMeals = (isDemoMode ? [] : meals.meals).filter(
      (m) => m.analysisJson?.source !== "supplement" && m.status !== "failed"
    );
    const dayKeys = new Set(realMeals.map((m) => dayKeyFromTs(m.ts)));
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    const dayBefore = new Date(); dayBefore.setDate(dayBefore.getDate() - 2);
    const yesterdayKey = dayKeyFromTs(yest.getTime());
    const dayBeforeKey = dayKeyFromTs(dayBefore.getTime());
    if (dayKeys.has(yesterdayKey) || !dayKeys.has(dayBeforeKey)) return null;
    // Count streak length before yesterday
    let savedStreak = 0;
    const d = new Date(dayBefore.getTime());
    while (dayKeys.has(dayKeyFromTs(d.getTime()))) {
      savedStreak++;
      d.setDate(d.getDate() - 1);
    }
    if (savedStreak < 2) return null;
    const yStr = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, "0")}-${String(yest.getDate()).padStart(2, "0")}`;
    return { savedStreak, yesterdayStr: yStr };
  })();
  const calMid = (homeMarkers.todayTotals.calories_min + homeMarkers.todayTotals.calories_max) / 2;
  const protMid = (homeMarkers.todayTotals.protein_g_min + homeMarkers.todayTotals.protein_g_max) / 2;
  const calPct = Math.min(100, Math.round((calMid / gentleTargetsDisplay.calories) * 100));
  const protPct = Math.min(100, Math.round((protMid / gentleTargetsDisplay.protein) * 100));

  const steps = [
    {
      target: '[data-tour="food-action"]',
      content: "Tap any of these to log a meal: snap a photo, scan a barcode, type what you ate, or quickly re-add something recent.",
      disableBeacon: true
    },
    {
      target: '[data-tour="workout-markers"]',
      content: "Workouts count too. The strength session this morning nudged today's calorie target up automatically.",
      disableBeacon: true
    },
    {
      target: '[data-tour="nav-summary"]',
      content: "The Insights tab shows your week at a glance: trends, patterns, gentle nudges. No strict macros.",
      placement: "top" as const,
      disableBeacon: true
    },
  ] as Step[];

  const handleTourCallback = (data: CallBackProps) => {
    if (!user) return;
    const activeKey = `wya_walkthrough_active_${user.id}`;
    const stageKey = `wya_walkthrough_stage_${user.id}`;
    const clearDemo = () => {
      localStorage.removeItem(`wya_demo_mode_${user.id}`);
      setIsDemoMode(false);
    };
    if (data.status === STATUS.SKIPPED) {
      clearDemo();
      localStorage.setItem(`wya_walkthrough_${user.id}`, "true");
      localStorage.removeItem(activeKey);
      localStorage.removeItem(stageKey);
      setRunTour(false);
      return;
    }
    if (data.type === "step:after" && data.index === steps.length - 1) {
      // Keep demo mode ON — SummaryScreen needs it to show example data during its tour
      localStorage.setItem(activeKey, "true");
      localStorage.setItem(stageKey, "summary");
      setRunTour(false);
      router.push("/summary");
    }
  };

  return (
    <div className="min-h-screen bg-surface">
      {typeof window !== "undefined" && (
        <Joyride
          steps={steps}
          run={runTour}
          continuous
          showSkipButton
          hideCloseButton
          disableOverlayClose
          callback={handleTourCallback}
          locale={{
            skip: "Skip",
            back: "Back",
            last: "Next",
            close: "Skip"
          }}
          styles={{
            options: {
              primaryColor: "#6FA8FF",
              textColor: "#1F2937",
              backgroundColor: "#FFFFFF",
              arrowColor: "#FFFFFF"
            },
            buttonClose: {
              display: "none"
            },
            buttonSkip: {
              display: "block"
            }
          }}
        />
      )}
      {showTourGate && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="flex max-w-xs flex-col items-center gap-4 text-center">
            <div className="w-full px-5 py-1 text-center">
              <p className="text-[26px] font-semibold text-ink/80">
                Hey{" "}
                {profile?.firstName ||
                  (user as { user_metadata?: Record<string, string> })?.user_metadata?.first_name ||
                  "there"}
              </p>
            </div>
            <div className="space-y-1 text-sm text-ink/70">
              <p className="text-[15px] font-semibold text-ink/80">Thanks for joining!</p>
              <p>
                We help you log meals and workouts so you can spot patterns, get gentle nudges, and
                make small changes that add up over time. Take the walkthrough to get started.
              </p>
            </div>
            <button
              type="button"
              className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] ring-1 ring-white/40 transition hover:bg-primary/90"
              onClick={() => {
                if (!user) return;
                localStorage.setItem(`wya_demo_mode_${user.id}`, "true");
                localStorage.setItem(`wya_walkthrough_active_${user.id}`, "true");
                localStorage.setItem(`wya_walkthrough_stage_${user.id}`, "home");
                setIsDemoMode(true);
                window.dispatchEvent(new Event("wya_demo_mode_on"));
                setShowTourGate(false);
                setRunTour(true);
              }}
            >
              Start Walkthrough
            </button>
            <button
              type="button"
              className="text-xs text-ink/55 underline underline-offset-2 transition hover:text-ink/70"
              onClick={() => setShowTourGate(false)}
            >
              Explore on my own
            </button>
          </div>
        </div>
      )}
      {workout.showStartWorkoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink">Log a workout</h2>
            {workout.activeWorkout ? (
              <>
                <p className="mt-2 text-sm text-muted/70">A workout is already in progress.</p>
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                    onClick={() => workout.setShowStartWorkoutModal(false)}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-4 space-y-2">
                  <button
                    type="button"
                    className="flex w-full flex-col items-start rounded-xl bg-primary px-4 py-3 text-left transition hover:bg-primary/90"
                    onClick={workout.handleStartWorkout}
                  >
                    <span className="text-sm font-semibold text-white">Start Workout</span>
                    <span className="mt-0.5 text-xs text-white/70">Begin tracking time</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start rounded-xl border border-ink/10 bg-white px-4 py-3 text-left transition hover:bg-ink/5"
                    onClick={() => {
                      workout.setShowStartWorkoutModal(false);
                      workout.openManualWorkoutModal();
                    }}
                  >
                    <span className="text-sm font-semibold text-ink">Manually Add Workout</span>
                    <span className="mt-0.5 text-xs text-muted/60">Log a workout you already completed</span>
                  </button>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    className="text-xs font-semibold text-ink/50"
                    onClick={() => workout.setShowStartWorkoutModal(false)}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {workout.showEndWorkoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink">End workout</h2>
            <p className="mt-2 text-sm text-muted/70">
              {workout.activeWorkout ? "Confirm your workout details." : "No active workout in progress."}
            </p>
            {workout.activeWorkout && (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                    Workout type
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {WORKOUT_TYPE_OPTIONS.map((type) => (
                      <button
                        key={type}
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          workout.selectedWorkoutTypes.includes(type)
                            ? "border-primary/30 bg-primary/10 text-ink"
                            : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"
                        }`}
                        onClick={() => workout.toggleWorkoutType(type)}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                    Intensity
                  </p>
                  <div className="mt-2 flex gap-2">
                    {([
                      { value: "low", label: "Low" },
                      { value: "medium", label: "Medium" },
                      { value: "high", label: "High" }
                    ] as const).map((level) => (
                      <button
                        key={level.value}
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          workout.selectedIntensity === level.value
                            ? "border-primary/30 bg-primary/10 text-ink"
                            : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"
                        }`}
                        onClick={() => workout.setSelectedIntensity(level.value)}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => workout.setShowEndWorkoutModal(false)}
              >
                Close
              </button>
              {workout.activeWorkout && (
                <button
                  type="button"
                  disabled={workout.isEndingWorkout}
                  className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                  onClick={workout.handleEndWorkout}
                >
                  {workout.isEndingWorkout ? "Ending…" : "End workout"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {pendingDelete && !meals.editingMeal && !workout.editingWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            {(() => {
              const isSupp = pendingDelete.type === "meal" &&
                meals.meals.find((m) => m.id === pendingDelete.id)?.analysisJson?.source === "supplement";
              const label = isSupp ? "Supplement" : pendingDelete.type === "meal" ? "Meal" : "Workout";
              return (
                <>
                  <h2 className="text-base font-semibold text-ink">Delete {label}</h2>
                  <p className="mt-2 text-sm text-muted/70">
                    Are you sure you want to delete this {label.toLowerCase()}?
                  </p>
                </>
              );
            })()}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => setPendingDelete(null)}
                disabled={deletingItem}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                onClick={handleConfirmDelete}
                disabled={deletingItem}
              >
                {deletingItem ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 pt-6">
        <header className="mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-ink">
                WhatYouAt<span className="relative inline-block">e
                  <span className="absolute -top-1 right-0 translate-x-[10px] text-[9px] font-semibold text-ink/60">
                    AI
                  </span>
                </span>
              </h1>
              <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-semibold text-primary">
                BETA
              </span>
            </div>
            <Link
              href="/profile"
              data-tour="nav-profile"
              className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-ink/15 bg-ink/5 hover:bg-ink/10"
              onClick={() => {
                if (!user || !showProfileBell) return;
                const openedKey = `wya_profile_prompt_opened_${user.id}`;
                const lastPromptKey = `wya_profile_prompt_last_${user.id}`;
                const now = Date.now();
                localStorage.setItem(openedKey, String(now));
                localStorage.setItem(lastPromptKey, String(now));
                setShowProfileBell(false);
                window.dispatchEvent(new CustomEvent("profile-prompt-opened"));
              }}
            >
              {user?.user_metadata?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.user_metadata.avatar_url} alt="Profile" className="h-full w-full object-cover" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-ink/50">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                </svg>
              )}
              {showProfileBell && (
                <span className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-primary/40 bg-primary text-[8px] text-white animate-pulse shadow-[0_4px_10px_rgba(15,23,42,0.18)]">
                  <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" />
                    <path d="M9 17a3 3 0 0 0 6 0" />
                  </svg>
                </span>
              )}
            </Link>
          </div>
          <p className="mt-1 pl-0.5 text-[13px] text-muted/70">Eat Confidently</p>
          {!loadingData && mealCount === 0 && !isDemoMode && (
            <p className="mt-3 text-[11px] text-muted/60">
              Take a photo of your first meal to get started.
            </p>
          )}
          {loadError && <p className="mt-2 text-[11px] text-muted/60">{loadError}</p>}
        </header>

        {/* Trial progress / expired banner */}
        {!isDemoMode && trial.isTrialActive && (
          <button
            type="button"
            onClick={openUpgradeModal}
            className="mt-4 w-full rounded-xl border border-primary/15 bg-primary/[0.08] px-4 py-2.5 text-left transition active:opacity-70"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink/60">
                Day {trial.currentDay} of 7 free
              </span>
              <span className="text-[11px] text-primary/70 font-medium">See plans</span>
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-ink/10">
              <div
                className="h-full rounded-full bg-primary/50 transition-all"
                style={{ width: `${(trial.currentDay / 7) * 100}%` }}
              />
            </div>
          </button>
        )}
        {!isDemoMode && trial.isFree && (
          <button
            type="button"
            onClick={openUpgradeModal}
            className="mt-4 w-full rounded-xl border border-primary/25 bg-primary/10 px-4 py-2.5 text-left transition active:opacity-70"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink/60">Free trial ended</span>
              <span className="text-[11px] text-primary font-semibold">Upgrade now →</span>
            </div>
          </button>
        )}

        {!loadingData && !isDemoMode && displayMeals.filter((m) => m.analysisJson?.source !== "supplement").length >= 1 && (!profile || (profile.height === null && profile.weight === null && profile.age === null)) && (
          <Card className="mt-4 border border-primary/20 bg-primary/5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink/80">Add your stats for a personalized calorie and protein target.</p>
              <Link href="/profile" className="shrink-0 text-xs font-semibold text-primary underline">
                Set up
              </Link>
            </div>
          </Card>
        )}


        <Card className="mt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Today</p>
              {recentlyLogged && (
                <span className="animate-log-flash text-[11px] font-semibold text-primary/80">✓ Logged</span>
              )}
            </div>
            {streak >= 1 && (() => {
              const todayMeals = meals.meals.filter(
                (m) => m.analysisJson?.source !== "supplement" && m.status !== "failed" && dayKeyFromTs(m.ts) === todayKey()
              );
              const atRisk = todayMeals.length === 0 && new Date().getHours() >= 18;
              return (
                <div className="flex flex-col items-end gap-1">
                  <div className={`flex items-center gap-1 rounded-full px-2.5 py-1 bg-primary/10 ${streakSaverInfo ? "animate-wiggle" : ""}`}>
                    <svg width="16" height="18" viewBox="0 0 13 15" fill="none" aria-hidden="true" className={atRisk ? "" : "animate-flame"}>
                      <defs>
                        <linearGradient id="flame-grad" x1="0" y1="15" x2="0" y2="0" gradientUnits="userSpaceOnUse">
                          <stop offset="0%" stopColor="#ea580c" />
                          <stop offset="50%" stopColor="#f97316" />
                          <stop offset="100%" stopColor="#fbbf24" />
                        </linearGradient>
                        <linearGradient id="flame-inner" x1="0" y1="12" x2="0" y2="7.5" gradientUnits="userSpaceOnUse">
                          <stop offset="0%" stopColor="#fde68a" />
                          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.9" />
                        </linearGradient>
                      </defs>
                      <path d="M6.5 0C6.5 0 4 3.5 4 6C4 6.5 4.1 7 4.3 7.4C3.5 6.6 3.2 5.5 3.2 5.5C1.8 7 1 8.8 1 11C1 13.2 3.5 15 6.5 15C9.5 15 12 13.2 12 11C12 8.2 9.5 5.5 9.5 5.5C9.5 7 8.8 8 8 8.5C8.2 8 8.3 7.4 8.3 6.8C8.3 4.2 6.5 0 6.5 0Z" fill="url(#flame-grad)"/>
                      <path d="M6.5 7.5C6.2 8.5 6 9.2 6 10C6 11.1 6.2 11.8 6.5 12C6.8 11.8 7 11.1 7 10C7 9.2 6.8 8.5 6.5 7.5Z" fill="url(#flame-inner)"/>
                    </svg>
                    <span className="text-[13px] font-semibold text-primary">{streak}</span>
                    {atRisk && <span className="text-[11px] text-primary/70 font-medium">Log to save</span>}
                  </div>
                  {streakSaverInfo && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="text-[11px] font-medium text-primary/70 underline underline-offset-2 transition active:opacity-60"
                        onClick={() => {
                          meals.openManualMealEntry();
                          meals.setManualDate(streakSaverInfo.yesterdayStr);
                        }}
                      >
                        Log yesterday to save your streak!
                      </button>
                      <button
                        type="button"
                        className="text-ink/50 transition active:opacity-60"
                        onClick={() => {
                          if (user) localStorage.setItem(`wya_streak_saver_dismissed_${user.id}_${todayKey()}`, "true");
                          setStreakSaverDismissed(true);
                        }}
                        aria-label="Dismiss"
                      >
                        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/60">Calories</p>
              <p className="mt-1 text-2xl font-semibold">
                {formatClean(homeMarkers.todayTotals.calories_min, homeMarkers.todayTotals.calories_max)}
              </p>
              <p className="text-[10px] text-muted/65">approx.</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted/60">Protein</p>
              <p className="mt-1 text-2xl font-semibold">
                {formatClean(
                  homeMarkers.todayTotals.protein_g_min,
                  homeMarkers.todayTotals.protein_g_max,
                  "g"
                )}
              </p>
              <p className="text-[10px] text-muted/65">approx.</p>
            </div>
          </div>
          {mealCount > 0 && (
            <div className="mt-3 flex gap-3">
              <div className="flex-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-ink/5">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${barsReady ? calPct : 0}%`, transition: "width 700ms cubic-bezier(0.22,1,0.36,1)" }} />
                </div>
              </div>
              <div className="flex-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-ink/5">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${barsReady ? protPct : 0}%`, transition: "width 700ms cubic-bezier(0.22,1,0.36,1) 80ms" }} />
                </div>
              </div>
            </div>
          )}
          <button
            type="button"
            className="mt-2 flex items-center gap-1 text-left text-xs text-muted/70 transition active:opacity-60"
            onClick={() => setShowTargetInfo((v) => !v)}
          >
            <span>Suggested range<span className="text-muted/65">{!loadingData && mealCount === 0 && !profile ? " (preview)" : ""}</span>: {gentleTargetsDisplay.calories} kcal · {gentleTargetsDisplay.protein} g protein</span>
            <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-muted/40 text-[8px] text-muted/65">i</span>
          </button>
          {showTargetInfo && (
            <p className="mt-1 text-[10px] text-muted/65">
              {mealCount >= 10 && profile?.weight
                ? "Based on your recent intake pattern, adjusted for your goal."
                : profile?.weight && profile?.activityLevel
                ? "Based on your weight, activity level, and goal."
                : "Standard estimate · complete your profile to personalize."}
            </p>
          )}
        </Card>

        <div className="mt-4 h-px w-full bg-ink/5" />
        <div className="mt-4 space-y-4">
          <input
            ref={foodInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handleFoodFileSelected}
          />
          <div data-tour="food-action">
          <button
            type="button"
            className="block w-full rounded-xl bg-primary px-5 py-4 text-center text-base font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] ring-1 ring-white/40 transition hover:bg-primary/90 active:scale-[0.98]"
            onClick={handleFoodPhotoClick}
          >
            Take Food Photo
          </button>
          <div className="mt-1 flex w-[92%] mx-auto">
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-2 rounded-l-xl rounded-r-none bg-primary px-3 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(15,23,42,0.14)] ring-1 ring-white/40 transition-all duration-150 hover:bg-primary/90 active:translate-y-[1px] active:shadow-[0_3px_10px_rgba(15,23,42,0.18)]"
              onClick={meals.openManualMealEntry}
            >
              <span>+</span>
              <span>Manual Add</span>
            </button>
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-2 rounded-none border-l border-white/30 bg-primary px-3 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(15,23,42,0.14)] ring-1 ring-white/40 transition-all duration-150 hover:bg-primary/90 active:translate-y-[1px] active:shadow-[0_3px_10px_rgba(15,23,42,0.18)]"
              onClick={() => setBarcodeOpen(true)}
            >
              <span>▦</span>
              <span>Barcode</span>
            </button>
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-2 rounded-r-xl rounded-l-none border-l border-white/30 bg-primary px-3 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(15,23,42,0.14)] ring-1 ring-white/40 transition-all duration-150 hover:bg-primary/90 active:translate-y-[1px] active:shadow-[0_3px_10px_rgba(15,23,42,0.18)]"
              onClick={handleOpenQuickAdd}
            >
              <span>+</span>
              <span>Quick Add</span>
            </button>
          </div>
          </div>
          <div className="mx-auto flex w-[84%] text-xs" data-tour="workout-markers">
            <button
              type="button"
              className="flex flex-1 items-center justify-center rounded-l-xl rounded-r-none border border-ink/10 bg-white px-3 py-1.5 text-center font-normal text-ink/60 shadow-[0_4px_12px_rgba(15,23,42,0.08)] transition-all duration-150 hover:bg-ink/5 active:translate-y-[1px]"
              onClick={() => workout.setShowStartWorkoutModal(true)}
            >
              Start Workout
            </button>
            <button
              type="button"
              className="flex flex-1 items-center justify-center rounded-r-xl rounded-l-none border border-l-0 border-ink/10 bg-white px-3 py-1.5 text-center font-normal text-ink/60 shadow-[0_4px_12px_rgba(15,23,42,0.08)] transition-all duration-150 hover:bg-ink/5 active:translate-y-[1px]"
              onClick={() => workout.setShowEndWorkoutModal(true)}
            >
              End Workout
            </button>
          </div>
          {workout.activeWorkout && (
            <p className="text-center text-[11px] text-muted/60">Workout in progress</p>
          )}
        </div>

        <Card className="mt-7">
          <div className="flex items-start justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Recent</p>
            <div className="flex items-center gap-2">
              {editRecents && (
                <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary shadow-[0_6px_14px_rgba(15,23,42,0.08)]">
                  Editing
                </span>
              )}
              <button
                type="button"
                className="text-[11px] font-semibold text-ink/70 underline"
                onClick={() => setEditRecents((prev) => !prev)}
              >
                {editRecents ? "Done" : "Edit"}
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 text-[10px] font-semibold uppercase tracking-wide text-muted/60">
            <span className="col-span-2">Food</span>
            <span className="col-span-1 text-right">Workout</span>
          </div>
          <div className="mt-3 space-y-4 text-sm text-ink/80">
            {(() => {
              let pillIdx = 0;
              return groupedRecent.slice(0, visibleGroupCount).map((group) => (
              <div key={group.label}>
                {group.label !== "Today" && (() => {
                  const calSum = group.meals.reduce((acc, m) => {
                    if (m.analysisJson?.source === "supplement") return acc;
                    const v = m.calories ?? Math.round((m.analysisJson.estimated_ranges.calories_min + m.analysisJson.estimated_ranges.calories_max) / 2);
                    return acc + v;
                  }, 0);
                  const protSum = group.meals.reduce((acc, m) => {
                    if (m.analysisJson?.source === "supplement") return acc;
                    const v = m.protein ?? Math.round((m.analysisJson.estimated_ranges.protein_g_min + m.analysisJson.estimated_ranges.protein_g_max) / 2);
                    return acc + v;
                  }, 0);
                  return (
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                      {group.label}{group.meals.length > 0 ? <span className="text-[10px] font-normal normal-case tracking-normal text-muted/60"> · {calSum} kcal · {protSum}g protein</span> : ""}
                    </p>
                  );
                })()}
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-2">
                    {group.meals.map((meal) => {
                      const idx = pillIdx++;
                      const isShimmer = meal.status === "processing" && Date.now() - meal.ts < 90_000;
                      return (
                      <div
                        key={`${meal.id}-${meal.calories}-${meal.protein}`}
                        onClick={() => {
                          if (!editRecents) return;
                          if (meal.analysisJson?.source === "supplement") {
                            setPendingDelete({ type: "meal", id: meal.id });
                          } else {
                            meals.openMealEditor(meal);
                          }
                        }}
                        className={`inline-flex w-full items-start justify-between rounded-full border border-primary/20 px-3 py-1.5 text-xs text-ink/80 ${editRecents ? "cursor-pointer animate-wiggle bg-primary/10" : (isShimmer ? "animate-shimmer" : "animate-pill-in bg-primary/10")}`}
                        style={{
                          ...(isShimmer ? { background: "linear-gradient(90deg, #dbeafe 0%, #bfdbfe 40%, #dbeafe 60%, #dbeafe 100%)", backgroundSize: "200% 100%" } : {}),
                          ...(!editRecents && !isShimmer ? { animationDelay: `${idx * 35}ms` } : {})
                        }}
                      >
                        <span className="flex flex-col">
                          {meal.status === "processing" ? (
                            isShimmer ? "Analyzing food…" : "Analysis failed · edit manually"
                          ) : meal.status === "failed" ? (
                            "Analysis failed · edit manually"
                          ) : (
                            <>
                              <span>
                                {(() => {
                                  const displayName =
                                    meal.analysisJson?.name ??
                                    meal.analysisJson?.detected_items?.[0]?.name ??
                                    "Meal";
                                  return formatTitle(displayName);
                                })()}
                              </span>
                              {meal.analysisJson?.source === "supplement" ? (
                                <span className="text-ink/55">added to your day</span>
                              ) : (
                                <span className="text-ink/50">
                                  {meal.calories
                                    ? `${meal.calories} kcal`
                                    : formatClean(
                                        meal.analysisJson.estimated_ranges.calories_min,
                                        meal.analysisJson.estimated_ranges.calories_max,
                                        "kcal"
                                      )}{" "}
                                  ·{" "}
                                  {meal.protein
                                    ? `${meal.protein}g protein`
                                    : formatClean(
                                        meal.analysisJson.estimated_ranges.protein_g_min,
                                        meal.analysisJson.estimated_ranges.protein_g_max,
                                        "g"
                                      ) + " protein"}
                                </span>
                              )}
                            </>
                          )}
                        </span>
                      </div>
                    ); })}
                  </div>
                  <div className="col-span-1 space-y-2 border-l border-ink/5 pl-2">
                    {group.workouts.map((w) => (
                      <div
                        key={w.id}
                        onClick={() => {
                          if (editRecents) workout.openWorkoutEditor(w);
                        }}
                        className={`flex w-full flex-col items-center justify-center rounded-full border border-ink/10 bg-ink/5 px-3 py-0.5 text-[11px] text-ink/70 leading-tight ${editRecents ? "cursor-pointer animate-wiggle-neutral" : ""}`}
                      >
                        <span className="font-semibold text-ink/70">
                          {formatWorkoutDurationLines(w).title}
                        </span>
                        <span className="-mt-0.5">{formatWorkoutDurationLines(w).detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ));
            })()}
            {visibleGroupCount < groupedRecent.length && (
              <button
                type="button"
                className="mt-1 text-[11px] font-semibold text-ink/50 underline transition active:opacity-50"
                onClick={() => setVisibleGroupCount((prev) => prev + 3)}
              >
                Show more
              </button>
            )}
            {!loadingData && recentItems.length === 0 ? (
              mealCount === 0 && displayWorkouts.length === 0 ? (
                <div className="inline-flex items-start rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs text-ink/80">
                  <span className="flex flex-col">
                    <span>Chicken Bowl <span className="text-ink/35">(example)</span></span>
                    <span className="text-ink/50">600 kcal · 40g protein</span>
                  </span>
                </div>
              ) : (
                <p className="text-muted/70">No food or workouts yet.</p>
              )
            ) : null}
          </div>
        </Card>
      </div>

      {meals.editingMeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            {pendingDelete?.type === "meal" ? (
              <>
                <h3 className="text-base font-semibold text-ink">Delete meal</h3>
                <p className="mt-2 text-sm text-muted/70">
                  Are you sure you want to delete this meal?
                </p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                    onClick={() => setPendingDelete(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                    onClick={handleConfirmDelete}
                    disabled={deletingItem}
                  >
                    {deletingItem ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </>
            ) : !meals.editingMeal.id ? (
              <>
                <h2 className="text-base font-semibold text-ink">Add Food</h2>
                {!meals.manualResult ? (
                  <>
                    <div className="mt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">What did you eat?</p>
                      <input
                        className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                        value={meals.manualText}
                        onChange={(e) => meals.setManualText(e.target.value)}
                        placeholder="e.g. chicken fettuccine, large bowl"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") meals.analyzeManualText(); }}
                      />
                    </div>
                    <ManualDateRow manualDate={meals.manualDate} setManualDate={meals.setManualDate} />
                    {meals.manualError && (
                      <p className="mt-3 text-xs text-red-500">{meals.manualError}</p>
                    )}
                    <div className="mt-5 flex justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                        onClick={() => { meals.setEditingMeal(null); setEditRecents(false); }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={`rounded-xl px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-50 ${meals.manualAnalysing ? "animate-shimmer" : "bg-primary hover:bg-primary/90"}`}
                        style={meals.manualAnalysing ? { background: "linear-gradient(90deg, #6FA8FF 0%, #93c5fd 40%, #6FA8FF 60%, #6FA8FF 100%)", backgroundSize: "200% 100%" } : undefined}
                        onClick={meals.analyzeManualText}
                        disabled={meals.manualAnalysing || !meals.manualText.trim()}
                      >
                        {meals.manualAnalysing ? "Analyzing…" : "Analyze"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mt-4">
                      <p className="text-sm font-semibold text-ink">{meals.manualResult.name ?? "Meal"}</p>
                      <p className="mt-1 text-xs text-muted/70">
                        {meals.manualScaledRanges && formatClean(meals.manualScaledRanges.calories_min, meals.manualScaledRanges.calories_max, "kcal")}
                        {meals.manualScaledRanges && " · "}
                        {meals.manualScaledRanges && formatClean(meals.manualScaledRanges.protein_g_min, meals.manualScaledRanges.protein_g_max, "g protein")}
                      </p>
                    </div>
                    <div className="mt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Portion size</p>
                      <div className="mt-2 flex gap-2">
                        {(["small", "medium", "large"] as const).map((p) => (
                          <button
                            key={p}
                            type="button"
                            className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition ${meals.manualPortion === p ? "border-primary/30 bg-primary/10 text-ink" : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"}`}
                            onClick={() => meals.setManualPortion(p)}
                          >
                            {p === "medium" ? "Average" : p.charAt(0).toUpperCase() + p.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <ManualDateRow manualDate={meals.manualDate} setManualDate={meals.setManualDate} />
                    <div className="mt-5 flex items-center justify-between">
                      <button
                        type="button"
                        className="text-xs text-ink/50 underline transition active:opacity-50"
                        onClick={() => { meals.clearManualTextCache(); meals.setManualResult(null); }}
                      >
                        Try again
                      </button>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                          onClick={() => { meals.setEditingMeal(null); setEditRecents(false); }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                          onClick={meals.confirmManualMeal}
                          disabled={meals.updatingMeal}
                        >
                          {meals.updatingMeal ? "Adding…" : "Add"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-ink">Edit Meal</h2>
                {meals.editingMeal.imageThumb && (
                  <img
                    src={meals.editingMeal.imageThumb}
                    alt="Meal photo"
                    className="mt-3 h-32 w-full rounded-lg object-cover"
                  />
                )}
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Portion size</p>
                  <div className="mt-2 flex gap-2">
                    {(["small", "medium", "large"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`flex-1 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${editPortion === p ? "border-primary/30 bg-primary/10 text-ink" : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"}`}
                        onClick={() => applyEditPortion(p)}
                      >
                        {p === "medium" ? "Average" : p.charAt(0).toUpperCase() + p.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Name</p>
                    <input
                      className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      value={meals.editForm.name}
                      onChange={(e) => meals.setEditForm({ ...meals.editForm, name: e.target.value })}
                      placeholder="Food name"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Calories</p>
                    <input
                      className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      value={meals.editForm.calories}
                      onChange={(e) => meals.setEditForm({ ...meals.editForm, calories: e.target.value })}
                      placeholder="kcal"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Protein</p>
                    <input
                      className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      value={meals.editForm.protein}
                      onChange={(e) => meals.setEditForm({ ...meals.editForm, protein: e.target.value })}
                      placeholder="g"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Carbs</p>
                    <input
                      className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      value={meals.editForm.carbs}
                      onChange={(e) => meals.setEditForm({ ...meals.editForm, carbs: e.target.value })}
                      placeholder="g"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Fat</p>
                    <input
                      className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      value={meals.editForm.fat}
                      onChange={(e) => meals.setEditForm({ ...meals.editForm, fat: e.target.value })}
                      placeholder="g"
                      inputMode="numeric"
                    />
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between">
                  <button
                    type="button"
                    className="text-sm text-red-600"
                    onClick={() => setPendingDelete({ type: "meal", id: meals.editingMeal!.id })}
                  >
                    Delete
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                      onClick={() => { meals.setEditingMeal(null); setEditRecents(false); }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                      onClick={meals.handleUpdateMeal}
                      disabled={meals.updatingMeal}
                    >
                      {meals.updatingMeal ? "Updating..." : "Update"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {failedMealPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink">What did you eat?</h2>
            <p className="mt-1 text-xs text-muted/70">The photo was unclear. Type what you had and we'll estimate the nutrition.</p>
            {failedMealPrompt.thumb && (
              <img src={failedMealPrompt.thumb} alt="Meal photo" className="mt-3 h-28 w-full rounded-lg object-cover opacity-60" />
            )}
            <div className="mt-4">
              <input
                className="w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                value={failedMealText}
                onChange={(e) => setFailedMealText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && failedMealText.trim()) handleFailedMealSubmit(); }}
                placeholder="e.g. grilled chicken and rice"
                autoFocus
              />
            </div>
            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                className="text-xs text-ink/50 underline"
                onClick={handleFailedMealDismiss}
              >
                Remove
              </button>
              <button
                type="button"
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                onClick={handleFailedMealSubmit}
                disabled={failedMealAnalyzing || !failedMealText.trim()}
              >
                {failedMealAnalyzing ? "Analyzing…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {quickConfirmMeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink">What did you eat?</h2>
            <p className="mt-1 text-xs text-muted/70">
              {(() => {
                const conf = quickConfirmMeal.analysisJson?.confidence_overall_0_1 ?? 1;
                const wide = quickConfirmMeal.analysisJson?.precision_mode_available === true;
                if (conf < 0.55) return "Couldn't identify this clearly. Correct anything that looks off.";
                if (conf < 0.7) return "Portion was tricky to estimate. Adjust if needed.";
                if (wide) return "Wide calorie range on this one. Confirm to sharpen the estimate.";
                return "Does this look right? Correct anything that seems off.";
              })()}
            </p>
            {quickConfirmMeal.imageThumb && (
              <img
                src={quickConfirmMeal.imageThumb}
                alt="Meal photo"
                className="mt-3 h-32 w-full rounded-lg object-cover"
              />
            )}
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Food name</p>
              <input
                className="mt-1 w-full rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                value={quickConfirmName}
                onChange={(e) => setQuickConfirmName(e.target.value)}
                placeholder="e.g. chicken salad"
                autoFocus
              />
            </div>
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Portion size</p>
              <div className="mt-2 flex gap-2">
                {(["small", "medium", "large"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition ${quickConfirmPortion === p ? "border-primary/30 bg-primary/10 text-ink" : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"}`}
                    onClick={() => setQuickConfirmPortion(p)}
                  >
                    {p === "medium" ? "Average" : p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                className="text-xs text-ink/50 underline"
                onClick={() => setQuickConfirmMeal(null)}
              >
                Skip
              </button>
              <button
                type="button"
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                onClick={handleQuickConfirm}
                disabled={quickConfirming || !quickConfirmName.trim()}
              >
                {quickConfirming ? "Saving…" : "Looks good"}
              </button>
            </div>
          </div>
        </div>
      )}

      {workout.editingWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            {pendingDelete?.type === "workout" ? (
              <>
                <h2 className="text-base font-semibold text-ink">Delete workout</h2>
                <p className="mt-2 text-sm text-muted/70">
                  Are you sure you want to delete this workout?
                </p>
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                    onClick={() => setPendingDelete(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                    onClick={handleConfirmDelete}
                    disabled={deletingItem}
                  >
                    {deletingItem ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-ink">Edit workout</h2>
                <p className="mt-2 text-sm text-muted/70">Update your workout details.</p>

                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                      Duration
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        className="w-16 rounded-lg border border-ink/10 bg-white px-3 py-2 text-xs text-ink/80"
                        value={workout.workoutEditHours}
                        onChange={(e) => workout.setWorkoutEditHours(e.target.value)}
                        placeholder="0"
                      />
                      <span className="text-xs text-muted/70">hrs</span>
                      <input
                        className="w-16 rounded-lg border border-ink/10 bg-white px-3 py-2 text-xs text-ink/80"
                        value={workout.workoutEditMinutes}
                        onChange={(e) => workout.setWorkoutEditMinutes(e.target.value)}
                        placeholder="0"
                      />
                      <span className="text-xs text-muted/70">mins</span>
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                      Workout type
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {WORKOUT_TYPE_OPTIONS.map((type) => (
                        <button
                          key={type}
                          type="button"
                          className={`rounded-full border px-3 py-1 text-xs transition ${
                            workout.workoutEditTypes.includes(type)
                              ? "border-primary/30 bg-primary/10 text-ink"
                              : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"
                          }`}
                          onClick={() =>
                            workout.setWorkoutEditTypes((prev) =>
                              prev.includes(type)
                                ? prev.filter((item) => item !== type)
                                : [...prev, type]
                            )
                          }
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                      Intensity
                    </p>
                    <div className="mt-2 flex gap-2">
                      {([
                        { value: "low", label: "Low" },
                        { value: "medium", label: "Medium" },
                        { value: "high", label: "High" }
                      ] as const).map((level) => (
                        <button
                          key={level.value}
                          type="button"
                          className={`rounded-full border px-3 py-1 text-xs transition ${
                            workout.workoutEditIntensity === level.value
                              ? "border-primary/30 bg-primary/10 text-ink"
                              : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"
                          }`}
                          onClick={() =>
                            workout.setWorkoutEditIntensity(
                              workout.workoutEditIntensity === level.value ? "" : level.value
                            )
                          }
                        >
                          {level.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between">
                  <button
                    type="button"
                    className="text-sm text-red-600"
                    onClick={() => setPendingDelete({ type: "workout", id: workout.editingWorkout!.id })}
                  >
                    Delete
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                      onClick={() => {
                        workout.setEditingWorkout(null);
                        setEditRecents(false);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={`rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 ${
                        workout.updatingWorkout ? "opacity-70" : ""
                      }`}
                      onClick={workout.handleUpdateWorkout}
                      disabled={workout.updatingWorkout}
                    >
                      {workout.updatingWorkout ? "Updating..." : "Update"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Manual workout modal */}
      {workout.showManualWorkoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-ink">Add workout</h2>
            <p className="mt-1 text-sm text-muted/70">Log a workout you already completed.</p>

            <div className="mt-4 space-y-4">
              <div className="overflow-hidden">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                  Date
                </p>
                <input
                  type="date"
                  className="mt-2 w-auto rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-xs text-ink/80"
                  value={workout.manualDate}
                  max={(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })()}
                  onChange={(e) => workout.setManualDate(e.target.value)}
                />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                  Duration
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    className="w-12 rounded-lg border border-ink/10 bg-white px-2 py-1.5 text-xs text-ink/80"
                    value={workout.manualHours}
                    onChange={(e) => workout.setManualHours(e.target.value)}
                    placeholder="0"
                    inputMode="numeric"
                  />
                  <span className="text-xs text-muted/70">hrs</span>
                  <input
                    className="w-12 rounded-lg border border-ink/10 bg-white px-2 py-1.5 text-xs text-ink/80"
                    value={workout.manualMinutes}
                    onChange={(e) => workout.setManualMinutes(e.target.value)}
                    placeholder="0"
                    inputMode="numeric"
                  />
                  <span className="text-xs text-muted/70">mins</span>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                  Workout type
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WORKOUT_TYPE_OPTIONS.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        workout.manualTypes.includes(type)
                          ? "border-primary/30 bg-primary/10 text-ink"
                          : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"
                      }`}
                      onClick={() =>
                        workout.setManualTypes((prev) =>
                          prev.includes(type)
                            ? prev.filter((item) => item !== type)
                            : [...prev, type]
                        )
                      }
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                  Intensity
                </p>
                <div className="mt-2 flex gap-2">
                  {([
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" }
                  ] as const).map((level) => (
                    <button
                      key={level.value}
                      type="button"
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        workout.manualIntensity === level.value
                          ? "border-primary/30 bg-primary/10 text-ink"
                          : "border-ink/10 bg-white text-ink/70 hover:bg-ink/5"
                      }`}
                      onClick={() =>
                        workout.setManualIntensity(
                          workout.manualIntensity === level.value ? "" : level.value
                        )
                      }
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => {
                  workout.setShowManualWorkoutModal(false);
                  workout.setManualHours("");
                  workout.setManualMinutes("");
                  workout.setManualTypes([]);
                  workout.setManualIntensity("");
                  const d = new Date();
                  workout.setManualDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 ${
                  workout.addingManual ? "opacity-70" : ""
                }`}
                onClick={workout.handleAddManualWorkout}
                disabled={workout.addingManual}
              >
                {workout.addingManual ? "Saving..." : "Save workout"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode looking up */}
      {barcodeLookingUp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 pointer-events-none">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-2xl">
            <svg className="h-8 w-8 animate-spin text-primary" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
        </div>
      )}

      {/* Barcode product confirmation */}
      {barcodeProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink">{barcodeProduct.name}</p>
                {barcodeProduct.brand && (
                  <p className="text-xs text-muted/60">{barcodeProduct.brand}</p>
                )}
              </div>
              {barcodeFromCache && (
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Saved</span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Cal", value: barcodeProduct.calories ?? "?" },
                { label: "Protein", value: barcodeProduct.protein != null ? `${barcodeProduct.protein}g` : "?" },
                { label: "Carbs", value: barcodeProduct.carbs != null ? `${barcodeProduct.carbs}g` : "?" },
                { label: "Fat", value: barcodeProduct.fat != null ? `${barcodeProduct.fat}g` : "?" },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-ink/5 px-2 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted/60">{label}</p>
                  <p className="mt-0.5 text-sm font-semibold text-ink">{value}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted/65">
              Per {barcodeProduct.valuePer === "100g" ? "100g" : "serving"}
            </p>
            {barcodeProduct.valuePer === "100g" && !barcodeEditMode && (
              <div className="mt-3 flex items-center gap-2">
                <label className="text-xs text-muted/60">How many grams?</label>
                <input
                  type="number"
                  inputMode="numeric"
                  className="w-20 rounded-lg border border-ink/10 bg-white px-2 py-1 text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  value={barcodeGrams}
                  min="1"
                  onChange={(e) => setBarcodeGrams(e.target.value)}
                />
                <span className="text-xs text-muted/60">g</span>
              </div>
            )}
            {!barcodeEditMode && (
              <button
                type="button"
                className="mt-3 rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/50 transition hover:border-ink/25 hover:text-ink/70"
                onClick={() => {
                  setBarcodeEdit({
                    name: barcodeProduct.name,
                    calories: String(barcodeProduct.calories ?? ""),
                    protein: String(barcodeProduct.protein ?? ""),
                    carbs: String(barcodeProduct.carbs ?? ""),
                    fat: String(barcodeProduct.fat ?? ""),
                  });
                  setBarcodeEditMode(true);
                }}
              >
                Incorrect?
              </button>
            )}
            {barcodeEditMode && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Correct the values</p>
                <input
                  className="w-full rounded-lg border border-ink/10 bg-white px-3 py-1.5 text-xs text-ink/80"
                  placeholder="Food name"
                  value={barcodeEdit.name}
                  onChange={(e) => setBarcodeEdit((p) => ({ ...p, name: e.target.value }))}
                />
                <div className="grid grid-cols-4 gap-2">
                  {(["calories", "protein", "carbs", "fat"] as const).map((field) => (
                    <div key={field}>
                      <p className="mb-1 text-[9px] uppercase tracking-wide text-muted/65">{field === "calories" ? "Cal" : field}</p>
                      <input
                        inputMode="numeric"
                        className="w-full rounded-lg border border-ink/10 bg-white px-2 py-1.5 text-xs text-ink/80"
                        value={barcodeEdit[field]}
                        onChange={(e) => setBarcodeEdit((p) => ({ ...p, [field]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => {
                  if (barcodeEditMode) { setBarcodeEditMode(false); return; }
                  setBarcodeProduct(null); setBarcodeGrams("100"); setBarcodeFromCache(false);
                }}
              >
                Cancel
              </button>
              {barcodeEditMode ? (
                <button
                  type="button"
                  className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                  onClick={handleSaveAndAddBarcode}
                  disabled={isAddingBarcode}
                >
                  {isAddingBarcode ? "Adding…" : "Save & Add"}
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                  onClick={handleConfirmBarcodeProduct}
                  disabled={isAddingBarcode}
                >
                  {isAddingBarcode ? "Adding…" : "Add to day"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Barcode not found */}
      {barcodeNotFound && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <p className="text-sm font-semibold text-ink">Product not found</p>
            <p className="mt-1 text-xs text-muted/70">This barcode isn&apos;t in our database. Try adding the meal manually.</p>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => setBarcodeNotFound(false)}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90"
                onClick={() => { setBarcodeNotFound(false); meals.openManualMealEntry(); }}
              >
                Add Manually
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode success */}
      {barcodeSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 pointer-events-none">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-primary shadow-2xl animate-circleImpact">
            <svg
              className="h-14 w-14 text-white animate-checkmark"
              viewBox="0 0 52 52"
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
            >
              <path d="M14 27 L22 35 L38 18" className="checkmark-path" />
            </svg>
          </div>
        </div>
      )}

      <BarcodeScannerOverlay
        open={barcodeOpen}
        onClose={() => setBarcodeOpen(false)}
        onDetected={handleBarcodeDetected}
      />

      {/* Quick Add modal */}
      {showQuickAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white px-5 pb-6 pt-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Quick Add</h2>
              <button
                type="button"
                className="text-xs text-ink/50 underline"
                onClick={() => setShowQuickAdd(false)}
              >
                Cancel
              </button>
            </div>
            {quickAddItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted/60">
                No saved foods yet · log some meals first to use Quick Add.
              </p>
            ) : (
              <div className="max-h-[55vh] overflow-y-auto space-y-2 pr-1">
                {quickAddItems.map((item) => {
                  const isSelected = !!quickAddSelected[item.key];
                  const portion = quickAddSelected[item.key] ?? "medium";
                  const portionMultiplier = isSelected ? (portion === "small" ? 0.7 : portion === "large" ? 1.4 : 1) : 1;
                  const midCal = item.type === "text" && item.ranges
                    ? Math.round(((item.ranges.calories_min + item.ranges.calories_max) / 2) * portionMultiplier)
                    : Math.round((item.calories ?? 0) * portionMultiplier);
                  const midProt = item.type === "text" && item.ranges
                    ? Math.round(((item.ranges.protein_g_min + item.ranges.protein_g_max) / 2) * portionMultiplier)
                    : Math.round((item.protein ?? 0) * portionMultiplier);
                  return (
                    <div
                      key={item.key}
                      className={`cursor-pointer rounded-xl border px-3 py-2.5 transition ${isSelected ? "border-primary/30 bg-primary/8" : "border-ink/8 bg-ink/[0.02]"}`}
                      onClick={() => {
                        setQuickAddSelected((prev) => {
                          if (prev[item.key]) {
                            const next = { ...prev };
                            delete next[item.key];
                            return next;
                          }
                          return { ...prev, [item.key]: "medium" };
                        });
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <div
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${isSelected ? "border-primary bg-primary" : "border-ink/20 bg-white"}`}
                        >
                          {isSelected && (
                            <svg viewBox="0 0 10 8" fill="none" stroke="white" strokeWidth="1.5" className="h-2.5 w-2.5">
                              <path d="M1 4 L3.5 6.5 L9 1" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-xs font-semibold text-ink">
                            {formatTitle(item.name)}
                          </p>
                          <p className="text-[10px] text-muted/80">
                            {midCal} kcal · {midProt}g protein
                            {item.type === "barcode" && item.brand ? ` · ${item.brand}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="ml-1 shrink-0 text-ink/50 hover:text-ink/70 active:scale-90 transition text-base leading-none"
                          onClick={(e) => { e.stopPropagation(); handleRemoveQuickAddItem(item); }}
                        >
                          ×
                        </button>
                      </div>
                      {isSelected && (
                        <div className="mt-2 flex gap-1.5">
                          {(["small", "medium", "large"] as const).map((p) => (
                            <button
                              key={p}
                              type="button"
                              className={`flex-1 rounded-lg border py-1 text-[10px] font-semibold transition ${portion === p ? "border-primary/30 bg-primary/15 text-ink" : "border-ink/10 bg-white text-ink/60 hover:bg-ink/5"}`}
                              onClick={(e) => { e.stopPropagation(); setQuickAddSelected((prev) => ({ ...prev, [item.key]: p })); }}
                            >
                              {p === "medium" ? "Avg" : p === "small" ? "Small" : "Large"}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {quickAddItems.length > 0 && (
              <>
                <ManualDateRow manualDate={quickAddDate} setManualDate={setQuickAddDate} />
              </>
            )}
            {quickAddItems.length > 0 && (
              <button
                type="button"
                className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                disabled={Object.keys(quickAddSelected).length === 0 || quickAddAdding}
                onClick={handleQuickAddConfirm}
              >
                {quickAddAdding
                  ? "Adding…"
                  : Object.keys(quickAddSelected).length === 0
                  ? "Select items to add"
                  : `Add ${Object.keys(quickAddSelected).length} item${Object.keys(quickAddSelected).length > 1 ? "s" : ""}`}
              </button>
            )}
          </div>
        </div>
      )}

      <BottomNav current="home" />
    </div>
  );
}
