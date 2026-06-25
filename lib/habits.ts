// Habit builder templates + schema. CONTENT ONLY — no engine wiring yet.
//
// The engine (later) reads the digest signals (see digestEngine SmartNudgeContext),
// filters the catalog to *eligible* templates via the deterministic `triggers`
// gate, then surfaces ONE at a time (deterministic pick now; AI selection later).
// See the project_habit_builder memory for the full design + user-state machine.

import type { FeelingGoal } from "./types";

export type HabitCategory =
  | "logging" | "hydration" | "protein" | "movement"
  | "sleep" | "micronutrient" | "produce";

// Which habit categories tend to serve each feeling goal. Used to surface the
// habits most relevant to what the user said they want to feel better about.
export const FEELING_GOAL_CATEGORIES: Record<FeelingGoal, HabitCategory[]> = {
  energy:    ["hydration", "protein", "micronutrient", "sleep", "movement"],
  sleep:     ["sleep", "micronutrient", "movement"],
  mood:      ["micronutrient", "movement", "sleep"],
  focus:     ["hydration", "protein", "micronutrient", "sleep"],
  digestion: ["produce", "hydration"],
  cravings:  ["protein", "produce"],
};

// onboarding = cold-start logging habit; reengagement = comeback logging habit;
// standard = the data-driven ones.
export type HabitKind = "onboarding" | "reengagement" | "standard";

// Effort/shopping required. Used to ramp difficulty — new users get low-friction
// wins first; shopping-dependent habits rank lower until there's momentum.
export type HabitFriction = "low" | "medium" | "high";

// Signals computed from the user's logged data. Reliable: water/protein/feelings/
// micros. HealthKit-only: steps/sleep. (Meal timing is intentionally absent — it's
// unreliable due to backfilled logs; only photo-log timestamps could be trusted.)
export type HabitSignal =
  | "water_pct"          // water consumed / goal
  | "protein_pct"        // protein vs target
  | "energy_low_count"   // # of tired/sluggish/foggy feel logs in the window
  | "micronutrient_pct"  // a nutrient's intake vs RDA (requires `nutrient`)
  | "steps_avg"          // HealthKit only
  | "sleep_hours_avg";   // HealthKit only

export interface HabitCondition {
  signal: HabitSignal;
  nutrient?: string;      // for micronutrient_pct, must match the RDA canonical key (verify at wire time)
  op: "<" | "<=" | ">" | ">=";
  value: number;          // a threshold...
  ofTarget?: boolean;     // ...or a fraction of the user's target/goal (0.8 = below 80%)
  windowDays: number;     // look-back window
  minDataDays?: number;   // confidence: require at least this many logged days before firing
}

export interface HabitTemplate {
  // identity — one lever per template
  id: string;
  kind: HabitKind;
  title: string;
  noun: string;                  // copy: "3 days of {noun}, done."
  category: HabitCategory;

  // presentation (what the card renders). The ask is the *frame*; at surface time
  // the AI tailors the specifics (food examples, the cue to stack on, add vs swap)
  // to the user's diet, goal, and what they actually log.
  ask: string;
  whyTemplate: string;           // {slots} filled from the user's own data at surface time
  durationDays: 2 | 3 | 5;
  checkpoints: string[];         // 1..n sub-steps, all serving the one thing
  autoCompleteOnLog?: boolean;   // logging habits tick themselves when the user logs

  // eligibility / constraints (deterministic gate)
  triggers: HabitCondition[];    // ALL must hold to be eligible; empty = state-driven (logging habits)
  requiresHealthKit?: boolean;   // gate to HealthKit users (steps/sleep signals)
  friction: HabitFriction;       // easy wins first; shopping-dependent ranks lower
  priorityWeight: number;        // soft importance hint; future AI sees it too
  cooldownDays: number;          // after complete/decline/shelve, wait before re-surfacing

  // miss handling + progression
  maxExtensions: number;         // missed days that can be made up before it lapses (0 = strict)
  deepensTo?: string;            // id of a longer/harder variant for progression
}

