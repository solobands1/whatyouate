// Seeded sample logs for the Patterns page: the dev harness (app/dev/patterns) and the
// walkthrough demo. Never real user data. Dates are generated relative to `now`, so every
// window on the page lines up the way it would for a real person.
//
// The six-week person has relationships built in (sleep and walks lift energy, a heavy lunch
// or a greasy dinner drags, dairy roughs up digestion, stress spills into the next night),
// plus noise, so the engine has to find them the honest way.

import type { HabitHistoryEntry, ReflectionEntry } from "./habitState";
import type { FeelingGoal, MealLog, WorkoutSession } from "./types";
import type { FeelingTag } from "./foodTags";

export type SampleUserId = "night1" | "new" | "night5" | "twoWeeks" | "sixWeeks" | "mealsOnly";

export interface PatternsSample {
  reflections: ReflectionEntry[];
  meals: MealLog[];
  workouts: WorkoutSession[];
  waterLogs: Record<string, number>;
  habitHistory: HabitHistoryEntry[];
  feelingGoals: FeelingGoal[];
  waterUnit: "ml" | "oz";
}

type Food = { name: string; tags: FeelingTag[]; protein: number; cal: number };
const F = (name: string, tags: FeelingTag[], protein: number, cal: number): Food => ({ name, tags, protein, cal });

