// Habit builder templates + schema. CONTENT ONLY — no engine wiring yet.
//
// The engine (later) reads the digest signals (see digestEngine SmartNudgeContext),
// filters the catalog to *eligible* templates via the deterministic `triggers`
// gate, then surfaces ONE at a time (deterministic pick now; AI selection later).
// See the project_habit_builder memory for the full design + user-state machine.

export type HabitCategory =
  | "logging" | "hydration" | "protein" | "movement"
  | "sleep" | "micronutrient" | "produce";

// onboarding = cold-start logging habit; reengagement = comeback logging habit;
// standard = the data-driven ones.
export type HabitKind = "onboarding" | "reengagement" | "standard";

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
  noun: string;                  // copy: "Three days of {noun}, done."
  category: HabitCategory;

  // presentation (what the card already renders)
  ask: string;
  whyTemplate: string;           // {slots} filled from the user's own data at surface time
  durationDays: 2 | 3 | 5;
  checkpoints: string[];         // 1..n sub-steps, all serving the one thing
  autoCompleteOnLog?: boolean;   // logging habits tick themselves when the user logs

  // eligibility / constraints (deterministic gate)
  triggers: HabitCondition[];    // ALL must hold to be eligible; empty = state-driven (logging habits)
  requiresHealthKit?: boolean;   // gate to HealthKit users (steps/sleep signals)
  priorityWeight: number;        // soft ranking hint (foundational > nice-to-have); future AI sees it too
  cooldownDays: number;          // after complete/decline/shelve, wait before re-surfacing

  // miss handling + progression
  maxExtensions: number;         // missed days that can be made up before it lapses (0 = strict)
  deepensTo?: string;            // id of a longer/harder variant for progression
}

