"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Joyride, { CallBackProps, STATUS, type Step } from "react-joyride";
import { useRouter } from "next/navigation";
import type { MealLog, UserProfile, WorkoutSession } from "../lib/types";
import { suppName, suppLabel } from "../lib/types";
import { matchSupplementNutrients } from "../lib/rda";
import { celebrateDaily, celebrateBuilt, celebrateAccepted, unlockAudio } from "../lib/celebrate";
import { HABIT_TEMPLATES, habitsForGoals, type HabitTemplate } from "../lib/habits";
import { riseIn } from "../lib/motion";
import {
  PROFILE_UPDATED_EVENT,
  MEALS_FAILED_EVENT,
  notifyMealsUpdated,
  notifyWorkoutsUpdated
} from "../lib/dataEvents";
import { formatApprox, formatDateShort, todayKey, dayKeyFromTs } from "../lib/utils";
import { supabase } from "../lib/supabaseClient";
import "../lib/mealQueue";
import BarcodeScannerOverlay from "./BarcodeScannerOverlay";
import { getFoodCacheEntry, setFoodCacheEntry, deleteFoodCacheEntry, deleteFoodTextEntry, incrementFoodCacheLogCount, incrementFoodTextLogCount, getQuickAddFromMeals, addQuickAddRemoved, getDailySupplements, setDailySupplements, hasDailySuppsLoggedToday, markDailySuppsLoggedToday, clearDailySuppsLoggedToday, type QuickAddItem } from "../lib/foodCache";
import { addFeelLog, deleteFeelLog, updateFeelLog, fetchWaterLogs, upsertWaterLog, addWeightLog, saveProfile, addReflection, fetchReflections, fetchHabitState, saveHabitState, fetchHabitHistory, saveHabitHistory, type FeelLog } from "../lib/supabaseDb";
import { EMPTY_HABIT_STATE, pickSuggestionId, snoozeSuggestion, declineSuggestion, markHabitEnded, type HabitState, type ActiveBuilder, type HabitHistoryEntry } from "../lib/habitState";
import BottomNav from "./BottomNav";
import Card from "./Card";
import WaterBar from "./WaterBar";
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
import { getPendingReviewFlag, canShowReviewPrompt, checkAndSetMilestoneFlag } from "../lib/reviewPrompt";
import { openReviewPrompt } from "./ReviewPromptModal";
import OnboardingFlow from "./OnboardingFlow";
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
  return [
    { id: "demo-w1", startTs: at(6, 0), endTs: at(6, 45), durationMin: 45, workoutTypes: ["Strength"], intensity: "medium" },
  ];
}

function makeDemoFeelLogs(): FeelLog[] {
  const at = (h: number, m: number) => {
    const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime();
  };
  return [
    { id: "demo-feel-1", ts: at(8, 15), tag: "good_energy" },
    { id: "demo-feel-2", ts: at(14, 30), tag: "low_energy" },
  ];
}

const FEEL_OPTIONS = [
  { tag: "good_energy", label: "High Energy" },
  { tag: "low_energy", label: "Low Energy" },
] as const;

// Grouped by domain (Energy, Mood, Body), positive-leaning first within each,
// so related feelings sit together (e.g. energized near tired) and are easy to scan.
const FEELINGS = [
  // Energy
  { tag: "energized", label: "Energized" },
  { tag: "focused", label: "Focused" },
  { tag: "motivated", label: "Motivated" },
  { tag: "tired", label: "Tired" },
  { tag: "sluggish", label: "Sluggish" },
  { tag: "foggy", label: "Foggy" },
  // Mood
  { tag: "happy", label: "Happy" },
  { tag: "content", label: "Content" },
  { tag: "calm", label: "Calm" },
  { tag: "anxious", label: "Anxious" },
  { tag: "stressed", label: "Stressed" },
  { tag: "irritable", label: "Irritable" },
  // Body
  { tag: "hungry", label: "Hungry" },
  { tag: "bloated", label: "Bloated" },
  { tag: "nauseous", label: "Nauseous" },
  { tag: "headache", label: "Headache" },
] as const;