const BREAKFAST = [
  F("Oatmeal", ["whole_food", "complex_carbs"], 9, 320),
  F("Eggs And Toast", ["lean_protein", "refined_carbs"], 20, 380),
  F("Greek Yogurt", ["dairy_heavy", "lean_protein"], 18, 220),
  F("Smoothie", ["light_fresh"], 10, 280),
];
const LUNCH = [
  F("Chicken Salad", ["lean_protein", "vegetable_forward", "light_fresh"], 35, 450),
  F("Turkey Sandwich", ["refined_carbs", "lean_protein"], 28, 520),
  F("Burrito Bowl", ["balanced_meal", "complex_carbs"], 32, 650),
  F("Leftover Pasta", ["refined_carbs", "heavy_large"], 18, 780),
];
const DINNER = [
  F("Salmon And Rice", ["lean_protein", "whole_food", "balanced_meal"], 38, 620),
  F("Stir Fry", ["vegetable_forward", "balanced_meal"], 30, 540),
  F("Pizza", ["highly_processed", "refined_carbs", "dairy_heavy", "heavy_large"], 26, 850),
  F("Burger And Fries", ["fried_greasy", "heavy_large", "highly_processed"], 32, 1050),
  F("Mac And Cheese", ["dairy_heavy", "refined_carbs"], 20, 700),
];
const LATTE = F("Latte", ["caffeine", "dairy_heavy"], 8, 190);
const SNACKS = [
  F("Chips", ["fried_greasy", "highly_processed"], 2, 250),
  F("Apple", ["whole_food", "light_fresh"], 0, 95),
  F("Ice Cream", ["high_sugar", "dairy_heavy"], 4, 300),
  F("Cookies", ["high_sugar", "refined_carbs"], 2, 260),
];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function keyOf(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function meal(id: string, day: Date, hour: number, minute: number, f: Food): MealLog {
  const ts = new Date(day);
  ts.setHours(hour, minute, 0, 0);
  const lo = (v: number) => Math.round(v * 0.85), hi = (v: number) => Math.round(v * 1.15);
  return {
    id,
    ts: ts.getTime(),
    status: "done",
    calories: f.cal,
    protein: f.protein,
    carbs: Math.round((f.cal * 0.45) / 4),
    fat: Math.round((f.cal * 0.3) / 9),
    analysisJson: {
      name: f.name,
      canonical_name: f.name,
      detected_items: [{ name: f.name, confidence_0_1: 0.9 }],
      estimated_ranges: {
        calories_min: lo(f.cal), calories_max: hi(f.cal),
        protein_g_min: lo(f.protein), protein_g_max: hi(f.protein),
        carbs_g_min: lo((f.cal * 0.45) / 4), carbs_g_max: hi((f.cal * 0.45) / 4),
        fat_g_min: lo((f.cal * 0.3) / 9), fat_g_max: hi((f.cal * 0.3) / 9),
      },
      feeling_tags: f.tags,
      micronutrient_signals: [],
      confidence_overall_0_1: 0.82,
      precision_mode_available: false,
    },
  };
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

interface Plan { days: number; seed: number; missed: number[]; habits: { title: string; templateId: string; daysAgo: number; keep: "yes" | "maybe" }[]; goals: FeelingGoal[]; reflectToday?: boolean; noReflections?: boolean }

const PLANS: Record<SampleUserId, Plan> = {
  night1: { days: 1, seed: 11, missed: [], habits: [], goals: ["digestion", "energy"], reflectToday: true },
  new: { days: 3, seed: 7, missed: [], habits: [], goals: ["digestion", "energy"], reflectToday: true },
  night5: { days: 5, seed: 5, missed: [], habits: [], goals: ["digestion", "energy"], reflectToday: true },
  mealsOnly: { days: 12, seed: 9, missed: [], habits: [], goals: ["energy"], noReflections: true },
  twoWeeks: { days: 14, seed: 2, missed: [9], habits: [], goals: ["energy"] },
  sixWeeks: {
    days: 45, seed: 4, missed: [5, 13, 22, 30, 37], goals: ["digestion", "energy"],
    habits: [
      { title: "Daily Walk", templateId: "walk-10-3", daysAgo: 30, keep: "yes" },
      { title: "Wind Down", templateId: "wind-down-3", daysAgo: 17, keep: "yes" },
    ],
  },
};

export function buildPatternsSample(user: SampleUserId, now = Date.now(), seedOverride?: number): PatternsSample {
  const plan = seedOverride == null ? PLANS[user] : { ...PLANS[user], seed: seedOverride };
  const r = rng(plan.seed);
  const pick = <T,>(arr: T[], weights?: number[]): T => {
    if (!weights) return arr[Math.floor(r() * arr.length)];
    const total = weights.reduce((a, b) => a + b, 0);
    let x = r() * total;
    for (let i = 0; i < arr.length; i++) { x -= weights[i]; if (x <= 0) return arr[i]; }
    return arr[arr.length - 1];
  };
  const noise = () => (r() + r() + r() - 1.5) * 0.8;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const meals: MealLog[] = [];
  const workouts: WorkoutSession[] = [];
  const reflections: ReflectionEntry[] = [];
  const waterLogs: Record<string, number> = {};
  const walkStart = plan.habits.find((h) => h.templateId === "walk-10-3")?.daysAgo ?? Infinity;
  const windStart = plan.habits.find((h) => h.templateId === "wind-down-3")?.daysAgo ?? Infinity;

  let prevStressHigh = false;
  let prevEveningGreasy = false;
  for (let back = plan.days - 1; back >= 0; back--) {
    const day = new Date(today);
    day.setDate(day.getDate() - back);
    const key = keyOf(day);
    const idx = plan.days - 1 - back;
    const isToday = back === 0;
    const weekday = day.getDay();

    // Meals. Today only has the morning and lunch so far.
    const dayFoods: { f: Food; hour: number }[] = [];
    if (r() < 0.88) dayFoods.push({ f: pick(BREAKFAST, [3, 2, 2, 1.5]), hour: 8 });
    if (r() < 0.3) dayFoods.push({ f: LATTE, hour: 10 });
    const lunch = pick(LUNCH, [3, 2.5, 2.5, 2]);
    dayFoods.push({ f: lunch, hour: 12 });
    if (!isToday) {
      if (r() < 0.45) dayFoods.push({ f: pick(SNACKS, [1.2, 1.5, 1, 1]), hour: r() < 0.5 ? 15 : 20 });
      if (r() < 0.92) dayFoods.push({ f: pick(DINNER, [2.4, 2.2, 1.6, 1.2, 1.3]), hour: 18 });
    }
    dayFoods.forEach((x, i) => meals.push(meal(`s-${user}-${idx}-${i}`, day, x.hour, Math.floor(r() * 50), x.f)));

    // Movement and water.
    const moved = r() < (back < walkStart ? 0.5 : 0.28);
    if (moved) {
      const start = new Date(day);
      start.setHours(r() < 0.6 ? 12 : 18, 30, 0, 0);
      const dur = 20 + Math.floor(r() * 25);
      workouts.push({ id: `w-${user}-${idx}`, startTs: start.getTime(), endTs: start.getTime() + dur * 60000, durationMin: dur, workoutTypes: [r() < 0.8 ? "Walk" : "Run"], intensity: "medium" });
    }
    const water = Math.round((1450 + (moved ? 380 : 0) + noise() * 500) / 50) * 50;
    if (r() < 0.86) waterLogs[key] = clamp(water, 600, 3200);

    // Last night's sleep (asked tonight): better after Wind Down, worse after a high-stress day.
    const goodP = (back < windStart ? 0.74 : 0.5) - (prevStressHigh ? 0.3 : 0);
    const sr = r();
    const sleep = sr < 0.1 + (prevStressHigh ? 0.2 : 0) ? 0 : sr < 1 - goodP ? 1 : r() < 0.7 ? 2 : 3;

    const stressHigh = r() < (weekday === 1 ? 0.5 : weekday === 2 ? 0.25 : 0.08);
    const stress = stressHigh ? 3 : pick([0, 1, 2], [1, 1.4, 1]);

    const has = (tag: FeelingTag) => dayFoods.some((x) => x.f.tags.includes(tag));
    const dairy = dayFoods.filter((x) => x.f.tags.includes("dairy_heavy")).length;
    const water19 = (waterLogs[key] ?? 0) >= 1900;

    let e = 1.7 + (sleep >= 2 ? 1.0 : 0) - (sleep === 0 ? 1.0 : 0) + (moved ? 0.8 : 0) + (water19 ? 0.35 : 0)
      - (stressHigh ? 0.9 : 0) - (lunch.name === "Leftover Pasta" ? 1.4 : 0) + (lunch.name === "Chicken Salad" ? 0.4 : 0)
      - (prevEveningGreasy ? 1.3 : 0) - (weekday === 1 ? 0.5 : 0) + noise();
    e = clamp(Math.round(e), 0, 4);

    const dr = r();
    const digestion = dairy >= 2 ? (dr < 0.6 ? 0 : dr < 0.85 ? 1 : 2) : dairy === 1 ? (dr < 0.2 ? 0 : dr < 0.5 ? 1 : 2) : dr < 0.04 ? 0 : dr < 0.24 ? 1 : dr < 0.72 ? 2 : 3;
    const mood = clamp(Math.round(1 + (e >= 3 ? 0.7 : 0) + (sleep >= 2 ? 0.5 : 0) - (stressHigh ? 0.7 : 0) + noise() * 0.7), 0, 3);

    const dips: number[] = [];
    if (r() < (e <= 2 ? 0.78 : 0.22) || lunch.name === "Leftover Pasta") dips.push(2);
    if (sleep === 0 && r() < 0.55) dips.push(1);
    if (r() < 0.16) dips.push(3);

    const reflectedTonight = !plan.noReflections && !plan.missed.includes(idx) && (plan.reflectToday || !isToday);
    if (reflectedTonight) {
      const ts = new Date(day);
      ts.setHours(21, 10, 0, 0);
      reflections.push({ date: key, answers: { energy: e, sleep, mood, stress, digestion, dips: dips.length ? dips.sort() : [0] }, note: "", ts: ts.getTime() });
    }
    prevStressHigh = stressHigh;
    prevEveningGreasy = has("fried_greasy") && dayFoods.some((x) => x.hour >= 17 && x.f.tags.includes("fried_greasy"));
  }

  const habitHistory: HabitHistoryEntry[] = plan.habits.map((h) => {
    const d = new Date(today);
    d.setDate(d.getDate() - h.daysAgo);
    d.setHours(20, 0, 0, 0);
    return { templateId: h.templateId, title: h.title, days: 3, finishedAt: d.toISOString(), keep: h.keep };
  });

  return { reflections, meals, workouts, waterLogs, habitHistory, feelingGoals: plan.goals, waterUnit: "ml" };
}