export const HABIT_TEMPLATES: HabitTemplate[] = [
  // ---------- logging (cold start + re-engagement) ----------
  {
    id: "logging-starter", kind: "onboarding", title: "Find Your Footing",
    noun: "logging", category: "logging",
    ask: "Log at least one thing each day for 5 days. A meal, a feeling, a glass of water, anything counts.",
    whyTemplate: "Everything here grows from what you log. Let's build that habit first, then the app can actually start helping.",
    durationDays: 5, checkpoints: ["Log something"], autoCompleteOnLog: true,
    triggers: [], priorityWeight: 100, cooldownDays: 30, maxExtensions: 3,
  },
  {
    id: "logging-comeback", kind: "reengagement", title: "Pick Back Up",
    noun: "logging", category: "logging",
    ask: "Log at least one thing each day for 2 days to get back in the rhythm.",
    whyTemplate: "Life happens and you fell off, that's normal. Two easy days to find the thread again.",
    durationDays: 2, checkpoints: ["Log something"], autoCompleteOnLog: true,
    triggers: [], priorityWeight: 100, cooldownDays: 7, maxExtensions: 3,
  },

  // ---------- hydration (reference template, with 3 -> 5 progression) ----------
  {
    id: "hydration-3", kind: "standard", title: "Hydration", noun: "hydration", category: "hydration",
    ask: "Drink 3 extra glasses of water every day for 3 days: one in the morning, afternoon, and evening.",
    whyTemplate: "You've reported low energy {energyLowCount} times this week. Mild dehydration is an easy-to-miss cause of afternoon fatigue, and one of the simplest things to test.",
    durationDays: 3, checkpoints: ["Morning", "Afternoon", "Evening"],
    triggers: [{ signal: "water_pct", op: "<", value: 0.7, ofTarget: true, windowDays: 5, minDataDays: 4 }],
    priorityWeight: 8, cooldownDays: 14, maxExtensions: 2, deepensTo: "hydration-5",
  },
  {
    id: "hydration-5", kind: "standard", title: "Hydration", noun: "hydration", category: "hydration",
    ask: "Drink 3 extra glasses of water every day for 5 days: morning, afternoon, and evening.",
    whyTemplate: "You did the 3-day version and water's slipping again. Let's lock it in over 5 days this time so it really sticks.",
    durationDays: 5, checkpoints: ["Morning", "Afternoon", "Evening"],
    triggers: [{ signal: "water_pct", op: "<", value: 0.7, ofTarget: true, windowDays: 5, minDataDays: 4 }],
    priorityWeight: 8, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- protein ----------
  {
    id: "protein-5", kind: "standard", title: "Protein Anchor", noun: "protein", category: "protein",
    ask: "Anchor each meal with a protein source for 5 days.",
    whyTemplate: "You've come up short on protein {proteinShortDays} of the last 7 days. Protein steadies energy and curbs cravings, so it's a high-leverage place to start.",
    durationDays: 5, checkpoints: ["Breakfast", "Lunch", "Dinner"],
    triggers: [{ signal: "protein_pct", op: "<", value: 0.8, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    priorityWeight: 7, cooldownDays: 14, maxExtensions: 2,
  },

  // ---------- movement (HealthKit-gated) ----------
  {
    id: "walk-10-3", kind: "standard", title: "Daily Walk", noun: "walks", category: "movement",
    ask: "Take one 10-minute walk each day for 3 days.",
    whyTemplate: "Your activity's been light and you've logged feeling sluggish {energyLowCount} times this week. A short daily walk is the smallest reliable lever for energy.",
    durationDays: 3, checkpoints: ["10-min walk"], requiresHealthKit: true,
    triggers: [{ signal: "steps_avg", op: "<", value: 4000, windowDays: 7, minDataDays: 4 }],
    priorityWeight: 6, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- micronutrients ----------
  {
    id: "magnesium-5", kind: "standard", title: "Magnesium Boost", noun: "magnesium", category: "micronutrient",
    ask: "Add one magnesium-rich food each day for 5 days: leafy greens, nuts, seeds, or dark chocolate.",
    whyTemplate: "Your magnesium has been low this week. It's involved in sleep quality, muscle recovery, and energy, and it's easy to top up through food.",
    durationDays: 5, checkpoints: ["Magnesium-rich food"],
    triggers: [{ signal: "micronutrient_pct", nutrient: "magnesium", op: "<", value: 0.7, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    priorityWeight: 5, cooldownDays: 21, maxExtensions: 2,
  },
  {
    id: "iron-5", kind: "standard", title: "Iron Focus", noun: "iron", category: "micronutrient",
    ask: "Include an iron-rich food each day for 5 days: red meat, lentils, spinach, or fortified cereal.",
    whyTemplate: "Your iron has been running low, which can quietly drag down energy and focus. A daily iron-rich food is an easy correction.",
    durationDays: 5, checkpoints: ["Iron-rich food"],
    triggers: [{ signal: "micronutrient_pct", nutrient: "iron", op: "<", value: 0.7, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    priorityWeight: 5, cooldownDays: 21, maxExtensions: 2,
  },
  {
    id: "omega3-5", kind: "standard", title: "Omega-3 Habit", noun: "omega-3", category: "micronutrient",
    ask: "Add an omega-3 source each day for 5 days: fatty fish, walnuts, chia, or flax.",
    whyTemplate: "Your omega-3 intake has been low this week. It supports mood, focus, and recovery, and a small daily source covers it.",
    durationDays: 5, checkpoints: ["Omega-3 source"],
    triggers: [{ signal: "micronutrient_pct", nutrient: "omega-3", op: "<", value: 0.7, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    priorityWeight: 4, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- produce (proxy: a vitamin-C low usually means light produce) ----------
  {
    id: "veg-5", kind: "standard", title: "Eat the Rainbow", noun: "vegetables", category: "produce",
    ask: "Add a serving of vegetables to lunch and dinner each day for 5 days.",
    whyTemplate: "Your produce-driven nutrients have been running low together, which usually means light vegetables. Veg at two meals a day is the simplest fix.",
    durationDays: 5, checkpoints: ["Lunch veg", "Dinner veg"],
    triggers: [{ signal: "micronutrient_pct", nutrient: "vitamin c", op: "<", value: 0.7, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    priorityWeight: 5, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- sleep (HealthKit-gated) ----------
  {
    id: "sleep-steady-5", kind: "standard", title: "Steady Sleep", noun: "steady sleep", category: "sleep",
    ask: "Be in bed by the same time each night for 5 days.",
    whyTemplate: "Your sleep has been on the short side and you've logged feeling tired {energyLowCount} times. A consistent bedtime is the highest-leverage thing for energy.",
    durationDays: 5, checkpoints: ["In bed on time"], requiresHealthKit: true,
    triggers: [{ signal: "sleep_hours_avg", op: "<", value: 6.5, windowDays: 7, minDataDays: 4 }],
    priorityWeight: 7, cooldownDays: 21, maxExtensions: 2,
  },
];

// ---------------------------------------------------------------------------
// Future catalog (titles + category + lever) — NOT yet specced. Fill in as
// content once the engine is proven; the well doesn't run dry. Each can scale by
// severity and deepen (3 -> 5 days), so a moderate catalog feels endless.
//
//  hydration:      glass before coffee; water before each meal
//  protein:        protein-forward breakfast; a protein at every snack
//  produce:        fruit with breakfast; add a second veg color; a salad a day
//  micronutrient:  vitamin D (sun/supplement), calcium, potassium, zinc, folate, B12, fiber-rich foods
//  movement:       7k steps/day; take the stairs; a post-meal walk; daily stretch; stand every hour
//  sleep:          screens off 30m before bed; consistent wake time; no caffeine after 2pm
//  timing*:        eat within an hour of waking; no eating after 9pm   (*photo-log timestamps only)
//  mindful:        slow down at one meal; log before you eat; one no-screen meal
// ---------------------------------------------------------------------------