// Nightly reflection — the primary signal feeding the coach + habit triggers
// (feeling logs are the secondary, in-the-moment signal). All quick taps.
const RX_SVG = "h-10 w-10 text-primary/40";
const REFLECTION_QUESTIONS: { key: string; label: string; hint: string; opts: string[]; multi?: boolean; icon: JSX.Element }[] = [
  { key: "energy", label: "Overall Energy", hint: "How was your overall energy across the day?", opts: ["Drained", "Low", "Okay", "Good", "Great"],
    icon: <svg className={RX_SVG} viewBox="0 0 16 28" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 1L2 15h6l-2 12 10-16h-6l2-11z" /></svg> },
  { key: "dips", label: "Energy Dips", hint: "Did you have any energy dips today?", opts: ["None", "Morning", "Afternoon", "Evening"], multi: true,
    icon: <svg className={RX_SVG} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg> },
  { key: "sleep", label: "Last Night's Sleep", hint: "How well did you sleep last night?", opts: ["Poor", "Okay", "Good", "Great"],
    icon: <svg className={RX_SVG} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg> },
  { key: "mood", label: "Mood", hint: "How was your mood overall today?", opts: ["Poor", "Okay", "Good", "Great"],
    icon: <svg className={RX_SVG} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9.5" /><path d="M8.5 14.5c.9 1.1 2.1 1.7 3.5 1.7s2.6-.6 3.5-1.7" /><circle cx="9.2" cy="10.5" r="0.8" fill="currentColor" stroke="none" /><circle cx="14.8" cy="10.5" r="0.8" fill="currentColor" stroke="none" /></svg> },
  { key: "stress", label: "Stress", hint: "How much stress did you feel today?", opts: ["None", "Mild", "Moderate", "High"],
    icon: <svg className={RX_SVG} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg> },
  { key: "digestion", label: "Digestion", hint: "How did your digestion feel today?", opts: ["Poor", "Okay", "Good", "Great"],
    icon: <svg className={RX_SVG} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /></svg> },
];

function feelLabel(tag: string): string {
  const f = FEELINGS.find((x) => x.tag === tag);
  if (f) return f.label;
  const e = FEEL_OPTIONS.find((x) => x.tag === tag);
  if (e) return e.label;
  return tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Habit templates wired locally so we can flip through and test how each one
// renders before the engine/persistence exist. Starts on hydration (the reference).
const FIRST_TEMPLATE: HabitTemplate = HABIT_TEMPLATES.find((t) => t.id === "hydration-3") ?? HABIT_TEMPLATES[0];

function freshDays(t: HabitTemplate): boolean[][] {
  return Array.from({ length: t.durationDays }, () => Array(t.checkpoints.length).fill(false));
}

// Demo only: fill the {slots} in a whyTemplate with sample values. Real values
// come from the digest context once wired.
function fillWhy(t: HabitTemplate): string {
  const demo: Record<string, string> = { energyLowCount: "3", proteinShortDays: "4" };
  return t.whyTemplate.replace(/\{(\w+)\}/g, (_m, k: string) => demo[k] ?? "several");
}

// Varied streak-progress lines so the feedback doesn't feel repetitive. Picked
// deterministically from a seed so it stays stable within a render but differs
// across habits and days. {n} is filled with the day count.
function pickLine(lines: string[], seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return lines[h % lines.length];
}
const HABIT_FIRST_DAY_LINES = [
  "Day one down, the hardest part is behind you!",
  "First day done, that's how it starts!",
  "Day one in the books, nice work!",
  "You showed up on day one, that's the whole game!",
  "One day down, momentum starts here!",
];
const HABIT_ALMOST_LINES = [
  "Almost there, one more day to go!",
  "So close, just one more day!",
  "One day left, you've basically got this!",
  "The finish line is right there, one more!",
  "Last push, one more day to lock it in!",
];
const HABIT_MID_LINES = [
  "{n} days in, you're really doing this!",
  "{n} days deep, this is becoming a thing!",
  "{n} in a row, look at you go!",
  "{n} days down, you're on a roll!",
  "Day {n} done, steady as you go!",
];
const HABIT_DONE_LINES = [
  "{n} days straight, this is sticking!",
  "{n} days done, you built something!",
  "{n} for {n}, that's a real habit forming!",
  "All {n} days, this one is yours now!",
  "{n} days running, look how far you came!",
];

// Module-level cache — survives navigation, resets on full page reload

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// True if an ISO timestamp falls on the same local calendar day as `d`.
function sameLocalDay(iso: string, d: Date): boolean {
  const a = new Date(iso);
  return a.getFullYear() === d.getFullYear() && a.getMonth() === d.getMonth() && a.getDate() === d.getDate();
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
    <div className="relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition"
      style={isToday
        ? { borderColor: "rgba(15,23,42,0.10)", background: "transparent" }
        : { borderColor: "rgba(99,133,255,0.35)", background: "rgba(99,133,255,0.06)" }
      }
    >
      <svg className={`h-3 w-3 shrink-0 ${isToday ? "text-ink/35" : "text-primary/70"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      <span className={`text-[11px] select-none ${isToday ? "text-ink/65" : "font-medium text-primary"}`}>
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
  const { profile: ctxProfile, meals: ctxMeals, workouts: ctxWorkouts, feelLogs: ctxFeelLogs, weightLogs: ctxWeightLogs, setWeightLogs, loading: dataLoading, reload } = useAppData();

  const [profile, setProfile] = useState<UserProfile | undefined>(undefined);

  // Monthly weight check-in prompt (keeps weight fresh so the coach/targets stay accurate).
  const [weightInput, setWeightInput] = useState("");
  const [weightPromptHidden, setWeightPromptHidden] = useState(false);
  const [savingWeight, setSavingWeight] = useState(false);
  const weightUnitLabel = profile?.units === "metric" ? "kg" : "lbs";
  const weightPromptDue = useMemo(() => {
    if (!user || !profile?.weight || typeof window === "undefined") return false;
    const lastWeigh = (ctxWeightLogs ?? []).reduce((m, w) => Math.max(m, new Date(w.logged_at).getTime()), 0);
    const profileUpdated = Number(localStorage.getItem(`wya_profile_updated_${user.id}`) || 0);
    const baseline = Math.max(lastWeigh, profileUpdated);
    if (!baseline) return false;
    const dismissed = Number(localStorage.getItem(`wya_weight_prompt_dismissed_${user.id}`) || 0);
    const THIRTY = 30 * 24 * 60 * 60 * 1000;
    return Date.now() - baseline > THIRTY && Date.now() - dismissed > THIRTY;
  }, [user, profile?.weight, ctxWeightLogs]);
  const showWeightPrompt = weightPromptDue && !weightPromptHidden;
  const dismissWeightPrompt = () => {
    if (user) localStorage.setItem(`wya_weight_prompt_dismissed_${user.id}`, String(Date.now()));
    setWeightPromptHidden(true);
  };
  const saveWeightPrompt = async () => {
    if (!user || !profile || savingWeight) return;
    const num = parseFloat(weightInput);
    if (!Number.isFinite(num) || num <= 0) return;
    setSavingWeight(true);
    try {
      const kg = profile.units === "metric" ? Math.round(num * 10) / 10 : Math.round((num / 2.20462) * 10) / 10;
      const log = await addWeightLog(user.id, kg);
      if (log) setWeightLogs((prev) => [log, ...prev]);
      const updated = { ...profile, weight: kg };
      await saveProfile(user.id, updated);
      setProfile(updated);
      localStorage.setItem(`wya_profile_updated_${user.id}`, String(Date.now()));
      setWeightInput("");
      setWeightPromptHidden(true);
    } catch {
      // best effort; leave the prompt open so they can retry
    } finally {
      setSavingWeight(false);
    }
  };
  const [waterTick, setWaterTick] = useState(0);
  const [showWaterUndo, setShowWaterUndo] = useState(false);
  const waterUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAddedWaterMlRef = useRef<number[]>([]);
  const [waterModalOpen, setWaterModalOpen] = useState(false);
  const waterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (waterModalOpen && waterInputRef.current) {
      waterInputRef.current.focus({ preventScroll: true });
    }
  }, [waterModalOpen]);

  // Seed water data from Supabase into localStorage on load (restores data after cache clear)
  useEffect(() => {
    if (!user || !profile?.trackWater) return;
    fetchWaterLogs(user.id).then((logs) => {
      let changed = false;
      for (const [dayKey, ml] of Object.entries(logs)) {
        if (ml <= 0) continue;
        const key = `wya_water_${user.id}_${dayKey}`;
        try {
          const local = parseInt(localStorage.getItem(key) ?? "0", 10) || 0;
          if (local === 0) { localStorage.setItem(key, String(ml)); changed = true; }
        } catch {}
      }
      if (changed) setWaterTick((t) => t + 1);
    }).catch(() => {});
  }, [user?.id, profile?.trackWater]);

  const [waterInputAmount, setWaterInputAmount] = useState("");
  const [waterInputUnit, setWaterInputUnit] = useState<"ml" | "oz" | "cups" | "L">("ml");
  const [runTour, setRunTour] = useState(false);
  const [showTourGate, setShowTourGate] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [gateOverlay, setGateOverlay] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [demoData] = useState(() => ({ meals: makeDemoMeals(), workouts: makeDemoWorkouts(), feelLogs: makeDemoFeelLogs() }));
  const loadingData = dataLoading;
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fallback: if a review flag has been pending for 7+ days without an Insights visit, show on Home
  useEffect(() => {
    if (loadingData) return;
    checkAndSetMilestoneFlag(ctxMeals);
    const flag = getPendingReviewFlag();
    if (!flag) return;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - flag.setTs < sevenDays) return;
    if (!canShowReviewPrompt(flag.type === "upgrade")) return;
    const timer = setTimeout(() => openReviewPrompt(flag.key), 3000);
    return () => clearTimeout(timer);
  }, [loadingData, ctxMeals]);
  const [dailyLimitBanner, setDailyLimitBanner] = useState(false);
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [barcodeNotFound, setBarcodeNotFound] = useState(false);
  const [barcodeNotFoundText, setBarcodeNotFoundText] = useState("");
  const [barcodeNotFoundAnalyzing, setBarcodeNotFoundAnalyzing] = useState(false);
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
  const barsEverShownRef = useRef(false);
  const [pendingQuickConfirmId, setPendingQuickConfirmId] = useState<string | null>(null);
  const [quickConfirmMeal, setQuickConfirmMeal] = useState<MealLog | null>(null);
  const [quickConfirmName, setQuickConfirmName] = useState("");
  const [quickConfirmOriginalName, setQuickConfirmOriginalName] = useState("");
  const [editOriginalName, setEditOriginalName] = useState("");
  const [quickConfirmPortion, setQuickConfirmPortion] = useState<"small" | "medium" | "large">("medium");
  const [failedMealPrompt, setFailedMealPrompt] = useState<{ mealId: string; thumb?: string } | null>(null);
  const [failedMealText, setFailedMealText] = useState("");
  const [failedMealAnalyzing, setFailedMealAnalyzing] = useState(false);
  const [showProfileBell, setShowProfileBell] = useState(false);
  const [failedMealNotice, setFailedMealNotice] = useState(false);
  const [quickConfirming, setQuickConfirming] = useState(false);
  const [reanalyzingMealIds, setReanalyzingMealIds] = useState<Set<string>>(new Set());
  const [editPortion, setEditPortion] = useState<"small" | "medium" | "large">("medium");
  const [showTargetInfo, setShowTargetInfo] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showLogFood, setShowLogFood] = useState(false);
  const [logFoodClosing, setLogFoodClosing] = useState(false);
  const [showFeelingModal, setShowFeelingModal] = useState(false);
  const [showReflection, setShowReflection] = useState(false);
  const [reflection, setReflection] = useState<Record<string, number | number[]>>({});
  const [reflectionNote, setReflectionNote] = useState("");
  const [reflectionStep, setReflectionStep] = useState(0);
  const [lastReflection, setLastReflection] = useState<{ reflection: Record<string, number | number[]>; note: string } | null>(null);
  const closeReflection = () => setShowReflection(false); // keeps progress for "Later"
  const finishReflection = () => {
    // Persist the completed check-in so it feeds the coach and "Same As Last Night".
    if (user && Object.keys(reflection).length > 0) {
      setLastReflection({ reflection, note: reflectionNote });
      void addReflection(user.id, { date: todayDateStr(), answers: reflection, note: reflectionNote, ts: Date.now() });
    }
    setShowReflection(false); setReflectionStep(0); setReflection({}); setReflectionNote("");
  };
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchReflections(user.id).then((rows) => {
      if (cancelled || rows.length === 0) return;
      const latest = rows[0]; // addReflection keeps newest first
      setLastReflection({ reflection: latest.answers, note: latest.note });
    });
    return () => { cancelled = true; };
  }, [user]);
  const [selectedFeelings, setSelectedFeelings] = useState<string[]>([]);
  const [heroHabit, setHeroHabit] = useState<{ status: "suggested" | "accepting" | "committed" | "active" | "dayComplete" | "done" | "missed" | "hidden"; days: boolean[][]; holdDay?: number | null }>(
    { status: "suggested", days: freshDays(FIRST_TEMPLATE) }
  );
  const [activeTemplate, setActiveTemplate] = useState<HabitTemplate>(FIRST_TEMPLATE);
  const [showHabitIdeas, setShowHabitIdeas] = useState(false);
  const [heroExpanded, setHeroExpanded] = useState(false);
  const [heroPulse, setHeroPulse] = useState(false);
  // False until the persisted habit state has loaded, so the hero enters once with the
  // correct content (no flash of the default suggestion before an active builder).
  const [habitLoaded, setHabitLoaded] = useState(false);
  const heroRevealedRef = useRef(false);

  // Surface the habits matching the user's feeling goal(s) first.
  const goalHabits = useMemo(() => habitsForGoals(profile?.feelingGoals, profile?.goalDirection), [profile?.feelingGoals, profile?.goalDirection]);
  const appliedGoalHabitRef = useRef(false);
  // Mirror of the persisted habit state, kept in a ref so the save/cadence effects
  // can read the latest without re-running on it.
  const habitStateRef = useRef<HabitState>(EMPTY_HABIT_STATE);
  useEffect(() => {
    if (appliedGoalHabitRef.current || !profile || goalHabits.length === 0) return;
    appliedGoalHabitRef.current = true;
    // Demo/walkthrough stays in-memory and never touches persistence.
    if (isDemoMode || !user) {
      const top = goalHabits[0];
      setActiveTemplate(top);
      setHeroHabit({ status: "suggested", days: freshDays(top) });
      setHabitLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const loaded = (await fetchHabitState(user.id)) ?? EMPTY_HABIT_STATE;
      if (cancelled) return;
      // A finished "done" confirmation only lives until the day rolls over.
      let state = loaded;
      if (loaded.builder?.status === "done" && loaded.builder.finishedAt && !sameLocalDay(loaded.builder.finishedAt, new Date())) {
        state = { ...loaded, builder: null };
        void saveHabitState(user.id, state);
      }
      habitStateRef.current = state;
      if (state.builder) {
        const b = state.builder;
        const t = HABIT_TEMPLATES.find((x) => x.id === b.templateId) ?? goalHabits[0];
        setActiveTemplate(t);
        setHeroHabit({ status: b.status, days: b.days, holdDay: b.holdDay ?? null });
        // Restore a finished builder without replaying the celebration: the answered
        // "rested" confirmation, or the "You Started Something!" step (which waits for
        // the Done tap, then leads to the keep prompt) if not answered yet.
        if (b.status === "done") setDoneStep(b.keptAnswer ? "rested" : "started");
      } else {
        // Respect the breather/cooldown: only suggest when cadence says it's time.
        // Otherwise show the greeting (no habit) rather than re-offering one.
        const suggestId = pickSuggestionId(state, goalHabits.map((g) => g.id));
        if (suggestId) {
          const t = HABIT_TEMPLATES.find((x) => x.id === suggestId) ?? goalHabits[0];
          setActiveTemplate(t);
          setHeroHabit({ status: "suggested", days: freshDays(t) });
        } else {
          setHeroHabit((h) => ({ ...h, status: "hidden" }));
        }
      }
      setHabitLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [profile, goalHabits, user, isDemoMode]);

  // Persist the in-progress builder whenever it changes. "done" is handled by its own
  // effect below (it carries finishedAt + the keep answer); transient states
  // (suggested/accepting/hidden) are not stored as a builder.
  useEffect(() => {
    if (!appliedGoalHabitRef.current || isDemoMode || !user) return;
    if (heroHabit.status === "done") return;
    const persistable = ["committed", "active", "dayComplete", "missed"].includes(heroHabit.status);
    let builder: ActiveBuilder | null = null;
    if (persistable) {
      const prev = habitStateRef.current.builder;
      const startedAt = prev && prev.templateId === activeTemplate.id ? prev.startedAt : new Date().toISOString();
      builder = {
        templateId: activeTemplate.id,
        status: heroHabit.status,
        days: heroHabit.days,
        startedAt,
        holdDay: heroHabit.holdDay ?? null,
      };
    }
    const next: HabitState = { ...habitStateRef.current, builder };
    habitStateRef.current = next;
    void saveHabitState(user.id, next);
  }, [heroHabit, activeTemplate, isDemoMode, user]);

  // On completion, persist the finished builder (with finishedAt) and start the
  // breather — but keep the builder so the "You Built A Habit" confirmation stays on
  // screen until the day rolls over. The live celebration sequence is untouched.
  const doneHandledRef = useRef(false);
  useEffect(() => {
    if (heroHabit.status !== "done") { doneHandledRef.current = false; return; }
    if (doneHandledRef.current || isDemoMode || !user) return;
    doneHandledRef.current = true;
    const tmpl = activeTemplate;
    const prev = habitStateRef.current.builder;
    // Only persist on a live completion. If the builder is already "done" (restored on
    // reload), do nothing — otherwise finishedAt + the breather would reset every load.
    if (prev?.status === "done" && prev.templateId === tmpl.id) return;
    const startedAt = prev && prev.templateId === tmpl.id ? prev.startedAt : new Date().toISOString();
    const doneBuilder: ActiveBuilder = {
      templateId: tmpl.id, status: "done", days: heroHabit.days, startedAt,
      holdDay: null, finishedAt: new Date().toISOString(), keptAnswer: prev?.keptAnswer ?? null,
    };
    const next: HabitState = { ...markHabitEnded(habitStateRef.current, tmpl.id, tmpl.cooldownDays), builder: doneBuilder };
    habitStateRef.current = next;
    void saveHabitState(user.id, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroHabit.status, isDemoMode, user]);

  // The keep answer: archive the completion with the answer and record it on the
  // persisted builder (so a reload shows the answered confirmation, not the prompt).
  // The builder is NOT cleared here — it stays until the day rolls over.
  const setBuiltHabitKeep = (keep: "yes" | "maybe" | "no") => {
    if (isDemoMode || !user) return;
    const tmpl = activeTemplate;
    void (async () => {
      const entry: HabitHistoryEntry = {
        templateId: tmpl.id, title: tmpl.title, days: tmpl.durationDays,
        finishedAt: new Date().toISOString(), keep,
      };
      const history = await fetchHabitHistory(user.id);
      await saveHabitHistory(user.id, [entry, ...history]);
      const cur = habitStateRef.current;
      if (cur.builder?.status === "done") {
        const next: HabitState = { ...cur, builder: { ...cur.builder, keptAnswer: keep } };
        habitStateRef.current = next;
        await saveHabitState(user.id, next);
      }
    })();
  };

  // Maybe Later = soft snooze (re-offer tomorrow; 2nd = No); No Thanks = shelve it.
  const dismissSuggestion = (hard: boolean) => {
    setHeroHabit((h) => ({ ...h, status: "hidden" }));
    if (isDemoMode || !user) return;
    const next = hard
      ? declineSuggestion(habitStateRef.current, activeTemplate.id, activeTemplate.cooldownDays)
      : snoozeSuggestion(habitStateRef.current, activeTemplate.id, activeTemplate.cooldownDays);
    habitStateRef.current = next;
    void saveHabitState(user.id, next);
  };

  // Manually surface a habit (from the greeting during the breather / after finishing
  // one). Shows it expanded right away — no first-appearance reveal. The eyebrow then
  // cycles through the rest for testing.
  const startHabitManually = () => {
    const t = goalHabits[0] ?? HABIT_TEMPLATES[0];
    setActiveTemplate(t);
    setHeroExpanded(true);
    setHeroHabit({ status: "suggested", days: freshDays(t) });
  };

  // On the very first habit prompt, show a compact "Habit Builder" notification, then
  // smoothly expand into the full card. Only runs once (later prompts/cycles are
  // already expanded).
  useEffect(() => {
    if (!habitLoaded) return; // wait for the real state before any reveal
    if (heroRevealedRef.current) return;
    if (heroHabit.status !== "suggested") return;
    heroRevealedRef.current = true;
    // First-appearance sequence: card shimmers + title bounces on mount (CSS), then a
    // solo border pulse, then the card expands (which pulses its border again).
    const tPulse = setTimeout(() => setHeroPulse(true), 800);
    const tPulseOff = setTimeout(() => setHeroPulse(false), 2050);
    const tExpand = setTimeout(() => setHeroExpanded(true), 1700);
    return () => { clearTimeout(tPulse); clearTimeout(tPulseOff); clearTimeout(tExpand); };
  }, [heroHabit.status, habitLoaded]);

  // Once the card finishes dropping down, pulse its border again like a finished habit.
  useEffect(() => {
    if (!heroExpanded) return;
    const t1 = setTimeout(() => setHeroPulse(true), 700);
    const t2 = setTimeout(() => setHeroPulse(false), 700 + 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [heroExpanded]);

  // Auto-collapse the "What Helps?" list 20s after it opens (also closed on reload,
  // since the state resets).
  useEffect(() => {
    if (!showHabitIdeas) return;
    const t = setTimeout(() => setShowHabitIdeas(false), 20000);
    return () => clearTimeout(t);
  }, [showHabitIdeas]);

  // Demo/testing: cycle to the next template and reset to its suggestion, so we
  // can eyeball how each one renders (different checkpoints, durations, copy).
  const cycleTemplate = () => {
    const list = goalHabits.length ? goalHabits : HABIT_TEMPLATES;
    const i = list.indexOf(activeTemplate);
    const next = list[(i + 1) % list.length];
    setActiveTemplate(next);
    setHeroHabit({ status: "suggested", days: freshDays(next) });
  };
  // Complete checkpoint `s` of the current day. If it finishes the day, hold on the
  // all-blue day for a beat, then reveal the confirmation. Shared by the checkpoint
  // buttons and the auto-complete-on-log for logging habits.
  const completeCheckpoint = (s: number) => {
    unlockAudio();
    setHeroHabit((h) => {
      const cur = h.days.findIndex((d) => !d.every(Boolean));
      if (cur === -1) return h;
      const days = h.days.map((day, di) => (di === cur ? day.map((v, si) => (si === s ? !v : v)) : day));
      const curDone = days[cur].every(Boolean);
      if (curDone) {
        setTimeout(() => setHeroHabit((h2) => {
          if (!h2.days[cur]?.every(Boolean)) return h2;
          const allDone = h2.days.every((d) => d.every(Boolean));
          return { ...h2, status: allDone ? "done" : "dayComplete", holdDay: null };
        }), 1450);
        return { ...h, days, status: "active", holdDay: cur };
      }
      return { ...h, days, status: "active", holdDay: null };
    });
  };
  const [doneStep, setDoneStep] = useState<"dayDone" | "started" | "celebrate" | "feedback" | "rested">("dayDone");
  const [ratingPicked, setRatingPicked] = useState<string | null>(null);
  const [quickAddItems, setQuickAddItems] = useState<QuickAddItem[]>([]);
  const [quickAddRecentItems, setQuickAddRecentItems] = useState<QuickAddItem[]>([]);
  const [quickAddSelected, setQuickAddSelected] = useState<Record<string, "small" | "medium" | "large">>({});
  const [quickAddAdding, setQuickAddAdding] = useState(false);
  const [quickAddDate, setQuickAddDate] = useState(todayDateStr);
  const [streakSaverDismissed, setStreakSaverDismissed] = useState(false);
  const [streakSaverMode, setStreakSaverMode] = useState(false);
  const [streakButtonPulsing, setStreakButtonPulsing] = useState(false);
  const [recentlyLogged, setRecentlyLogged] = useState(false);
  const [streakBouncing, setStreakBouncing] = useState(false);
  const mountTimeRef = useRef<number>(Date.now());
  const logFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [homeFeelLogs, setHomeFeelLogs] = useState<FeelLog[]>(ctxFeelLogs);
  const [editingFeelLog, setEditingFeelLog] = useState<FeelLog | null>(null);
  const [editFeelTag, setEditFeelTag] = useState<string | null>(null);
  const [editFeelDate, setEditFeelDate] = useState("");
  const [editFeelTime, setEditFeelTime] = useState("");

  const mountedRef = useRef(true);
  const recentSentinelRef = useRef<HTMLDivElement | null>(null);
  const realtimeRefreshRef = useRef<number | null>(null);
  const savedThisSessionRef = useRef<Set<string>>(new Set());
  const dailySuppsAttemptedRef = useRef(false);
  const promptedStaleRef = useRef<Set<string>>(new Set());
  const recentQuickAddRef = useRef<number>(0);
  const quickAddBouncedRef = useRef(false);
  const quickAddConfirmingRef = useRef(false);
  const onError = useCallback((msg: string) => setLoadError(msg), []);

  const workout = useWorkout(user, onError, setEditRecents, []);
  const meals = useMeals(user, onError, setEditRecents, []);

  const trial = useTrialStatus();

  const handleFeelLog = async (tag: string, ts: number) => {
    if (!user) return;
    try {
      const id = await addFeelLog(user.id, ts, tag);
      if (id) setHomeFeelLogs((prev) => [{ id, ts, tag }, ...prev].sort((a, b) => b.ts - a.ts));
    } catch {
      // silently fail
    }
  };

  const handleDeleteHomeFeelLog = async (id: string) => {
    setHomeFeelLogs((prev) => prev.filter((f) => f.id !== id));
    await deleteFeelLog(id);
  };

  const handleOpenQuickAdd = () => {
    quickAddConfirmingRef.current = false;
    const { frequent, recent } = getQuickAddFromMeals(meals.meals);
    setQuickAddItems(frequent);
    setQuickAddRecentItems(recent);
    setQuickAddSelected({});
    setQuickAddDate(todayDateStr());
    setShowQuickAdd(true);
  };

  const handleQuickAddConfirm = () => {
    if (!user || quickAddAdding || quickAddConfirmingRef.current) return;
    quickAddConfirmingRef.current = true;
    const selected = Object.entries(quickAddSelected);
    if (!selected.length) return;
    setQuickAddAdding(true);

    // Build all meal data synchronously — no DB calls yet
    const pendingItems: Array<{ item: QuickAddItem; analysis: any }> = [];
    for (const [key, portion] of selected) {
      const item = quickAddItems.find((i) => i.key === key) ?? quickAddRecentItems.find((i) => i.key === key);
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
      const originalRanges = item.type === "text" && item.ranges ? item.ranges : ranges;
      const analysis = {
        name: item.name,
        detected_items: [{ name: item.name, confidence_0_1: 1 }],
        estimated_ranges: ranges,
        micronutrient_signals: item.micronutrient_signals ?? [],
        confidence_overall_0_1: 1,
        precision_mode_available: false,
        portion,
        original_ranges: originalRanges,
      } as any;
      pendingItems.push({ item, analysis });
    }

    if (!pendingItems.length) { setQuickAddAdding(false); return; }

    // Optimistically add pills and close the modal immediately
    const now = Date.now();
    recentQuickAddRef.current = now;
    quickAddBouncedRef.current = false;
    setTimeout(() => { if (recentQuickAddRef.current === now) recentQuickAddRef.current = 0; }, 60_000);
    const optimisticMeals = pendingItems.map(({ analysis }, i) => ({
      id: `optimistic-${now}-${i}`,
      ts: now - i,
      analysisJson: analysis,
      status: "done" as const,
    }));
    meals.setMeals((prev) => [...optimisticMeals, ...prev]);
    setShowQuickAdd(false);
    setQuickAddSelected({});
    setQuickAddAdding(false);
    quickAddConfirmingRef.current = false;

    // Write to DB — each item independent so one failure doesn't block others
    const capturedDate = quickAddDate;
    (async () => {
      const results = await Promise.allSettled(
        pendingItems.map(async ({ item, analysis }, i) => {
          const created = await addMeal(user.id, analysis);
          if (!created?.id) throw new Error(`addMeal failed for ${item.name}`);
          await updateMeal(created.id, analysis, { userCorrection: item.name }, user.id);
          // Replace optimistic pill with real DB record so ctxMeals sync doesn't create a duplicate
          meals.setMeals((prev) => prev.map((m) =>
            m.id === `optimistic-${now}-${i}`
              ? { ...created, ts: now - i, analysisJson: analysis, userCorrection: item.name, status: "done" as const }
              : m
          ));
          if (capturedDate !== todayDateStr()) {
            const d = new Date(capturedDate + "T12:00:00");
            if (d.getTime() < Date.now()) await updateMealTs(created.id, d.getTime()).catch(() => {});
          }
          if (item.type === "text") incrementFoodTextLogCount(item.key);
          else if (item.barcode) incrementFoodCacheLogCount(item.barcode);
        })
      );
      // Remove optimistic pills for any writes that failed
      const failedIds = results
        .map((r, i) => r.status === "rejected" ? `optimistic-${now}-${i}` : null)
        .filter((id): id is string => id !== null);
      if (failedIds.length > 0) {
        meals.setMeals((prev) => prev.filter((m) => !failedIds.includes(m.id)));
        console.error("[quick add] some writes failed:", failedIds.length);
      }
      notifyMealsUpdated();
    })();
  };

  const handleRemoveQuickAddItem = (item: QuickAddItem) => {
    addQuickAddRemoved(item.key);
    setQuickAddItems((prev) => prev.filter((i) => i.key !== item.key));
    setQuickAddRecentItems((prev) => prev.filter((i) => i.key !== item.key));
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
    meals.setMeals((prev) => {
      const optimistic = prev.filter((m) => m.id.startsWith("optimistic-"));
      const optimisticIds = new Set(optimistic.map((m) => m.id));
      return [...optimistic, ...ctxMeals.filter((m) => !optimisticIds.has(m.id))];
    });
  }, [ctxMeals]);

  useEffect(() => {
    workout.setWorkouts(ctxWorkouts);
  }, [ctxWorkouts]);

  useEffect(() => {
    if (loadingData) {
      if (!barsEverShownRef.current) setBarsReady(false);
      return;
    }
    const t = setTimeout(() => {
      barsEverShownRef.current = true;
      setBarsReady(true);
    }, 60);
    return () => clearTimeout(t);
  }, [loadingData]);

  // Auto-close edit panels after 1 minute of inactivity
  useEffect(() => {
    const anyOpen = !!(meals.editingMeal || workout.editingWorkout || editingFeelLog);
    if (!anyOpen) return;
    const t = setTimeout(() => {
      meals.setEditingMeal(null);
      workout.setEditingWorkout(null);
      setEditingFeelLog(null);
    }, 60_000);
    return () => clearTimeout(t);
  }, [meals.editingMeal, workout.editingWorkout, editingFeelLog]);

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
        notifyMealsUpdated();
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

  const handleQuickConfirm = async (reanalyze = true) => {
    if (!quickConfirmMeal || !user) return;
    const nameChanged = reanalyze && quickConfirmName.trim().toLowerCase() !== quickConfirmOriginalName.trim().toLowerCase();

    if (nameChanged && quickConfirmName.trim()) {
      // Close immediately; the recents pill shows "Analyzing Food…" while it re-analyzes.
      const mealId = quickConfirmMeal.id;
      const imageThumb = quickConfirmMeal.imageThumb;
      const newName = quickConfirmName.trim();
      const capturedUserId = user.id;

      setReanalyzingMealIds((prev) => new Set([...prev, mealId]));
      setQuickConfirmMeal(null);
      let imageBase64: string | undefined;
      if (imageThumb) {
        try {
          const imgRes = await fetch(imageThumb);
          const blob = await imgRes.blob();
          imageBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch {
          imageBase64 = undefined;
        }
      }
      try {
        await fetch("/api/analyze-food", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            imageBase64
              ? { imageBase64, hints: newName, mealId, userId: capturedUserId }
              : { textDescription: newName, mealId, userId: capturedUserId }
          ),
        });
        clearMealsCache(capturedUserId);
        await meals.load(capturedUserId);
      } catch (err) {
        console.error("Re-analyze failed", err);
      } finally {
        setReanalyzingMealIds((prev) => { const next = new Set(prev); next.delete(mealId); return next; });
      }
      return;
    }

    // Name unchanged — apply portion scaling synchronously
    setQuickConfirming(true);
    try {
      const multiplier = quickConfirmPortion === "small" ? 0.7 : quickConfirmPortion === "large" ? 1.4 : 1;
      const scale = (v: number) => Math.round(v * multiplier);
      const r = quickConfirmMeal.analysisJson.original_ranges ?? quickConfirmMeal.analysisJson.estimated_ranges;
      const updatedAnalysis = {
        ...quickConfirmMeal.analysisJson,
        name: quickConfirmName,
        estimated_ranges: {
          calories_min: scale(r.calories_min), calories_max: scale(r.calories_max),
          protein_g_min: scale(r.protein_g_min), protein_g_max: scale(r.protein_g_max),
          carbs_g_min: scale(r.carbs_g_min), carbs_g_max: scale(r.carbs_g_max),
          fat_g_min: scale(r.fat_g_min), fat_g_max: scale(r.fat_g_max),
        },
        portion: quickConfirmPortion,
        original_ranges: r,
      };
      await updateMeal(quickConfirmMeal.id, updatedAnalysis as any, { userCorrection: quickConfirmName }, user?.id);
      await meals.load(user.id);
      setQuickConfirmMeal(null);
    } catch (err) {
      console.error("Quick confirm failed", err);
    } finally {
      setQuickConfirming(false);
    }
  };

  const handleEditReanalyze = () => {
    if (!meals.editingMeal || !user) return;
    const mealId = meals.editingMeal.id;
    const imageThumb = meals.editingMeal.imageThumb;
    const newName = meals.editForm.name.trim();
    const capturedUserId = user.id;
    // Close immediately; the recents pill shows "Analyzing Food…" while it re-analyzes.
    setReanalyzingMealIds((prev) => new Set([...prev, mealId]));
    meals.setEditingMeal(null);
    setEditRecents(false);
    setStreakSaverMode(false);
    (async () => {
      let imageBase64: string | undefined;
      if (imageThumb) {
        try {
          const imgRes = await fetch(imageThumb);
          const blob = await imgRes.blob();
          imageBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch {
          imageBase64 = undefined;
        }
      }
      try {
        await fetch("/api/analyze-food", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            imageBase64
              ? { imageBase64, hints: newName, mealId, userId: capturedUserId }
              : { textDescription: newName, mealId, userId: capturedUserId }
          ),
        });
        clearMealsCache(capturedUserId);
        await meals.load(capturedUserId);
      } catch (err) {
        console.error("Re-analyze failed", err);
      } finally {
        setReanalyzingMealIds((prev) => { const next = new Set(prev); next.delete(mealId); return next; });
      }
    })();
  };

  const handleFailedMealSubmit = async () => {
    if (!failedMealPrompt || !failedMealText.trim() || !user) return;
    setFailedMealAnalyzing(true);
    const mealIdToUpdate = failedMealPrompt.mealId;
    const imageThumb = failedMealPrompt.thumb;
    const text = failedMealText.trim();
    // Close immediately and force the recents pill into the "Analyzing Food…" shimmer.
    // reanalyzingMealIds overrides the meal's age — a stale failed photo is older than
    // the 90s window, so the optimistic "processing" flip alone wouldn't shimmer.
    setReanalyzingMealIds((prev) => new Set([...prev, mealIdToUpdate]));
    meals.setMeals((prev) => prev.map((m) => m.id === mealIdToUpdate ? { ...m, status: "processing" as const } : m));
    setFailedMealPrompt(null);
    setFailedMealText("");
    setFailedMealAnalyzing(false);
    let imageBase64: string | undefined;
    if (imageThumb) {
      try {
        const imgRes = await fetch(imageThumb);
        const blob = await imgRes.blob();
        imageBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch {
        imageBase64 = undefined;
      }
    }
    const analyze = (body: Record<string, unknown>) =>
      fetch("/api/analyze-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    try {
      let res: Response;
      if (imageBase64) {
        // Try the photo + typed text first. If the photo path fails (the photo
        // already failed once), fall back to text-only, which is far more
        // reliable — so the user almost always gets a result.
        res = await analyze({ imageBase64, hints: text, mealId: mealIdToUpdate, userId: user.id });
        if (!res.ok) {
          res = await analyze({ textDescription: text, mealId: mealIdToUpdate, userId: user.id });
        }
      } else {
        res = await analyze({ textDescription: text, mealId: mealIdToUpdate, userId: user.id });
      }
      if (!res.ok) throw new Error("Analysis failed");
      clearMealsCache(user.id);
      await meals.load(user.id);
      notifyMealsUpdated();
    } catch {
      // Even text-only failed (offline or over the daily limit). Keep their text
      // and reopen the prompt so they can retry instead of silently losing it.
      clearMealsCache(user.id);
      notifyMealsUpdated();
      setLoadError("Couldn't analyze that just now. Check your connection and try again.");
      setFailedMealText(text);
      setFailedMealPrompt({ mealId: mealIdToUpdate, thumb: imageThumb });
    } finally {
      setReanalyzingMealIds((prev) => { const next = new Set(prev); next.delete(mealIdToUpdate); return next; });
    }
  };

  const handleFailedMealDismiss = async () => {
    if (!failedMealPrompt || !user) { setFailedMealPrompt(null); return; }
    const mealId = failedMealPrompt.mealId;
    setFailedMealPrompt(null);
    meals.setMeals((prev) => prev.filter((m) => m.id !== mealId));
    try {
      await deleteMeal(mealId, user.id);
      clearMealsCache(user.id);
      notifyMealsUpdated();
    } catch {
      // silent — meal may already be gone
    }
  };

  const applyEditPortion = (portion: "small" | "medium" | "large") => {
    if (!meals.editingMeal) return;
    setEditPortion(portion);
    const multiplier = portion === "small" ? 0.7 : portion === "large" ? 1.4 : 1;
    const m = meals.editingMeal;
    const r = m.analysisJson.original_ranges ?? m.analysisJson.estimated_ranges;
    const base = {
      calories: Math.round((r.calories_min + r.calories_max) / 2),
      protein: Math.round((r.protein_g_min + r.protein_g_max) / 2),
      carbs: Math.round((r.carbs_g_min + r.carbs_g_max) / 2),
      fat: Math.round((r.fat_g_min + r.fat_g_max) / 2),
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
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    input.style.cssText = "position:fixed;top:-9999px;opacity:0;pointer-events:none;";
    document.body.appendChild(input);
    const cleanup = () => { try { document.body.removeChild(input); } catch {} };
    const safetyTimer = setTimeout(cleanup, 60_000);
    input.addEventListener("change", async () => {
      clearTimeout(safetyTimer);
      const selected = input.files?.[0] ?? null;
      cleanup();
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
      } catch {}
      router.push("/capture?type=food&from=home");
    });
    input.addEventListener("cancel", () => { clearTimeout(safetyTimer); cleanup(); });
    input.click();
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

  const handleBarcodeNotFoundSubmit = async () => {
    if (!barcodeNotFoundText.trim() || !user || barcodeNotFoundAnalyzing) return;
    setBarcodeNotFoundAnalyzing(true);
    try {
      const created = await addMeal(user.id, safeFallbackAnalysis());
      if (!created?.id) throw new Error("Failed to create meal");
      const res = await fetch("/api/analyze-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ textDescription: barcodeNotFoundText.trim(), mealId: created.id, userId: user.id }),
      });
      if (!res.ok) throw new Error("Analysis failed");
      clearMealsCache(user.id);
      notifyMealsUpdated();
      setBarcodeNotFound(false);
      setBarcodeNotFoundText("");
      setBarcodeOpen(false);
      setBarcodeSuccess(true);
      setTimeout(() => setBarcodeSuccess(false), 1500);
    } catch {
      setLoadError("Something went wrong. Try again.");
    } finally {
      setBarcodeNotFoundAnalyzing(false);
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

  // Flash "✓ Logged" only when a meal logged during this session finishes analyzing.
  // Uses mount timestamp instead of count comparison — immune to remount false-fires.
  useEffect(() => {
    if (loadingData || isDemoMode) return;
    const hasNewMeal = meals.meals.some(
      (m) =>
        m.status === "done" &&
        m.analysisJson?.source !== "supplement" &&
        m.ts >= mountTimeRef.current
    );
    if (hasNewMeal) {
      // Suppress the second trigger caused by DB data replacing the optimistic meal.
      // recentQuickAddRef is set when quick add fires; quickAddBouncedRef tracks whether
      // we've already bounced once for this quick add session (within 15s window).
      const isRecentQuickAdd = recentQuickAddRef.current > 0 && Date.now() - recentQuickAddRef.current < 15_000;
      if (isRecentQuickAdd && quickAddBouncedRef.current) return;
      if (isRecentQuickAdd) quickAddBouncedRef.current = true;
      setRecentlyLogged(true);
      if (logFlashTimerRef.current) clearTimeout(logFlashTimerRef.current);
      logFlashTimerRef.current = setTimeout(() => setRecentlyLogged(false), 2200);
    }
  }, [meals.meals, loadingData, isDemoMode]);

  // Bounce the streak pill when a new meal is logged
  useEffect(() => {
    if (!recentlyLogged) return;
    setStreakBouncing(true);
    const t = setTimeout(() => setStreakBouncing(false), 700);
    return () => clearTimeout(t);
  }, [recentlyLogged]);

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
    // Also check loaded meals directly — covers new-device / cleared-localStorage case
    // where the localStorage flag isn't set but the DB already has today's supplement
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    if (ctxMeals.some((m) => m.analysisJson?.source === "supplement" && m.ts >= todayMidnight.getTime())) {
      markDailySuppsLoggedToday(user.id);
      return;
    }
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
      // Mark optimistically before async ops — prevents duplicate if component
      // remounts while awaits are in flight. Cleared only if addMeal itself fails.
      markDailySuppsLoggedToday(user.id);
      try {
        // Insert directly as "done" — supplements are static, no AI analysis needed.
        // Avoids the addMeal("processing") → updateMeal("done") two-step that could
        // leave the meal stuck in "processing" and trigger the failed-analysis recovery.
        const created = await addMeal(user.id, analysis, undefined, undefined, "done");
        if (created?.id) {
          // Stamp to 12:01am today so it anchors to the start of the day
          const midnight = new Date();
          midnight.setHours(0, 1, 0, 0);
          await updateMealTs(created.id, midnight.getTime());
          notifyMealsUpdated();
        }
      } catch {
        // addMeal failed — clear flag so it retries on next load
        clearDailySuppsLoggedToday(user.id);
      }
    })();
  }, [user, loadingData, ctxMeals]);

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

  // Open the unified log menu when the bottom-nav FAB is tapped
  useEffect(() => {
    const handler = () => { setLogFoodClosing(false); setShowLogFood(true); };
    window.addEventListener("wya_open_log_menu", handler);
    return () => window.removeEventListener("wya_open_log_menu", handler);
  }, []);

  // Final-day sequence: Done For Today → You Started Something → You Built A Habit!
  // (the celebration lands first, then the feedback buttons fade in). Resets to the
  // start whenever we leave "done"; "feedback" and "rested" wait on the user.
  useEffect(() => {
    if (heroHabit.status !== "done") { setDoneStep("dayDone"); setRatingPicked(null); return; }
    let t: ReturnType<typeof setTimeout> | undefined;
    if (doneStep === "dayDone") t = setTimeout(() => setDoneStep("started"), 2400);
    else if (doneStep === "celebrate") t = setTimeout(() => setDoneStep("feedback"), 2600);
    return () => { if (t) clearTimeout(t); };
  }, [heroHabit.status, doneStep]);

  // Brief "accepted" flourish after committing, then route: before 10am it starts
  // today (into the tracker), after 10am it starts tomorrow (the Starts Tomorrow card).
  useEffect(() => {
    if (heroHabit.status !== "accepting") return;
    celebrateAccepted();
    const t = setTimeout(() => {
      setHeroHabit((h) => ({ ...h, status: new Date().getHours() < 10 ? "active" : "committed" }));
    }, 2800);
    return () => clearTimeout(t);
  }, [heroHabit.status]);

  // Logging habits (Find Your Footing / Pick Back Up) auto-tick the day when the
  // user logs anything (a meal or feeling), then the confirmation appears on its
  // own a beat later — no button to press.
  const prevLogCountRef = useRef<number | null>(null);
  useEffect(() => {
    const count = (ctxMeals?.length ?? 0) + (ctxFeelLogs?.length ?? 0);
    if (prevLogCountRef.current === null) { prevLogCountRef.current = count; return; }
    if (count > prevLogCountRef.current && activeTemplate.autoCompleteOnLog && heroHabit.status === "active" && heroHabit.holdDay == null) {
      completeCheckpoint(0);
    }
    prevLogCountRef.current = count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxMeals?.length, ctxFeelLogs?.length, activeTemplate, heroHabit.status, heroHabit.holdDay]);

  // Celebrations should only fire on a live transition, never when a persisted
  // dayComplete/done state is restored on reload. Arm shortly after mount so the
  // first (restore) render is skipped.
  const celebrationArmedRef = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => { celebrationArmedRef.current = true; }, 200);
    return () => clearTimeout(t);
  }, []);

  // Haptic + chime on the two celebration beats. (Haptics fire only in the app.)
  // Daily: when the "Done For Today" confirmation appears for a mid-habit day.
  useEffect(() => {
    if (celebrationArmedRef.current && heroHabit.status === "dayComplete") celebrateDaily();
  }, [heroHabit.status]);
  // Final day: the daily beat on "dayDone", the big one on "celebrate".
  useEffect(() => {
    if (!celebrationArmedRef.current || heroHabit.status !== "done") return;
    if (doneStep === "dayDone") celebrateDaily();
    else if (doneStep === "celebrate") celebrateBuilt();
  }, [heroHabit.status, doneStep]);

  // Animate the log drawer down before unmounting it
  const closeLogFood = () => {
    setLogFoodClosing(true);
    setTimeout(() => { setShowLogFood(false); setLogFoodClosing(false); }, 300);
  };

  useEffect(() => {
    if (!dailyLimitBanner) return;
    const t = setTimeout(() => setDailyLimitBanner(false), 6000);
    return () => clearTimeout(t);
  }, [dailyLimitBanner]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { mealId, rateLimited, dailyLimitReached } = (e as CustomEvent<{ mealId: string; rateLimited?: boolean; dailyLimitReached?: boolean }>).detail ?? {};
      if (dailyLimitReached) {
        setDailyLimitBanner(true);
        return;
      }
      if (rateLimited) {
        setLoadError("Too many requests. Please wait a moment before adding another photo.");
        return;
      }
      if (mealId) {
        // Find thumbnail for the failed meal if it's in local state
        const failed = meals.meals.find((m) => m.id === mealId);
        const thumb = failed?.imageThumb ?? undefined;
        setFailedMealText(failed?.analysisJson?.name ?? "");
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
    const needsConfirm = (meal.analysisJson?.optional_quick_confirm_options?.length ?? 0) > 0;
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
    if (meals.editingMeal?.id) {
      setEditPortion(meals.editingMeal.analysisJson.portion ?? "medium");
      setEditOriginalName(
        meals.editingMeal.analysisJson?.name ??
        meals.editingMeal.analysisJson?.detected_items?.[0]?.name ??
        "Meal"
      );
    }
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
    document.body.style.overflow = (showQuickAdd || showLogFood || showReflection || showFeelingModal) ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [showQuickAdd, showLogFood, showReflection, showFeelingModal]);

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

  // On load, surface the recovery modal for any meal stuck in "processing" from a prior session.
  // Chains naturally: when failedMealPrompt is dismissed/submitted, the effect re-runs
  // and picks up the next stale meal.
  useEffect(() => {
    if (loadingData || failedMealPrompt || isDemoMode || runTour) return;
    // Match the pill's "Couldn't Analyze" threshold (90s) so the recovery modal
    // fires the moment the pill shows failed, not 30s later.
    const STALE_MS = 90 * 1000;
    const stale = meals.meals.find(
      (m) => m.status === "processing" && Date.now() - m.ts > STALE_MS && !promptedStaleRef.current.has(m.id)
    );
    if (!stale) return;
    promptedStaleRef.current.add(stale.id);
    setFailedMealText("");
    setFailedMealPrompt({ mealId: stale.id, thumb: stale.imageThumb ?? undefined });
  }, [meals.meals, loadingData, failedMealPrompt, isDemoMode, runTour]);

  useEffect(() => {
    if (!user || loadingData) return;
    const key = `wya_walkthrough_${user.id}`;
    const gateKey = `wya_walkthrough_gate_${user.id}`;
    const activeKey = `wya_walkthrough_active_${user.id}`;
    const stageKey = `wya_walkthrough_stage_${user.id}`;
    const onboardingKey = `wya_onboarding_done_${user.id}`;
    const active = localStorage.getItem(activeKey) === "true";
    const stage = localStorage.getItem(stageKey) ?? "home";

    // Resume an in-progress walkthrough immediately — no need to wait on profile
    if (active && stage === "home") {
      if (localStorage.getItem(`wya_demo_mode_${user.id}`) === "true") setIsDemoMode(true);
      setRunTour(true);
      setShowTourGate(false);
      return;
    }

    // Sync Supabase flags to localStorage so reinstall/new phone works correctly
    if (ctxProfile?.onboardingDone) localStorage.setItem(onboardingKey, "true");
    if (ctxProfile?.walkthroughDone) {
      localStorage.setItem(key, "true");
      localStorage.setItem(gateKey, "true");
    }

    const onboardingDone = localStorage.getItem(onboardingKey);
    const seen = localStorage.getItem(key);
    const gateSeen = localStorage.getItem(gateKey);

    if (!seen && !active && !gateSeen) {
      if (!onboardingDone) {
        setShowOnboarding(true);
      } else {
        localStorage.setItem(gateKey, "true");
        setShowTourGate(true);
      }
    }

    // Check if streak saver was already dismissed today
    if (localStorage.getItem(`wya_streak_saver_dismissed_${user.id}_${todayKey()}`) === "true") {
      setStreakSaverDismissed(true);
    }
  }, [user, loadingData, ctxProfile]);

  const displayMeals = isDemoMode ? demoData.meals : meals.meals;
  const displayWorkouts = isDemoMode ? demoData.workouts : workout.workouts;
  const displayFeelLogs = isDemoMode ? demoData.feelLogs : homeFeelLogs;

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
    // Only bump wya_nudge_ts if user hasn't seen these nudge types yet today
    const seenTs = parseInt(localStorage.getItem("wya_nudge_seen_ts") ?? "0");
    const existingNudgeTs = parseInt(localStorage.getItem("wya_nudge_ts") ?? "0");
    // If the existing nudge_ts is already after seen_ts, the bell is already lit — don't re-stamp
    if (existingNudgeTs <= seenTs) {
      localStorage.setItem("wya_nudge_ts", Date.now().toString());
      window.dispatchEvent(new Event("wya_nudge_update"));
    }
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

  useEffect(() => {
    const handler = () => {
      setFailedMealNotice(true);
      setTimeout(() => setFailedMealNotice(false), 4000);
    };
    window.addEventListener(MEALS_FAILED_EVENT, handler as EventListener);
    return () => window.removeEventListener(MEALS_FAILED_EVENT, handler as EventListener);
  }, []);

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

  const feelLogsByLabel = useMemo(() => {
    const map: Record<string, FeelLog[]> = {};
    displayFeelLogs.forEach((log) => {
      const label = formatDayLabel(log.ts);
      if (!map[label]) map[label] = [];
      map[label].push(log);
    });
    return map;
  }, [displayFeelLogs]);

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

  const todayHasActivity = (() => {
    const key = todayKey();
    const hasMeal = displayMeals.some((m) => m.analysisJson?.source !== "supplement" && m.status !== "failed" && dayKeyFromTs(m.ts) === key);
    const hasWorkout = displayWorkouts.some((w) => dayKeyFromTs(w.startTs) === key);
    const hasFeelLog = displayFeelLogs.some((f) => dayKeyFromTs(f.ts) === key);
    return hasMeal || hasWorkout || hasFeelLog;
  })();

  const welcomeMessage = (() => {
    const hasEverLogged = displayMeals.some((m) => m.analysisJson?.source !== "supplement" && m.status !== "failed");
    if (!hasEverLogged) return { greeting: "Welcome!", sub: "Log Your First Meal!" };
    const hour = new Date().getHours();
    if (hour < 12) return { greeting: "Good Morning", sub: "Let's make today count!" };
    if (hour < 17) return { greeting: "Good Afternoon", sub: "Let's log and improve!" };
    return { greeting: "Good Evening", sub: "Better late than never!" };
  })();
  const firstName = profile?.firstName || (user as { user_metadata?: Record<string, string> })?.user_metadata?.first_name || "";

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

  useEffect(() => {
    if (!streakSaverInfo) return;
    setStreakButtonPulsing(false);
    const t = requestAnimationFrame(() => {
      requestAnimationFrame(() => setStreakButtonPulsing(true));
    });
    const off = setTimeout(() => setStreakButtonPulsing(false), 0.8 * 5 * 1000 + 100);
    return () => { cancelAnimationFrame(t); clearTimeout(off); };
  }, [!!streakSaverInfo]);

  const calMid = (homeMarkers.todayTotals.calories_min + homeMarkers.todayTotals.calories_max) / 2;
  const protMid = (homeMarkers.todayTotals.protein_g_min + homeMarkers.todayTotals.protein_g_max) / 2;
  const calPct = Math.min(100, Math.round((calMid / gentleTargetsDisplay.calories) * 100));
  const protPct = Math.min(100, Math.round((protMid / gentleTargetsDisplay.protein) * 100));
  const carbMid = (homeMarkers.todayTotals.carbs_g_min + homeMarkers.todayTotals.carbs_g_max) / 2;
  const fatMid = (homeMarkers.todayTotals.fat_g_min + homeMarkers.todayTotals.fat_g_max) / 2;
  const carbPct = Math.min(100, Math.round((carbMid / (homeMarkers.gentleTargets?.carbs ?? 277)) * 100));
  const fatPct = Math.min(100, Math.round((fatMid / (homeMarkers.gentleTargets?.fat ?? 77)) * 100));
  const showStatsBanner = !loadingData && !isDemoMode
    && displayMeals.filter((m) => m.analysisJson?.source !== "supplement").length >= 1
    && (!profile || profile.height === null || profile.weight === null || profile.age === null);

  const steps = [
    {
      target: '[data-tour="food-action"]',
      placement: "top" as const,
      disableBeacon: true,
      content: (
        <div>
          <p style={{ fontWeight: 600, marginBottom: 10 }}>Log Anything Here</p>
          <p>Tap the + to log food — by photo, barcode, or typing it — plus water and activity, all in one place.</p>
        </div>
      ),
    },
    {
      target: '[data-tour="water-bar"]',
      placement: "bottom" as const,
      disableBeacon: true,
      content: (
        <div>
          <p style={{ fontWeight: 600, marginBottom: 10 }}>Your Water Intake</p>
          <p>This tracks how much water you've had today relative to your daily goal.</p>
        </div>
      ),
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
      supabase.from("profiles").update({ walkthrough_done: true }).eq("user_id", user.id).then(() => {});
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

  const waterData = (() => {
    if (isDemoMode) {
      return { waterMl: 850, goalMl: 2000, displayGoal: "2000 ml", displayCurrent: "850 ml", pct: 43, addAmount: (_ml: number) => {}, remove: () => {}, unit: "ml" as const };
    }
    if (!user) return null;
    if (profile != null && !profile.trackWater) return null;
    const WATER_KEY = `wya_water_${user.id}_${todayKey()}`;
    const recommendedGoalMl = profile?.weight ? Math.min(3500, Math.max(1500, Math.round(profile.weight * 35 / 100) * 100)) : 2500;
    const customGoalMl = (() => { try { const v = parseInt(localStorage.getItem(`wya_water_goal_ml_${user.id}`) ?? "", 10); return isNaN(v) ? null : v; } catch { return null; } })();
    const goalMl = customGoalMl ?? recommendedGoalMl;
    const waterMl = (() => { try { return Math.max(0, parseInt(localStorage.getItem(WATER_KEY) ?? "0", 10) || 0); } catch { return 0; } })();
    const displayGoal = profile?.waterUnit === "oz" ? `${Math.round(goalMl / 29.5735)} oz` : `${goalMl} ml`;
    const displayCurrent = profile?.waterUnit === "oz" ? `${Math.round(waterMl / 29.5735)} oz` : `${waterMl} ml`;
    const pct = Math.min(100, Math.round((waterMl / goalMl) * 100));
    const addAmount = (ml: number) => {
      const newMl = waterMl + ml;
      try { localStorage.setItem(WATER_KEY, String(newMl)); } catch {}
      lastAddedWaterMlRef.current.push(ml);
      setWaterTick((t) => t + 1);
      upsertWaterLog(user.id, todayKey(), newMl).catch(() => {});
    };
    const remove = () => {
      const toRemove = lastAddedWaterMlRef.current.pop() ?? 100;
      const newMl = Math.max(0, waterMl - toRemove);
      try { localStorage.setItem(WATER_KEY, String(newMl)); } catch {}
      setWaterTick((t) => t + 1);
      upsertWaterLog(user.id, todayKey(), newMl).catch(() => {});
    };
    return { waterMl, goalMl, displayGoal, displayCurrent, pct, addAmount, remove, unit: (profile?.waterUnit ?? "ml") as "ml" | "oz" };
  })();

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
          scrollToFirstStep
          scrollOffset={80}
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
      {dailyLimitBanner && (
        <div className="fixed inset-x-0 top-0 z-50 animate-slide-down mx-auto max-w-md bg-white/60 backdrop-blur-xl border-b border-white/40 px-5 pb-4 safe-top">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-ink leading-snug">Daily Photo Limit Reached</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink/55">
                Try logging manually instead. Your limit resets at midnight.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDailyLimitBanner(false)}
              className="mt-0.5 text-ink/30 active:opacity-60"
              aria-label="Dismiss"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>
      )}
      {showOnboarding && user && (
        <OnboardingFlow
          userId={user.id}
          firstName={
            profile?.firstName ||
            (user as { user_metadata?: Record<string, string> }).user_metadata?.first_name ||
            ""
          }
          lastName={
            profile?.lastName ||
            (user as { user_metadata?: Record<string, string> }).user_metadata?.last_name ||
            ""
          }
          onComplete={() => {
            localStorage.setItem(`wya_onboarding_done_${user.id}`, "true");
            localStorage.setItem(`wya_walkthrough_gate_${user.id}`, "true");
            reload();
            setGateOverlay(true);
            setShowOnboarding(false);
            setShowTourGate(true);
            setTimeout(() => setGateOverlay(false), 200);
          }}
        />
      )}
      {gateOverlay && <div className="fixed inset-0 z-50 bg-white" />}
      {showTourGate && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-white/70 backdrop-blur-sm px-5">
          <div className="flex max-w-xs flex-col items-center text-center -mt-[10vh]">
            <div className="w-full px-5 py-1 text-center">
              <p className="text-[26px] font-semibold text-ink/80">
                Hey{" "}
                {profile?.firstName ||
                  (user as { user_metadata?: Record<string, string> })?.user_metadata?.first_name ||
                  "there"}
              </p>
            </div>
            <div className="mt-3 space-y-3 text-sm text-ink/70">
              <p className="text-[15px] font-semibold text-ink/80">Welcome to WhatYouAte!</p>
              <p>
                Log your meals, activity, and how you feel.
              </p>
              <p>
                Your AI Coach connects the dots and helps you spot patterns between what you eat and how you feel, perform, and recover.
              </p>
            </div>
          </div>
          <div className="mt-10 flex flex-col items-center gap-4">
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
              onClick={() => {
                if (user) {
                  localStorage.setItem(`wya_walkthrough_${user.id}`, "true");
                  supabase.from("profiles").update({ walkthrough_done: true }).eq("user_id", user.id).then(() => {});
                }
                setShowTourGate(false);
              }}
            >
              Explore On My Own
            </button>
          </div>
        </div>
      )}
      {workout.showStartWorkoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink">Log An Activity</h2>
            {workout.activeWorkout ? (
              <>
                <p className="mt-2 text-sm text-muted/70">An activity is already in progress.</p>
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
                    <span className="text-sm font-semibold text-white">Start Activity</span>
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
                    <span className="text-sm font-semibold text-ink">Manually Add Activity</span>
                    <span className="mt-0.5 text-xs text-muted/60">Log an activity you already completed</span>
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
            <h2 className="text-base font-semibold text-ink">End Activity</h2>
            <p className="mt-2 text-sm text-muted/70">
              {workout.activeWorkout ? "Confirm your activity details." : "No active activity in progress."}
            </p>
            {workout.activeWorkout && (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                    Activity type
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
                  {workout.isEndingWorkout ? "Ending…" : "End Activity"}
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
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 safe-top">
        <header className="mb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1
                className="text-2xl font-semibold text-ink select-none"
              >
                WhatYouAt<span className="relative inline-block">e
                  <span className="absolute -top-1 right-0 translate-x-[10px] text-[9px] font-semibold text-ink/60">
                    AI
                  </span>
                </span>
              </h1>
              {streak >= 1 && (() => {
                const todayMeals = meals.meals.filter((m) => m.analysisJson?.source !== "supplement" && m.status !== "failed" && dayKeyFromTs(m.ts) === todayKey());
                const atRisk = todayMeals.length === 0 && new Date().getHours() >= 18;
                const saveable = !!streakSaverInfo;
                return (
                  <button
                    type="button"
                    aria-label={`Streak: ${streak} days`}
                    onClick={() => {
                      if (!streakSaverInfo) return;
                      setStreakSaverMode(true);
                      meals.openManualMealEntry();
                      meals.setManualDate(streakSaverInfo.yesterdayStr);
                    }}
                    className={`ml-2 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 ${(saveable || atRisk) ? "animate-wiggle" : ""} ${streakBouncing ? "animate-streak-bounce" : ""}`}
                  >
                    <svg width="14" height="16" viewBox="0 0 13 15" fill="none" aria-hidden="true" className="animate-flame">
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
                  </button>
                );
              })()}
            </div>
            <div className="flex items-center gap-2">
            {showStatsBanner && (
              <Link href="/profile" className="text-[11px] font-medium text-primary/70">
                Fill Out Profile
              </Link>
            )}
            <Link
              href="/profile"
              data-tour="nav-profile"
              className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-primary/30 bg-primary/10 shadow-[0_2px_8px_rgba(111,168,255,0.20)] hover:bg-primary/15 transition-colors"
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
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                </svg>
              )}
              {showProfileBell && (
                <span className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-primary/25 bg-primary text-[8px] text-white animate-pulse shadow-[0_4px_10px_rgba(15,23,42,0.18)]">
                  <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" />
                    <path d="M9 17a3 3 0 0 0 6 0" />
                  </svg>
                </span>
              )}
            </Link>
            </div>
          </div>
          <p className="mt-1 pl-0.5 text-[13px] text-muted/70">Eat Confidently | Feel Better</p>
          {!loadingData && mealCount === 0 && !isDemoMode && (
            <p className="mt-3 text-[11px] text-muted/60">
              Take a photo of your first meal to get started.
            </p>
          )}
          {loadError && <p className="mt-2 text-[11px] text-muted/60">{loadError}</p>}
          {failedMealNotice && (
            <p className="mt-2 text-[11px] text-muted/60">One or more meals couldn't be analysed and were removed from your log.</p>
          )}
        </header>

        {/* Trial progress / expired banner + optional profile nudge */}
        {(() => {
          return (
            <>
              {!isDemoMode && trial.isTrialActive && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={openUpgradeModal}
                    className="w-full rounded-xl border border-primary/15 bg-primary/[0.08] px-4 py-2.5 text-left transition active:opacity-70"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-medium text-ink/60">
                        Free Trial · Day {trial.currentDay} of 7
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
                </div>
              )}
              {!isDemoMode && trial.isFree && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={openUpgradeModal}
                    className="w-full rounded-xl border border-primary/25 bg-primary/10 px-4 py-2.5 text-left transition active:opacity-70"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-medium text-ink/60">Free Trial Ended</span>
                      <span className="text-[11px] text-primary font-semibold">Upgrade Now →</span>
                    </div>
                  </button>
                </div>
              )}
              {!isDemoMode && !trial.isTrialActive && !trial.isFree && showStatsBanner && (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-primary/15 bg-primary/[0.06] px-4 py-2.5">
                  <p className="text-[12px] text-ink/60">Fill Out Your Profile For Better Results</p>
                  <Link href="/profile" className="shrink-0 text-[11px] font-semibold text-primary">
                    Set up →
                  </Link>
                </div>
              )}
            </>
          );
        })()}

        <Card className="mt-2" style={riseIn(barsReady && habitLoaded, 0)}>
          {/* Hero — dynamic slot. Priority: active habit builder > suggestion > reflection reminder > discovery > wins > greeting (default). Sample habit wired locally for now. */}
          <div className={`-mx-4 rounded-2xl border-2 border-primary/25 px-4 ${heroHabit.status === "done" || heroHabit.status === "accepting" ? "bg-primary/10" : "bg-primary/[0.05]"} ${heroHabit.status === "hidden" ? "py-7" : heroHabit.status === "done" && doneStep === "rested" ? "pt-5 pb-3" : "py-5"} ${heroHabit.status === "done" && (doneStep === "celebrate" || doneStep === "feedback") ? "animate-habit-built" : ""} ${(heroHabit.status === "done" && doneStep === "rested") || heroHabit.status === "accepting" ? "animate-habit-glow" : ""} ${(heroHabit.status === "active" && heroHabit.holdDay != null) || (heroHabit.status === "suggested" && !heroExpanded) ? "animate-habit-shimmer" : ""} ${heroPulse ? "animate-card-pulse" : ""}`}>
            {heroHabit.status === "suggested" ? (
              <div className={heroExpanded ? "" : "animate-habit-note"}>
                {/* Tap the eyebrow to cycle templates (demo/testing). On first appearance
                    the word bounces once while the card shimmers. */}
                <p className={`-mt-1 cursor-pointer text-center text-xs font-semibold uppercase tracking-wide text-primary transition active:opacity-60 ${heroExpanded ? "" : "animate-habit-bounce"}`} role="button" aria-label="Next template (testing)" onClick={cycleTemplate}>Habit Builder</p>
                {/* Collapsed "notification" expands smoothly into the full card. */}
                <div className={`grid transition-all duration-[800ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${heroExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                  <div className="min-h-0 overflow-hidden">
                    <p className="mt-1 text-base font-semibold text-ink">{activeTemplate.title}</p>
                    <p className="mt-0.5 text-[13px] text-ink/70">{activeTemplate.ask}</p>
                    <p className="mt-2 text-xs leading-relaxed text-ink/80"><span className="font-semibold text-ink">Why: </span>{fillWhy(activeTemplate)}</p>
                    {activeTemplate.ideas && activeTemplate.ideas.length > 0 && (
                      <div className="mt-2.5">
                        <button type="button" onClick={() => setShowHabitIdeas((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary/80 transition active:opacity-60">
                          What Helps?
                          <svg viewBox="0 0 24 24" className={`h-3 w-3 transition-transform ${showHabitIdeas ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                        </button>
                        {showHabitIdeas && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {activeTemplate.ideas.map((f) => (
                              <span key={f} className="flex-1 whitespace-nowrap rounded-full border border-primary/15 bg-primary/[0.05] px-2.5 py-1 text-center text-[11px] text-ink/70">{f}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      className="mt-4 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
                      onClick={() => { unlockAudio(); setHeroHabit((h) => ({ ...h, status: "accepting" })); }}
                    >
                      Let&apos;s Do It!
                    </button>
                    <div className="mt-2 flex items-center justify-center gap-3">
                      <button type="button" className="text-xs font-medium text-ink/50 transition active:opacity-60" onClick={() => dismissSuggestion(false)}>Maybe Later</button>
                      <span className="text-ink/20">·</span>
                      <button type="button" className="text-xs font-medium text-ink/50 transition active:opacity-60" onClick={() => dismissSuggestion(true)}>No Thanks</button>
                    </div>
                  </div>
                </div>
              </div>
            ) : heroHabit.status === "accepting" ? (
              <div className="text-center">
                <p className="-mt-1 text-center text-xs font-semibold uppercase tracking-wide text-primary">Habit Builder</p>
                <div className="flex flex-col items-center py-2">
                  <span className="mt-1.5 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white animate-habit-pop">
                    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>
                  </span>
                  <p className="mt-3 text-base font-semibold text-ink">You&apos;re In!</p>
                  <p className="mt-1 text-[13px] text-ink/70">{activeTemplate.title}</p>
                </div>
              </div>
            ) : heroHabit.status === "committed" ? (
              // Reached only when accepted after 10am (before 10am it auto-starts today).
              // Tap anywhere to advance into the tracker — demo/testing only, simulating
              // tomorrow arriving (the real version auto-advances overnight).
              <div
                className="cursor-pointer text-center"
                role="button"
                aria-label="Start habit (testing)"
                onClick={() => setHeroHabit((h) => ({ ...h, status: "active" }))}
              >
                <p className="-mt-1 text-center text-xs font-semibold uppercase tracking-wide text-primary">Habit Builder</p>
                <div className="flex flex-col items-center py-1">
                  <span className="mt-1.5 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><g className="animate-clock-wind"><path d="M12 7.5V12l3 1.5" /></g></svg>
                  </span>
                  <p className="mt-1.5 text-base font-semibold text-ink">Starts Tomorrow</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink/70">{activeTemplate.title}. We&apos;ll nudge you in the morning to begin.</p>
                </div>
              </div>
            ) : heroHabit.status === "missed" ? (
              <div className="text-center">
                <p className="-mt-1 text-center text-xs font-semibold uppercase tracking-wide text-primary">Habit Builder</p>
                <div className="flex flex-col items-center py-1">
                  <span className="mt-1 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><line x1="3" y1="9.5" x2="21" y2="9.5" /><line x1="8" y1="3" x2="8" y2="6.5" /><line x1="16" y1="3" x2="16" y2="6.5" /><line x1="10.5" y1="15" x2="13.5" y2="15" /></svg>
                  </span>
                  <p className="mt-2 text-base font-semibold text-ink">Oh no, we missed a day!</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink/70">That's okay, sometimes building habits takes time.</p>
                </div>
                <button
                  type="button"
                  className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
                  onClick={() => setHeroHabit((h) => ({ ...h, status: "active" }))}
                >
                  Extend
                </button>
                <button
                  type="button"
                  className="mt-2 w-full py-1 text-xs font-medium text-ink/45 transition active:opacity-60"
                  onClick={() => setHeroHabit({ status: "suggested", days: freshDays(activeTemplate) })}
                >
                  Try Again Later
                </button>
              </div>
            ) : heroHabit.status === "active" ? (
              (() => {
                // During the post-completion pause, holdDay keeps the just-finished day
                // on screen (all buttons blue) instead of jumping to the next day.
                const current = heroHabit.holdDay != null ? heroHabit.holdDay : heroHabit.days.findIndex((day) => !day.every(Boolean));
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-base font-semibold text-ink">{activeTemplate.title}</p>
                      {/* Tapping the day label simulates a missed day (demo/testing only). */}
                      <p className="cursor-pointer text-xs font-medium text-muted/60 transition active:opacity-60" role="button" aria-label="Simulate missed day (testing)" onClick={() => setHeroHabit((h) => ({ ...h, status: "missed" }))}>Day {current + 1} of {activeTemplate.durationDays}</p>
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink/70">{activeTemplate.ask}</p>
                    <div className="mt-3 flex gap-2">
                      {activeTemplate.checkpoints.map((slot, s) => {
                        const checked = heroHabit.days[current][s];
                        return (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => completeCheckpoint(s)}
                            className={`flex h-11 flex-1 items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition active:scale-[0.97] ${
                              checked
                                ? "bg-primary text-white"
                                : "border-2 border-primary/30 bg-white text-ink/70 shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
                            }`}
                          >
                            {checked && (
                              <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>
                            )}
                            {slot}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex items-center justify-center gap-2">
                      {heroHabit.days.map((day, d) => {
                        const complete = day.every(Boolean);
                        return (
                          <span key={d} className={`h-2 w-2 rounded-full ${complete ? "bg-primary" : d === current ? "bg-primary/40" : "bg-ink/15"}`} />
                        );
                      })}
                    </div>
                    <p className="mt-2 text-center text-[11px] text-ink/55">Tap each one as you complete it.</p>
                    {/* Small and tucked into the bottom-right so it stays out of the way of the check-in. */}
                    {activeTemplate.ideas && activeTemplate.ideas.length > 0 && (
                      <div className="-mt-1 flex flex-col items-end">
                        <button type="button" onClick={() => setShowHabitIdeas((v) => !v)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary/70 transition active:opacity-60">
                          <svg viewBox="0 0 24 24" className={`h-2.5 w-2.5 transition-transform ${showHabitIdeas ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                          What Helps?
                        </button>
                        {showHabitIdeas && (
                          <div className="mt-2 flex w-full flex-wrap gap-1.5">
                            {activeTemplate.ideas.map((f) => (
                              <span key={f} className="flex-1 whitespace-nowrap rounded-full border border-primary/15 bg-primary/[0.05] px-2.5 py-1 text-center text-[11px] text-ink/70">{f}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()
            ) : heroHabit.status === "dayComplete" ? (
              (() => {
                const completedDays = heroHabit.days.filter((d) => d.every(Boolean)).length;
                const total = activeTemplate.durationDays;
                const line =
                  completedDays === 1
                    ? pickLine(HABIT_FIRST_DAY_LINES, activeTemplate.id + "-first")
                    : completedDays === total - 1
                    ? pickLine(HABIT_ALMOST_LINES, activeTemplate.id + "-almost")
                    : pickLine(HABIT_MID_LINES, activeTemplate.id + "-" + completedDays).replace(/\{n\}/g, String(completedDays));
                return (
                  // Tapping the body simulates the next day (demo only; real version rolls over at midnight).
                  <div
                    className="relative cursor-pointer text-center"
                    role="button"
                    aria-label="Continue to next day"
                    onClick={() => setHeroHabit((h) => ({ ...h, status: "active" }))}
                  >
                    <button
                      type="button"
                      className="absolute right-0 top-0 text-[11px] font-medium text-ink/45 transition active:opacity-60"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHeroHabit((h) => {
                          const target = h.days.filter((d) => d.every(Boolean)).length - 1;
                          const days = h.days.map((day, di) => di === target ? day.map(() => false) : day);
                          return { ...h, days, status: "active" };
                        });
                      }}
                    >
                      Undo
                    </button>
                    <div className="flex flex-col items-center py-1">
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white animate-habit-pop">
                        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>
                      </span>
                      <p className="mt-3 text-base font-semibold text-ink">Done For Today</p>
                      <p className="mt-1 text-[13px] text-ink/70">{line}</p>
                    </div>
                  </div>
                );
              })()
            ) : heroHabit.status === "done" ? (
              doneStep === "dayDone" ? (
                <div className="text-center">
                  <div className="flex flex-col items-center py-1">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white animate-habit-pop">
                      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>
                    </span>
                    <p className="mt-3 text-base font-semibold text-ink">Done For Today</p>
                    <p className="mt-1 text-[13px] text-ink/70">{pickLine(HABIT_DONE_LINES, activeTemplate.id + "-done").replace(/\{n\}/g, String(activeTemplate.durationDays))}</p>
                  </div>
                </div>
              ) : doneStep === "started" ? (
                <div className="py-1 text-center animate-fadeIn">
                  <p className="text-base font-semibold text-ink">You Started Something!</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink/80">Keep following through and we'll keep building, brick by brick. This is how feeling better stops being a project and just becomes how you live.</p>
                  <button
                    type="button"
                    className="mt-4 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
                    onClick={() => setDoneStep("celebrate")}
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div className="text-center">
                  <div className="flex flex-col items-center py-2">
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-white animate-habit-pop">
                      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>
                    </span>
                    <p className="mt-3 text-lg font-semibold text-ink">You Built A Habit!</p>
                    {/* The second line and the feedback buttons share this slot: the line
                        shows while the celebration lands, the buttons fade in to replace it,
                        then the line returns once a rating is picked. */}
                    {doneStep === "feedback" ? (
                      <div className="mt-3 w-full animate-fadeIn">
                        <div className="grid w-full grid-cols-3 gap-2">
                          {["Not Really", "Maybe", "Yes!"].map((r) => (
                            <button
                              key={r}
                              type="button"
                              disabled={ratingPicked !== null}
                              className={`rounded-lg border px-2 py-2 text-xs font-medium leading-tight transition active:scale-[0.95] ${ratingPicked === r ? "animate-streak-bounce border-primary bg-primary/10 text-primary" : "border-primary/25 bg-white text-ink/70"}`}
                              onClick={() => {
                                if (ratingPicked) return;
                                setRatingPicked(r);
                                setBuiltHabitKeep(r === "Yes!" ? "yes" : r === "Maybe" ? "maybe" : "no");
                                setTimeout(() => setDoneStep("rested"), 720);
                              }}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                        <p className="mt-2 text-[12px] text-ink/60">Do you think you'll keep this up?</p>
                      </div>
                    ) : (
                      <>
                        <p className="mt-1 text-[13px] text-ink/70 animate-fadeIn">{activeTemplate.durationDays} days of {activeTemplate.noun}, done.</p>
                        {doneStep === "rested" && (
                          <p className="mt-4 text-[8px] font-medium uppercase tracking-wide text-ink/35 animate-fadeIn">Resets tomorrow</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            ) : (
              <div className="text-center">
                <p className="text-lg font-semibold text-ink">{welcomeMessage.greeting}{firstName ? `, ${firstName}` : ""}</p>
                <p className="mt-1 text-sm text-muted/60">{welcomeMessage.sub}</p>
                <button type="button" onClick={startHabitManually} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary/80 transition active:opacity-60">
                  Start a Habit
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-ink/8 pt-3">
            <div className="flex gap-3">
              <div className="flex flex-1 items-baseline gap-1.5">
                <span className="text-lg font-semibold text-ink">{formatClean(homeMarkers.todayTotals.calories_min, homeMarkers.todayTotals.calories_max)}</span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Calories</span>
              </div>
              <div className="flex flex-1 items-baseline gap-1.5">
                <span className="text-lg font-semibold text-ink">{formatClean(homeMarkers.todayTotals.protein_g_min, homeMarkers.todayTotals.protein_g_max, "g")}</span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Protein</span>
              </div>
            </div>
            {mealCount > 0 && (
              <div className="mt-2.5 flex gap-3">
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
            {mealCount > 0 && (
              <div className="mt-2.5 flex gap-3">
                <div className="flex flex-1 items-center gap-2">
                  <span className="whitespace-nowrap text-[11px] text-muted/55"><span className="font-semibold text-ink/65">{formatClean(homeMarkers.todayTotals.carbs_g_min, homeMarkers.todayTotals.carbs_g_max, "g")}</span> Carbs</span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/5">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${barsReady ? carbPct : 0}%`, transition: "width 700ms cubic-bezier(0.22,1,0.36,1) 160ms" }} />
                  </div>
                </div>
                <div className="flex flex-1 items-center gap-2">
                  <span className="whitespace-nowrap text-[11px] text-muted/55"><span className="font-semibold text-ink/65">{formatClean(homeMarkers.todayTotals.fat_g_min, homeMarkers.todayTotals.fat_g_max, "g")}</span> Fat</span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/5">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${barsReady ? fatPct : 0}%`, transition: "width 700ms cubic-bezier(0.22,1,0.36,1) 240ms" }} />
                  </div>
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            className="mt-2 flex items-center gap-1 text-left text-[10px] text-muted/70 transition active:opacity-60"
            onClick={() => setShowTargetInfo((v) => !v)}
          >
            <span>Target Range<span className="text-muted/65">{!loadingData && mealCount === 0 && !profile ? " (preview)" : ""}</span>: {gentleTargetsDisplay.calories} kcal · {gentleTargetsDisplay.protein}g protein · {homeMarkers.gentleTargets?.carbs ?? 277}g carbs · {homeMarkers.gentleTargets?.fat ?? 77}g fat</span>
            <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-muted/40 text-[8px] text-muted/65">i</span>
          </button>
          {showTargetInfo && (
            <p className="mt-1 text-[10px] text-muted/65">
              {mealCount >= 10 && profile?.weight
                ? "Based on your recent intake pattern, adjusted for your goal."
                : profile?.weight && profile?.activityLevel
                ? "Based on your weight, activity level, and goal."
                : "Standard Estimate · Complete Your Profile To Personalize."}
            </p>
          )}
          {waterData && waterTick >= 0 && (
            <div className="mt-4 border-t border-ink/8 pt-3" data-tour="water-bar">
              <WaterBar
                pct={waterData.pct}
                displayCurrent={waterData.displayCurrent}
                displayGoal={waterData.displayGoal}
              />
            </div>
          )}
        </Card>

        {showWeightPrompt && (
          <div className="mt-3 rounded-2xl border-2 border-primary/25 bg-primary/[0.05] px-4 py-3 animate-card-fade">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink">Quick Weight Check-In</p>
                <p className="mt-0.5 text-xs text-muted/70">It&apos;s been a while. A quick update keeps your coach and targets accurate.</p>
              </div>
              <button type="button" onClick={dismissWeightPrompt} aria-label="Not now" className="-mr-1 -mt-1 p-1 text-ink/35 transition active:opacity-60">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <div className="flex items-center rounded-xl border border-primary/25 bg-white px-3 py-2">
                <input
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value.replace(/[^0-9.]/g, ""))}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-16 bg-transparent text-sm font-semibold text-ink outline-none"
                />
                <span className="text-xs text-muted/60">{weightUnitLabel}</span>
              </div>
              <button
                type="button"
                onClick={saveWeightPrompt}
                disabled={savingWeight || !weightInput}
                className="ml-auto rounded-xl bg-primary px-5 py-2 text-xs font-semibold text-white transition active:opacity-80 disabled:opacity-40"
              >
                {savingWeight ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Reflection entry point. Demo: always shown. Real version: appears in the
            evening (after the night push / after ~6pm) and persists until done. */}
        <div className="mt-2" style={riseIn(barsReady && habitLoaded, 1)}>
          <button
            type="button"
            onClick={() => setShowReflection(true)}
            className="flex w-full items-center gap-3 rounded-2xl border-2 border-primary/25 bg-primary/[0.05] px-4 py-3 text-left transition active:scale-[0.99]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" /></svg>
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold text-ink">How Was Your Day?</span>
              <span className="block text-[12px] text-ink/55">A quick nightly check-in</span>
            </span>
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink/30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>

        {workout.activeWorkout && (
          <p className="mt-3 text-center text-[11px] text-muted/60">Workout in progress</p>
        )}

        <Card className="mt-2" style={riseIn(barsReady && habitLoaded, 2)}>
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
            <span className="col-span-1 text-right">Activity</span>
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
                      const isReanalyzing = reanalyzingMealIds.has(meal.id);
                      const isShimmer = isReanalyzing || (meal.status === "processing" && Date.now() - meal.ts < 90_000);
                      const isStaleOrFailed = !isReanalyzing && ((meal.status === "processing" && Date.now() - meal.ts >= 90_000) || meal.status === "failed");
                      const isRecentQuickAdd = recentQuickAddRef.current > 0
                        && Math.abs(meal.ts - recentQuickAddRef.current) < 30_000;
                      return (
                      <div
                        key={`${meal.id}-${meal.calories}-${meal.protein}`}
                        onClick={() => {
                          if (isStaleOrFailed) {
                            setFailedMealText(meal.analysisJson?.name ?? "");
                            setFailedMealPrompt({ mealId: meal.id, thumb: meal.imageThumb ?? undefined });
                            return;
                          }
                          if (!editRecents) return;
                          if (meal.analysisJson?.source === "supplement") {
                            setPendingDelete({ type: "meal", id: meal.id });
                          } else {
                            meals.openMealEditor(meal);
                          }
                        }}
                        className={`inline-flex w-full items-start justify-between rounded-full border border-primary/25 px-3 py-1.5 text-xs text-ink/80 ${editRecents ? "cursor-pointer animate-wiggle bg-primary/10" : isStaleOrFailed ? "cursor-pointer animate-pill-in bg-ink/5 border-ink/10" : (isShimmer ? "animate-shimmer" : isRecentQuickAdd ? "bg-primary/10" : "animate-pill-in bg-primary/10")}`}
                        style={{
                          ...(isShimmer ? { background: "linear-gradient(90deg, #eff6ff 0%, #dbeafe 40%, #eff6ff 60%, #eff6ff 100%)", backgroundSize: "200% 100%" } : {}),
                          ...(!editRecents && !isShimmer ? { animationDelay: `${idx * 80}ms` } : {})
                        }}
                      >
                        <span className="flex flex-col">
                          {meal.status === "processing" || isReanalyzing ? (
                            isShimmer ? "Analyzing Food…" : (
                              <span className="flex items-center gap-1.5 text-ink/50">
                                <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                                Couldn't Analyze
                              </span>
                            )
                          ) : meal.status === "failed" ? (
                            <span className="flex items-center gap-1.5 text-ink/50">
                              <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                              Couldn't Analyze
                            </span>
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
                    {group.workouts.map((w, wi) => (
                      <div
                        key={w.id}
                        onClick={() => {
                          if (editRecents) workout.openWorkoutEditor(w);
                        }}
                        className={`flex w-full flex-col items-center justify-center rounded-full border border-ink/10 bg-white px-3 py-0.5 text-[11px] text-ink/60 leading-tight shadow-[0_0_8px_rgba(111,168,255,0.12)] ${editRecents ? "cursor-pointer animate-wiggle-neutral" : "animate-pill-in"}`}
                        style={editRecents ? undefined : { animationDelay: `${wi * 35}ms` }}
                      >
                        <span className="font-semibold text-ink/60">
                          {formatWorkoutDurationLines(w).title}
                        </span>
                        <span className="-mt-0.5">{formatWorkoutDurationLines(w).detail}</span>
                      </div>
                    ))}
                    {(feelLogsByLabel[group.label] ?? []).map((log, fi) => {
                      const d = new Date(log.ts);
                      const h = d.getHours() % 12 || 12;
                      const period = d.getHours() < 12 ? "am" : "pm";
                      return (
                        <div
                          key={log.id}
                          onClick={() => {
                            if (editRecents) {
                              setEditingFeelLog(log);
                              setEditFeelTag(log.tag);
                              const d = new Date(log.ts);
                              setEditFeelDate(d.toISOString().slice(0, 10));
                              setEditFeelTime(d.toTimeString().slice(0, 5));
                            }
                          }}
                          className={`flex w-full flex-col items-center justify-center rounded-full border border-ink/10 bg-white px-3 py-1 text-[11px] text-ink/60 leading-tight shadow-[0_0_8px_rgba(111,168,255,0.12)] ${editRecents ? "cursor-pointer animate-wiggle-neutral" : "animate-pill-in"}`}
                          style={editRecents ? undefined : { animationDelay: `${fi * 35}ms` }}
                        >
                          <span className="font-semibold text-ink/60">{feelLabel(log.tag)}</span>
                          <span className="text-[10px] text-ink/55">{h}:{String(d.getMinutes()).padStart(2, "0")}{period}</span>
                        </div>
                      );
                    })}
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
                <h3 className="text-base font-semibold text-ink">Delete Meal</h3>
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
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-ink">Add Food</h2>
                  {streakSaverMode && meals.manualDate === streakSaverInfo?.yesterdayStr && (
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary/80">Yesterday</span>
                  )}
                </div>
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
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-ink/50" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="2" width="6" height="11" rx="3" />
                          <path d="M5 10a7 7 0 0 0 14 0" />
                          <line x1="12" y1="19" x2="12" y2="22" />
                          <line x1="9" y1="22" x2="15" y2="22" />
                        </svg>
                        <p className="text-[11px] text-ink/55">Tap your keyboard microphone to speak your meal</p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <ManualDateRow manualDate={meals.manualDate} setManualDate={meals.setManualDate} />
                    </div>
                    {meals.manualError && (
                      <p className="mt-3 text-xs text-red-500">{meals.manualError}</p>
                    )}
                    <div className="mt-5 flex justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                        onClick={() => { meals.setEditingMeal(null); setEditRecents(false); setStreakSaverMode(false); }}
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
                    <div className="mt-3"><ManualDateRow manualDate={meals.manualDate} setManualDate={meals.setManualDate} /></div>
                    <div className="mt-5 flex items-center justify-between">
                      <button
                        type="button"
                        className="text-xs text-ink/50 underline transition active:opacity-50"
                        onClick={() => { meals.clearManualTextCache(); meals.setManualResult(null); }}
                      >
                        Try again
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
                      onClick={() => { meals.setEditingMeal(null); setEditRecents(false); setStreakSaverMode(false); }}
                    >
                      Cancel
                    </button>
                    {meals.editForm.name.trim().toLowerCase() !== editOriginalName.trim().toLowerCase() && (
                      <button
                        type="button"
                        className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                        onClick={handleEditReanalyze}
                        disabled={meals.updatingMeal}
                      >
                        Re-Analyze
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                      onClick={() => meals.handleUpdateMeal(editPortion)}
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

      {showLogFood && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          onClick={closeLogFood}
        >
          <div className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ease-out ${logFoodClosing ? "opacity-0" : "opacity-100"}`} />
          <div
            className={`relative w-full max-w-md rounded-t-2xl bg-white px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+2.5rem)] shadow-xl ${logFoodClosing ? "animate-drawer-down" : "animate-drawer-up"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-ink/15" />
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Log Food</h2>
              <button
                type="button"
                className="text-xs font-semibold text-ink/50 transition active:opacity-60"
                onClick={closeLogFood}
              >
                Cancel
              </button>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              <button
                type="button"
                className="relative flex flex-col items-center justify-center gap-1.5 rounded-xl bg-primary px-1 py-3 text-center text-[11px] font-semibold leading-tight text-white shadow-[0_4px_12px_rgba(15,23,42,0.12)] transition active:scale-[0.97] active:bg-primary/90"
                onClick={() => {
                  setShowLogFood(false);
                  if (trial.isFree && !isDemoMode) { openUpgradeModal(); return; }
                  handleFoodPhotoClick();
                }}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span>Photo</span>
                {trial.isFree && !isDemoMode && (
                  <span className="absolute right-1 top-1">
                    <svg viewBox="0 0 24 24" className="h-3 w-3 text-white/60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                )}
              </button>
              <button
                type="button"
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-primary px-1 py-3 text-center text-[11px] font-semibold leading-tight text-white shadow-[0_4px_12px_rgba(15,23,42,0.12)] transition active:scale-[0.97] active:bg-primary/90"
                onClick={() => { setShowLogFood(false); meals.openManualMealEntry(); }}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
                </svg>
                <span>Manual Add</span>
              </button>
              <button
                type="button"
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-primary px-1 py-3 text-center text-[11px] font-semibold leading-tight text-white shadow-[0_4px_12px_rgba(15,23,42,0.12)] transition active:scale-[0.97] active:bg-primary/90"
                onClick={() => { setShowLogFood(false); setBarcodeOpen(true); }}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 5v14M7 5v14M11 5v14M16 5v14M20 5v14" />
                </svg>
                <span>Barcode</span>
              </button>
              <button
                type="button"
                className="flex flex-col items-center justify-center gap-1.5 rounded-xl bg-primary px-1 py-3 text-center text-[11px] font-semibold leading-tight text-white shadow-[0_4px_12px_rgba(15,23,42,0.12)] transition active:scale-[0.97] active:bg-primary/90"
                onClick={() => { setShowLogFood(false); handleOpenQuickAdd(); }}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>Quick Add</span>
              </button>
            </div>
            <h2 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-muted/60">Log</h2>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                className="flex w-[calc((100%-1.5rem)/4)] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-ink/10 bg-white px-1 py-3 text-center text-[11px] font-semibold leading-tight text-ink/80 transition active:scale-[0.97] active:bg-primary/5"
                onClick={() => { setShowLogFood(false); setSelectedFeelings([]); setShowFeelingModal(true); }}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-primary" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M9 10h.01M15 10h.01M8.5 14.5a4 4 0 0 0 7 0" />
                </svg>
                <span>Feeling</span>
              </button>
              <button
                type="button"
                className="flex w-[calc((100%-1.5rem)/4)] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-ink/10 bg-white px-1 py-3 text-center text-[11px] font-semibold leading-tight text-ink/80 transition active:scale-[0.97] active:bg-primary/5"
                onClick={() => { setShowLogFood(false); workout.activeWorkout ? workout.setShowEndWorkoutModal(true) : workout.setShowStartWorkoutModal(true); }}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-primary" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
                <span>{workout.activeWorkout ? "End Activity" : "Activity"}</span>
              </button>
              {waterData && (
                <button
                  type="button"
                  className="flex w-[calc((100%-1.5rem)/4)] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-ink/10 bg-white px-1 py-3 text-center text-[11px] font-semibold leading-tight text-ink/80 transition active:scale-[0.97] active:bg-primary/5"
                  onClick={() => { setShowLogFood(false); setWaterModalOpen(true); }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <linearGradient id="sheet-drop" x1="0.35" y1="0" x2="0.65" y2="1">
                        <stop offset="0%" stopColor="#BAD8FF" />
                        <stop offset="45%" stopColor="#93C5FD" />
                        <stop offset="100%" stopColor="#6FA8FF" />
                      </linearGradient>
                    </defs>
                    <path d="M12 3C11.4 3 5 11 5 15.5a7 7 0 0 0 14 0C19 11 12.6 3 12 3z" fill="url(#sheet-drop)" />
                  </svg>
                  <span>Water</span>
                </button>
              )}
            </div>
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
                className={`rounded-xl px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-50 ${failedMealAnalyzing ? "animate-shimmer" : "bg-primary hover:bg-primary/90"}`}
                onClick={handleFailedMealSubmit}
                disabled={failedMealAnalyzing || !failedMealText.trim()}
              >
                {failedMealAnalyzing ? "Analyzing…" : "Analyze"}
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
              {quickConfirmName.trim() && quickConfirmName.trim().toLowerCase() !== quickConfirmOriginalName.trim().toLowerCase() ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5 disabled:opacity-50"
                    onClick={() => handleQuickConfirm(false)}
                    disabled={quickConfirming}
                  >
                    Fix name
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                    onClick={() => handleQuickConfirm(true)}
                    disabled={quickConfirming}
                  >
                    Re-analyze
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                  onClick={() => handleQuickConfirm(false)}
                  disabled={quickConfirming || !quickConfirmName.trim()}
                >
                  {quickConfirming ? "Saving…" : "Looks good"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {workout.editingWorkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            {pendingDelete?.type === "workout" ? (
              <>
                <h2 className="text-base font-semibold text-ink">Delete Activity</h2>
                <p className="mt-2 text-sm text-muted/70">
                  Are you sure you want to delete this activity?
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
                <h2 className="text-base font-semibold text-ink">Edit Activity</h2>
                <p className="mt-2 text-sm text-muted/70">Update your activity details.</p>

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
                      Activity type
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
            <h2 className="text-base font-semibold text-ink">Add Activity</h2>
            <p className="mt-1 text-sm text-muted/70">Log an activity you already completed.</p>

            <div className="mt-4 space-y-4">
              <div className="overflow-hidden">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                  Date
                </p>
                <input
                  type="date"
                  className="mt-2 w-full rounded-lg border border-ink/10 bg-white px-2.5 py-1.5 text-xs text-ink/80"
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
                  Activity type
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
                {workout.addingManual ? "Saving..." : "Save activity"}
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
            <p className="mt-1 text-xs text-muted/60">This barcode isn&apos;t in our database. Describe what it is and we&apos;ll estimate the nutrition.</p>
            <input
              type="text"
              className="mt-3 w-full rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5 text-sm text-ink placeholder:text-muted/45 focus:outline-none focus:ring-1 focus:ring-primary/30"
              placeholder="e.g. Greek yogurt, protein bar…"
              value={barcodeNotFoundText}
              onChange={(e) => setBarcodeNotFoundText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && barcodeNotFoundText.trim()) handleBarcodeNotFoundSubmit(); }}
              autoFocus
            />
            <div className="mt-3 flex gap-2 justify-end">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-4 py-2 text-xs font-semibold text-ink/70 transition active:opacity-60"
                onClick={() => { setBarcodeNotFound(false); setBarcodeNotFoundText(""); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition active:opacity-80 disabled:opacity-40"
                onClick={handleBarcodeNotFoundSubmit}
                disabled={barcodeNotFoundAnalyzing || !barcodeNotFoundText.trim()}
              >
                {barcodeNotFoundAnalyzing ? "Adding…" : "Add"}
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

      {/* Feel modal */}
      {/* Edit Feel Log modal */}
      {editingFeelLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5">
          <div className="w-full max-w-sm rounded-2xl bg-white px-5 pb-6 pt-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Edit Feeling</h2>
              <button
                type="button"
                onClick={() => setEditingFeelLog(null)}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-ink/5 text-ink/40 transition active:opacity-60"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="mb-5 flex flex-wrap gap-2">
              {(FEELINGS.some((f) => f.tag === editingFeelLog.tag)
                ? ([...FEELINGS] as { tag: string; label: string }[])
                : [{ tag: editingFeelLog.tag, label: feelLabel(editingFeelLog.tag) }, ...FEELINGS]
              ).map(({ tag, label }) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setEditFeelTag(tag)}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition active:scale-[0.96]
                    ${editFeelTag === tag
                      ? "border-primary/30 bg-primary/15 text-primary"
                      : "border-ink/10 bg-white text-ink/70"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mb-5 min-w-0 origin-left" style={{ transform: "scale(0.72)", width: "139%" }}>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[10px] uppercase tracking-wide text-muted/60">Date</p>
                <input
                  type="date"
                  value={editFeelDate}
                  onChange={(e) => setEditFeelDate(e.target.value)}
                  className="w-full min-w-0 rounded-lg border border-ink/20 bg-white px-2 py-1.5 text-[9px] text-ink/80"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[10px] uppercase tracking-wide text-muted/60">Time</p>
                <input
                  type="time"
                  value={editFeelTime}
                  onChange={(e) => setEditFeelTime(e.target.value)}
                  className="w-full min-w-0 rounded-lg border border-ink/20 bg-white px-2 py-1.5 text-[9px] text-ink/80"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  await handleDeleteHomeFeelLog(editingFeelLog.id);
                  setEditingFeelLog(null);
                }}
                className="flex-1 rounded-xl border border-ink/10 py-2.5 text-sm font-medium text-red-400 transition active:opacity-70"
              >
                Delete
              </button>
              <button
                type="button"
                disabled={!editFeelTag}
                onClick={async () => {
                  if (!editFeelTag) return;
                  const ts = editFeelDate && editFeelTime ? new Date(`${editFeelDate}T${editFeelTime}`).getTime() : editingFeelLog.ts;
                  await updateFeelLog(editingFeelLog.id, ts, editFeelTag);
                  setHomeFeelLogs((prev) => prev.map((f) => f.id === editingFeelLog.id ? { ...f, ts, tag: editFeelTag } : f).sort((a, b) => b.ts - a.ts));
                  setEditingFeelLog(null);
                }}
                className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add modal */}
      {showQuickAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white px-5 pb-6 pt-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Quick Add</h2>
              <button
                type="button"
                className="px-3 py-2 text-xs text-ink/50 underline"
                onClick={() => setShowQuickAdd(false)}
              >
                Cancel
              </button>
            </div>
            {quickAddItems.length === 0 && quickAddRecentItems.length === 0 ? (
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
                {quickAddRecentItems.length > 0 && (
                  <>
                    <p className="pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted/45">Recently logged</p>
                    {quickAddRecentItems.map((item) => {
                      const isSelected = !!quickAddSelected[item.key];
                      const portion = quickAddSelected[item.key] ?? "medium";
                      const portionMultiplier = isSelected ? (portion === "small" ? 0.7 : portion === "large" ? 1.4 : 1) : 1;
                      const midCal = item.ranges
                        ? Math.round(((item.ranges.calories_min + item.ranges.calories_max) / 2) * portionMultiplier)
                        : 0;
                      const midProt = item.ranges
                        ? Math.round(((item.ranges.protein_g_min + item.ranges.protein_g_max) / 2) * portionMultiplier)
                        : 0;
                      return (
                        <div
                          key={item.key}
                          className={`cursor-pointer rounded-xl border px-3 py-2.5 transition ${isSelected ? "border-primary/30 bg-primary/8" : "border-ink/8 bg-ink/[0.02]"}`}
                          onClick={() => {
                            setQuickAddSelected((prev) => {
                              if (prev[item.key]) { const next = { ...prev }; delete next[item.key]; return next; }
                              return { ...prev, [item.key]: "medium" };
                            });
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${isSelected ? "border-primary bg-primary" : "border-ink/20 bg-white"}`}>
                              {isSelected && (
                                <svg viewBox="0 0 10 8" fill="none" stroke="white" strokeWidth="1.5" className="h-2.5 w-2.5">
                                  <path d="M1 4 L3.5 6.5 L9 1" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="truncate text-xs font-semibold text-ink">{formatTitle(item.name)}</p>
                              <p className="text-[10px] text-muted/80">{midCal} kcal · {midProt}g protein</p>
                            </div>
                            <button
                              type="button"
                              className="ml-1 shrink-0 text-ink/50 hover:text-ink/70 active:scale-90 transition text-base leading-none"
                              onClick={(e) => { e.stopPropagation(); handleRemoveQuickAddItem(item); }}
                            >×</button>
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
                  </>
                )}
              </div>
            )}
            {(quickAddItems.length > 0 || quickAddRecentItems.length > 0) && (
              <div className="mt-3"><ManualDateRow manualDate={quickAddDate} setManualDate={setQuickAddDate} /></div>
            )}
            {(quickAddItems.length > 0 || quickAddRecentItems.length > 0) && (
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

      {/* Water input modal */}
      {showFeelingModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5"
          onClick={() => setShowFeelingModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl animate-pill-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">How Do You Feel?</h2>
              <button
                type="button"
                className="text-xs font-semibold text-ink/50 transition active:opacity-60"
                onClick={() => setShowFeelingModal(false)}
              >
                Cancel
              </button>
            </div>
            <p className="mt-1 text-xs text-muted/60">Pick any that fit right now.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {FEELINGS.map((f) => {
                const selected = selectedFeelings.includes(f.tag);
                return (
                  <button
                    key={f.tag}
                    type="button"
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition active:scale-[0.96] ${
                      selected
                        ? "border-primary/40 bg-primary/20 text-primary"
                        : "border-primary/25 bg-primary/10 text-ink/80"
                    }`}
                    onClick={() => setSelectedFeelings((prev) => prev.includes(f.tag) ? prev.filter((t) => t !== f.tag) : [...prev, f.tag])}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={selectedFeelings.length === 0}
              className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
              onClick={() => {
                if (!isDemoMode) {
                  const now = Date.now();
                  selectedFeelings.forEach((tag) => handleFeelLog(tag, now));
                }
                setShowFeelingModal(false);
                setSelectedFeelings([]);
              }}
            >
              {selectedFeelings.length > 0 ? `Log ${selectedFeelings.length}` : "Log"}
            </button>
          </div>
        </div>
      )}

      {showReflection && (() => {
        const total = REFLECTION_QUESTIONS.length;
        const atIntro = reflectionStep === 0;
        const q = reflectionStep >= 1 && reflectionStep <= total ? REFLECTION_QUESTIONS[reflectionStep - 1] : null;
        const atNote = reflectionStep === total + 1;
        const atCloser = reflectionStep === total + 2;
        const progress = Math.min(100, (reflectionStep / (total + 1)) * 100);
        return (
          <div className="fixed inset-0 z-[60] flex flex-col justify-start bg-[#EDF4FF] px-6" style={{ paddingTop: "calc(env(safe-area-inset-top) + 2.5rem)", paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
            {/* Faint crescent moons scattered across the whole blue background, for the nightly theme.
                "meet" keeps the full field on screen (no side crop) so they peek at the top, sides
                and bottom around the card. */}
            <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
              <svg className="h-full w-full" viewBox="0 0 400 800" fill="none" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
                <g fill="#6FA8FF">
                  {/* top band */}
                  <g opacity="0.10" transform="translate(30 14) scale(1.3) rotate(6)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  <g opacity="0.08" transform="translate(150 30) scale(0.9) rotate(-7)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  <g opacity="0.11" transform="translate(262 12) scale(1.7) rotate(8)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  <g opacity="0.07" transform="translate(352 36) scale(1.0) rotate(-5)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  {/* left column */}
                  <g opacity="0.09" transform="translate(8 130) scale(1.4) rotate(5)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  <g opacity="0.08" transform="translate(16 300) scale(1.0) rotate(-6)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  <g opacity="0.10" transform="translate(6 470) scale(1.6) rotate(6)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  <g opacity="0.08" transform="translate(14 640) scale(1.1) rotate(-4)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  {/* right column */}
                  <g opacity="0.08" transform="translate(372 110) scale(1.2) rotate(-7)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  <g opacity="0.10" transform="translate(380 280) scale(1.5) rotate(6)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  <g opacity="0.07" transform="translate(368 450) scale(1.0) rotate(-5)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  <g opacity="0.09" transform="translate(378 630) scale(1.3) rotate(5)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  {/* bottom band */}
                  <g opacity="0.09" transform="translate(160 560) scale(1.2) rotate(6)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  <g opacity="0.11" transform="translate(290 600) scale(2.0) rotate(9)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  <g opacity="0.10" transform="translate(80 690) scale(1.5) rotate(-6)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  <g opacity="0.08" transform="translate(220 740) scale(1.0) rotate(5)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                  <g opacity="0.09" transform="translate(330 720) scale(1.3) rotate(-4)"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></g>
                </g>
              </svg>
            </div>
            <div className="relative z-10 flex h-[72vh] max-h-full flex-col overflow-hidden rounded-3xl border border-primary/20 bg-white animate-card-fade">
            {!atIntro && (
              <div className="mx-5 mt-4 h-1.5 overflow-hidden rounded-full bg-ink/8">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
            )}
            <div className="flex flex-1 flex-col px-6 overflow-y-auto">
              {!atIntro && !atCloser && (
                <div className="flex items-center justify-between pt-5">
                  <button type="button" className="p-1 active:opacity-50" onClick={() => setReflectionStep((s) => s - 1)}>
                    <svg className="h-5 w-5 text-ink/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                  </button>
                  <p className="text-[11px] uppercase tracking-widest text-muted/70">Step {reflectionStep} of {total + 1}</p>
                </div>
              )}

              {atIntro && (
                <div className="flex flex-1 flex-col items-center justify-center px-2 pb-[10vh] text-center">
                  <span className="animate-moon-rise flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <svg viewBox="0 0 24 24" className="animate-moon-float h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                  </span>
                  <h1 className="mt-5 text-2xl font-semibold text-ink">Your Nightly Check-In</h1>
                  <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink/70">A quick look back at your day. It takes under a minute, and it&apos;s how your coach learns what lifts your energy and what drags it down.</p>
                  <button type="button" className="mt-8 w-full max-w-xs rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80" onClick={() => setReflectionStep(1)}>Get Started</button>
                  {lastReflection && (
                    <button
                      type="button"
                      className="mt-3 w-full max-w-xs rounded-xl border border-primary/30 bg-white py-4 text-sm font-semibold text-primary transition active:opacity-80"
                      onClick={() => { setReflection(lastReflection.reflection); setReflectionNote(lastReflection.note); setReflectionStep(total + 2); }}
                    >
                      Same As Last Night
                    </button>
                  )}
                  <button type="button" className="mt-3 text-xs font-semibold text-ink/45 active:opacity-60" onClick={closeReflection}>Maybe Later</button>
                </div>
              )}

              {q && (
                <div className="mt-[3vh] pb-10">
                  <div className="mb-5 flex justify-center">{q.icon}</div>
                  <h1 className="text-center text-2xl font-semibold text-ink">{q.label}</h1>
                  <p className="mt-2 text-center text-sm text-ink/65">{q.hint}</p>
                  {q.multi && <p className="mt-1 text-center text-xs font-medium text-primary/70">Select all that apply</p>}
                  <div className="mt-8 flex flex-col gap-3">
                    {q.opts.map((_o, idx) => idx).reverse().map((i) => {
                      const o = q.opts[i];
                      const v = reflection[q.key];
                      const sel = q.multi ? Array.isArray(v) && v.includes(i) : v === i;
                      return (
                        <button
                          key={o}
                          type="button"
                          className={`w-full rounded-xl border py-4 text-center text-sm font-medium transition active:opacity-80 ${sel ? "border-primary bg-primary/10 text-primary" : "border-ink/20 bg-white text-ink/80"}`}
                          onClick={() => {
                            if (q.multi) {
                              setReflection((r) => {
                                const cur = Array.isArray(r[q.key]) ? (r[q.key] as number[]) : [];
                                if (i === 0) return { ...r, [q.key]: [0] }; // "None" is exclusive
                                const base = cur.filter((x) => x !== 0);
                                const next = base.includes(i) ? base.filter((x) => x !== i) : [...base, i];
                                return { ...r, [q.key]: next };
                              });
                            } else {
                              setReflection((r) => ({ ...r, [q.key]: i }));
                              setTimeout(() => setReflectionStep((s) => s + 1), 200);
                            }
                          }}
                        >
                          {o}
                        </button>
                      );
                    })}
                  </div>
                  {q.multi && (
                    <button
                      type="button"
                      disabled={!(Array.isArray(reflection[q.key]) && (reflection[q.key] as number[]).length > 0)}
                      className="mt-8 w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-40"
                      onClick={() => setReflectionStep((s) => s + 1)}
                    >
                      Continue
                    </button>
                  )}
                </div>
              )}

              {atNote && (
                <div className="mt-[3vh] pb-10">
                  <div className="mb-5 flex justify-center">
                    <svg className="h-10 w-10 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </div>
                  <h1 className="text-center text-2xl font-semibold text-ink">Anything Stand Out?</h1>
                  <p className="mt-2 text-center text-sm text-ink/65">Optional, a quick note for your coach</p>
                  <input
                    type="text"
                    value={reflectionNote}
                    onChange={(e) => setReflectionNote(e.target.value)}
                    placeholder="e.g. I felt bloated today"
                    className="mt-8 w-full rounded-xl border border-ink/10 bg-white px-4 py-4 text-center text-sm text-ink/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  <button
                    type="button"
                    className="mt-8 w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80"
                    onClick={() => setReflectionStep((s) => s + 1)}
                  >
                    {reflectionNote.trim() ? "Done" : "Skip"}
                  </button>
                </div>
              )}

              {atCloser && (
                <div className="flex flex-1 flex-col items-center justify-center pb-[12vh]">
                  <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-white animate-habit-pop">
                    <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>
                  </span>
                  <p className="mt-6 text-center text-2xl font-semibold text-ink">Thanks For Checking In</p>
                  <p className="mt-2 max-w-xs text-center text-sm text-ink/65">That's today, noted. Showing up for yourself like this is how feeling better slowly stops being a goal and just becomes your normal.</p>
                  <button type="button" className="mt-10 w-full max-w-xs rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80" onClick={finishReflection}>Done</button>
                </div>
              )}
            </div>
            </div>
          </div>
        );
      })()}

      {showWaterUndo && waterData && (
        <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 animate-pill-in">
          <div className="flex items-center gap-4 rounded-full border border-primary/25 bg-primary/10 px-5 py-2.5 text-sm font-medium text-ink/80 shadow-[0_8px_24px_rgba(15,23,42,0.15)]">
            <span>Water Logged</span>
            <button
              type="button"
              className="font-semibold text-primary underline underline-offset-2 active:opacity-70"
              onClick={() => {
                waterData.remove();
                if (waterUndoTimerRef.current) clearTimeout(waterUndoTimerRef.current);
                setShowWaterUndo(false);
              }}
            >
              Undo
            </button>
          </div>
        </div>
      )}

      {waterModalOpen && waterData && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-5 pt-40"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={() => { setWaterModalOpen(false); window.scrollTo(0, 0); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white px-5 pt-6 pb-8 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-center gap-2 mb-5">
              <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="wmodal-drop" x1="0.35" y1="0" x2="0.65" y2="1">
                    <stop offset="0%" stopColor="#BAD8FF" />
                    <stop offset="45%" stopColor="#93C5FD" />
                    <stop offset="100%" stopColor="#6FA8FF" />
                  </linearGradient>
                </defs>
                <path d="M12 3C11.4 3 5 11 5 15.5a7 7 0 0 0 14 0C19 11 12.6 3 12 3z" fill="url(#wmodal-drop)" />
                <ellipse cx="9.8" cy="13.5" rx="1.2" ry="2" fill="rgba(255,255,255,0.40)" transform="rotate(-20 9.8 13.5)" />
              </svg>
              <p className="text-base font-semibold text-ink">Add Water</p>
            </div>

            <input
              ref={waterInputRef}
              type="number"
              inputMode="decimal"
              value={waterInputAmount}
              onChange={(e) => setWaterInputAmount(e.target.value)}
              placeholder=""
              className="block mx-auto w-[96px] text-center text-3xl font-light text-ink outline-none bg-transparent border border-ink/20 rounded-lg py-1.5 px-2 mb-5"
            />

            {/* Unit pills */}
            <div className="flex justify-center gap-2 mb-6">
              {(["ml", "L", "cups", "oz"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => setWaterInputUnit(u)}
                  className={`px-4 py-1.5 rounded-full text-sm border transition-all ${
                    waterInputUnit === u
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-ink/55 border-ink/15 hover:border-ink/30"
                  }`}
                >
                  {u === "L" ? "litres" : u}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                const amount = parseFloat(waterInputAmount);
                if (isNaN(amount) || amount <= 0) return;
                const ML_PER: Record<string, number> = { ml: 1, oz: 29.5735, cups: 236.588, L: 1000 };
                const ml = Math.round(amount * ML_PER[waterInputUnit]);
                waterData.addAmount(ml);
                setWaterModalOpen(false);
                setWaterInputAmount("");
                window.scrollTo(0, 0);
                if (waterUndoTimerRef.current) clearTimeout(waterUndoTimerRef.current);
                setShowWaterUndo(true);
                waterUndoTimerRef.current = setTimeout(() => setShowWaterUndo(false), 6000);
              }}
              className="w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-white transition hover:bg-primary/90 active:scale-[0.98]"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => { setWaterModalOpen(false); window.scrollTo(0, 0); }}
              className="mt-2 w-full py-2 text-center text-sm text-ink/40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