// Design principles for a habit people actually do (not "pfft I already do that"):
//  - Additive or a swap, never general — "an EXTRA protein", not "have protein".
//  - Habit-stacked — anchor to an existing cue ("with each meal", "after lunch").
//  - Specific & low-friction — one concrete action, doable with what's on hand.
//  - 3-day entry, 5-day deepen (deepensTo) earned by recurrence.
//  - friction tags easy wins so new users start frictionless.
// The "starts tomorrow" accept default doubles as a prep day for anything that
// needs a small grocery grab.
export const HABIT_TEMPLATES: HabitTemplate[] = [
  // ---------- logging (cold start + re-engagement) ----------
  {
    id: "logging-starter", kind: "onboarding", title: "Find Your Footing",
    noun: "logging", category: "logging",
    ask: "Log at least one thing each day for 5 days. A meal, a feeling, a glass of water, anything counts.",
    whyTemplate: "Everything here grows from what you log. Let's build that habit first, then the app can actually start helping.",
    durationDays: 5, checkpoints: ["Log Something"], autoCompleteOnLog: true,
    triggers: [], friction: "low", priorityWeight: 100, cooldownDays: 30, maxExtensions: 3,
  },
  {
    id: "logging-comeback", kind: "reengagement", title: "Pick Back Up",
    noun: "logging", category: "logging",
    ask: "Log at least one thing each day for 2 days to get back in the rhythm.",
    whyTemplate: "Life happens and you fell off, that's normal. Two easy days to find the thread again.",
    durationDays: 2, checkpoints: ["Log Something"], autoCompleteOnLog: true,
    triggers: [], friction: "low", priorityWeight: 100, cooldownDays: 7, maxExtensions: 3,
  },

  // ---------- hydration (reference, stacked on meals, 3 -> 5 progression) ----------
  {
    id: "hydration-3", kind: "standard", title: "Hydration", noun: "hydration", category: "hydration",
    ask: "Have an extra glass of water with each meal for 3 days. One with breakfast, one with lunch, one with dinner.",
    whyTemplate: "You've reported low energy {energyLowCount} times this week. Mild dehydration is an easy-to-miss cause of afternoon fatigue, and one of the simplest things to test.",
    durationDays: 3, checkpoints: ["With Breakfast", "With Lunch", "With Dinner"],
    triggers: [{ signal: "water_pct", op: "<", value: 0.7, ofTarget: true, windowDays: 5, minDataDays: 4 }],
    friction: "low", priorityWeight: 8, cooldownDays: 14, maxExtensions: 2, deepensTo: "hydration-5",
  },
  {
    id: "hydration-5", kind: "standard", title: "Hydration", noun: "hydration", category: "hydration",
    ask: "Have an extra glass of water with each meal for 5 days.",
    whyTemplate: "You built this one before and it's drifted back. Going 5 days this time helps it hold for good.",
    durationDays: 5, checkpoints: ["With Breakfast", "With Lunch", "With Dinner"],
    triggers: [{ signal: "water_pct", op: "<", value: 0.7, ofTarget: true, windowDays: 5, minDataDays: 4 }],
    friction: "low", priorityWeight: 8, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- protein (an EXTRA, not "have protein"; stacked on two meals) ----------
  {
    id: "protein-3", kind: "standard", title: "Protein Boost", noun: "extra protein", category: "protein",
    ask: "Add an extra protein to lunch and dinner for 3 days. Extra meat or beans on the plate, an egg, or a scoop of Greek yogurt.",
    whyTemplate: "You've come up short on protein {proteinShortDays} of the last 7 days. Protein steadies energy and curbs cravings, so a little extra at two meals goes a long way.",
    durationDays: 3, checkpoints: ["Lunch Protein", "Dinner Protein"],
    triggers: [{ signal: "protein_pct", op: "<", value: 0.8, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    friction: "medium", priorityWeight: 7, cooldownDays: 14, maxExtensions: 2,
  },

  // ---------- movement (stacked on a meal; HealthKit-gated) ----------
  {
    id: "walk-10-3", kind: "standard", title: "Daily Walk", noun: "walks", category: "movement",
    ask: "Take a 10-minute walk after one meal each day for 3 days. After lunch or dinner works best.",
    whyTemplate: "Your activity's been light and you've logged feeling sluggish {energyLowCount} times this week. A short daily walk is the smallest reliable lever for energy.",
    durationDays: 3, checkpoints: ["10-Min Walk"], requiresHealthKit: true,
    triggers: [{ signal: "steps_avg", op: "<", value: 4000, windowDays: 7, minDataDays: 4 }],
    friction: "low", priorityWeight: 6, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- produce (one added veg, stacked on dinner) ----------
  {
    id: "veg-3", kind: "standard", title: "Add a Vegetable", noun: "vegetables", category: "produce",
    ask: "Add a vegetable to your dinner each day for 3 days. A side of whatever's easy, frozen counts.",
    whyTemplate: "Your produce-driven nutrients have been running low, which usually means light vegetables. One vegetable at dinner is the simplest fix.",
    durationDays: 3, checkpoints: ["Vegetable At Dinner"],
    triggers: [{ signal: "micronutrient_pct", nutrient: "vitamin c", op: "<", value: 0.7, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    friction: "medium", priorityWeight: 5, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- micronutrients (added snack/food; higher friction = ranks lower) ----------
  {
    id: "magnesium-3", kind: "standard", title: "Magnesium Boost", noun: "magnesium", category: "micronutrient",
    ask: "Add a magnesium-rich snack each day for 3 days. A handful of nuts or seeds, or a square of dark chocolate.",
    whyTemplate: "Your magnesium has been low this week. It's involved in sleep quality, muscle recovery, and energy, and it's easy to top up through food.",
    durationDays: 3, checkpoints: ["Magnesium Snack"],
    triggers: [{ signal: "micronutrient_pct", nutrient: "magnesium", op: "<", value: 0.7, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    friction: "high", priorityWeight: 5, cooldownDays: 21, maxExtensions: 2,
  },
  {
    id: "iron-3", kind: "standard", title: "Iron Focus", noun: "iron", category: "micronutrient",
    ask: "Add an iron-rich food to one meal each day for 3 days. Spinach, lentils, red meat, or fortified cereal.",
    whyTemplate: "Your iron has been running low, which can quietly drag down energy and focus. A daily iron-rich food is an easy correction.",
    durationDays: 3, checkpoints: ["Iron-Rich Food"],
    triggers: [{ signal: "micronutrient_pct", nutrient: "iron", op: "<", value: 0.7, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    friction: "high", priorityWeight: 5, cooldownDays: 21, maxExtensions: 2,
  },
  {
    id: "omega3-3", kind: "standard", title: "Omega-3", noun: "omega-3", category: "micronutrient",
    ask: "Add an omega-3 source each day for 3 days. Walnuts, chia, flax, or a portion of fish.",
    whyTemplate: "Your omega-3 intake has been low this week. It supports mood, focus, and recovery, and a small daily source covers it.",
    durationDays: 3, checkpoints: ["Omega-3 Food"],
    triggers: [{ signal: "micronutrient_pct", nutrient: "omega-3", op: "<", value: 0.7, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    friction: "high", priorityWeight: 4, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- sleep (behavioral, no shopping; HealthKit-gated) ----------
  {
    id: "sleep-steady-3", kind: "standard", title: "Steady Sleep", noun: "steady sleep", category: "sleep",
    ask: "Be in bed by your target time each night for 3 days. Pick a time and protect it.",
    whyTemplate: "Your sleep has been on the short side and you've logged feeling tired {energyLowCount} times. A consistent bedtime is the highest-leverage thing for energy.",
    durationDays: 3, checkpoints: ["In Bed On Time"], requiresHealthKit: true,
    triggers: [{ signal: "sleep_hours_avg", op: "<", value: 6.5, windowDays: 7, minDataDays: 4 }],
    friction: "low", priorityWeight: 7, cooldownDays: 21, maxExtensions: 2,
  },
];

// ---------------------------------------------------------------------------
// Future catalog (titles + category + lever) — NOT yet specced. Each is a 3-day
// entry with a 5-day deepen, written additive + habit-stacked, and tailored to
// the user's diet/goal by the AI at surface time. Fill in as content; the well
// doesn't run dry.
//
//  hydration:      a glass before your morning coffee; water before each meal
//  protein:        protein-forward breakfast; a protein with your afternoon coffee
//  produce:        fruit with breakfast; a second vegetable at dinner; a daily salad
//  micronutrient:  vitamin D (sun/supplement), calcium, potassium, zinc, folate, B12, fiber
//  movement:       a post-dinner walk; take the stairs; a daily stretch; stand every hour
//  sleep:          screens off 30m before bed; a consistent wake time; no caffeine after 2pm
//  timing*:        eat within an hour of waking; nothing after 9pm   (*photo-log timestamps only)
//  mindful:        slow down at one meal; log before you eat; one no-screen meal
//
//  swaps (for weight-loss goals): trade the afternoon cookie for Greek yogurt;
//  sparkling water instead of soda; fruit instead of the late-night snack
// ---------------------------------------------------------------------------

// Standard habit templates relevant to the user's feeling goal(s), goal-matched
// first (the rest follow so cycling/fallback still works). Empty goals = all standard.
export function habitsForGoals(
  goals: FeelingGoal[] | undefined,
  templates: HabitTemplate[] = HABIT_TEMPLATES,
): HabitTemplate[] {
  const standard = templates.filter((t) => t.kind === "standard");
  if (!goals || goals.length === 0) return standard;
  const cats = new Set(goals.flatMap((g) => FEELING_GOAL_CATEGORIES[g] ?? []));
  const matched = standard.filter((t) => cats.has(t.category));
  const rest = standard.filter((t) => !cats.has(t.category));
  return [...matched, ...rest];
}
