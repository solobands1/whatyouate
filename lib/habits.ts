// Habit builder templates + schema. CONTENT ONLY — no engine wiring yet.
//
// The engine (later) reads the digest signals (see digestEngine SmartNudgeContext),
// filters the catalog to *eligible* templates via the deterministic `triggers`
// gate, then surfaces ONE at a time (deterministic pick now; AI selection later).
// See the project_habit_builder memory for the full design + user-state machine.

import type { FeelingGoal, GoalDirection } from "./types";

export type HabitCategory =
  | "logging" | "hydration" | "protein" | "movement"
  | "sleep" | "micronutrient" | "produce"
  | "mind" | "timing" | "caffeine" | "balance";

// Which habit categories tend to serve each feeling goal. Used to surface the
// habits most relevant to what the user said they want to feel better about.
export const FEELING_GOAL_CATEGORIES: Record<FeelingGoal, HabitCategory[]> = {
  energy:    ["hydration", "protein", "movement", "sleep", "caffeine", "micronutrient", "mind"],
  sleep:     ["sleep", "caffeine", "mind", "timing", "micronutrient", "movement"],
  mood:      ["mind", "movement", "sleep", "micronutrient"],
  focus:     ["protein", "hydration", "caffeine", "mind", "micronutrient", "sleep"],
  digestion: ["produce", "timing", "mind", "hydration"],
  cravings:  ["protein", "produce", "caffeine", "mind"],
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

  // weight/body-goal targeting. If set, the habit ONLY surfaces for users whose
  // body goal matches (e.g. a calorie-dense snack only for those gaining). Habits
  // without this are feeling-goal driven and surface regardless of body goal.
  goalDirections?: GoalDirection[];

  // miss handling + progression
  maxExtensions: number;         // missed days that can be made up before it lapses (0 = strict)
  deepensTo?: string;            // id of a longer/harder variant for progression

  // example foods/options shown behind a "What Helps?" expander on the card
  ideas?: string[];
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
    durationDays: 5, checkpoints: ["I Logged Something!"], autoCompleteOnLog: true,
    triggers: [], friction: "low", priorityWeight: 100, cooldownDays: 30, maxExtensions: 3,
  },
  {
    id: "logging-comeback", kind: "reengagement", title: "Pick Back Up",
    noun: "logging", category: "logging",
    ask: "Log at least one thing each day for 2 days to get back in the rhythm.",
    whyTemplate: "Life happens and you fell off, that's normal. Two easy days to find the thread again.",
    durationDays: 2, checkpoints: ["I Logged Something!"], autoCompleteOnLog: true,
    triggers: [], friction: "low", priorityWeight: 100, cooldownDays: 7, maxExtensions: 3,
  },

  // ---------- hydration (reference, stacked on meals, 3 -> 5 progression) ----------
  {
    id: "hydration-3", kind: "standard", title: "Hydration", noun: "hydration", category: "hydration",
    ask: "Have an extra glass of water in the morning, afternoon, and evening for 3 days.",
    whyTemplate: "Mild dehydration is an easy-to-miss cause of afternoon fatigue, and one of the simplest things to test.",
    durationDays: 3, checkpoints: ["Morning", "Afternoon", "Evening"],
    triggers: [{ signal: "water_pct", op: "<", value: 0.7, ofTarget: true, windowDays: 5, minDataDays: 4 }],
    friction: "low", priorityWeight: 8, cooldownDays: 14, maxExtensions: 2, deepensTo: "hydration-5",
  },
  {
    id: "hydration-5", kind: "standard", title: "Hydration", noun: "hydration", category: "hydration",
    ask: "Have an extra glass of water in the morning, afternoon, and evening for 5 days.",
    whyTemplate: "You built this one before and it's drifted back. Going 5 days this time helps it hold for good.",
    durationDays: 5, checkpoints: ["Morning", "Afternoon", "Evening"],
    triggers: [{ signal: "water_pct", op: "<", value: 0.7, ofTarget: true, windowDays: 5, minDataDays: 4 }],
    friction: "low", priorityWeight: 8, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- protein (an EXTRA, not "have protein"; stacked on two meals) ----------
  {
    id: "protein-3", kind: "standard", title: "Protein Boost", noun: "extra protein", category: "protein",
    ask: "Add an extra protein to lunch and dinner for 3 days. Extra meat or beans on the plate, an egg, or a scoop of Greek yogurt.",
    whyTemplate: "Protein steadies energy and curbs cravings, so a little extra at two meals goes a long way.",
    durationDays: 3, checkpoints: ["Lunch Protein", "Dinner Protein"],
    ideas: ["Eggs", "Greek Yogurt", "Chicken Breast", "Cottage Cheese", "Tuna", "Tofu", "Lentils", "Edamame", "Beans", "A Protein Shake"],
    triggers: [{ signal: "protein_pct", op: "<", value: 0.8, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    friction: "medium", priorityWeight: 7, cooldownDays: 14, maxExtensions: 2,
  },

  // ---------- movement (stacked on a meal; HealthKit-gated) ----------
  {
    id: "walk-10-3", kind: "standard", title: "Daily Walk", noun: "walks", category: "movement",
    ask: "Take a 10-minute walk after one meal each day for 3 days. After lunch or dinner works best.",
    whyTemplate: "A short daily walk is one of the smallest reliable levers for energy, especially on lighter-activity days.",
    durationDays: 3, checkpoints: ["10-Min Walk"], requiresHealthKit: true,
    triggers: [{ signal: "steps_avg", op: "<", value: 4000, windowDays: 7, minDataDays: 4 }],
    friction: "low", priorityWeight: 6, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- produce (one added veg, stacked on dinner) ----------
  {
    id: "veg-3", kind: "standard", title: "Add a Vegetable", noun: "vegetables", category: "produce",
    ask: "Add an extra vegetable to any meal each day for 3 days. A side of whatever's easy, frozen counts.",
    whyTemplate: "Your produce-driven nutrients have been running low, which usually means light vegetables. One extra vegetable a day is the simplest fix.",
    durationDays: 3, checkpoints: ["Added Vegetable"],
    ideas: ["Broccoli", "Spinach", "Bell Peppers", "Carrots", "Frozen Peas", "Zucchini", "Tomatoes", "Mixed Greens", "Green Beans", "Cauliflower"],
    triggers: [{ signal: "micronutrient_pct", nutrient: "vitamin c", op: "<", value: 0.7, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    friction: "medium", priorityWeight: 5, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- micronutrients (added snack/food; higher friction = ranks lower) ----------
  {
    id: "magnesium-3", kind: "standard", title: "Magnesium Boost", noun: "magnesium", category: "micronutrient",
    ask: "Add a magnesium-rich food each day for 3 days. A handful of nuts or seeds, or a square of dark chocolate.",
    whyTemplate: "Your magnesium has been low this week. It's involved in sleep quality, muscle recovery, and energy, and it's easy to top up through food.",
    durationDays: 3, checkpoints: ["Magnesium-Rich Food"],
    ideas: ["Pumpkin Seeds", "Almonds", "Dark Chocolate", "Black Beans", "Spinach", "Cashews", "Avocado", "Edamame", "Peanut Butter", "Quinoa"],
    triggers: [{ signal: "micronutrient_pct", nutrient: "magnesium", op: "<", value: 0.7, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    friction: "high", priorityWeight: 5, cooldownDays: 21, maxExtensions: 2,
  },
  {
    id: "iron-3", kind: "standard", title: "Iron Boost", noun: "iron", category: "micronutrient",
    ask: "Add an iron-rich food to one meal each day for 3 days. Spinach, lentils, red meat, or fortified cereal.",
    whyTemplate: "Your iron has been running low, which can quietly drag down energy and focus. A daily iron-rich food is an easy correction.",
    durationDays: 3, checkpoints: ["Iron-Rich Food"],
    ideas: ["Lentils", "Spinach", "Chickpeas", "Canned Beans", "Tofu", "Fortified Cereal", "Pumpkin Seeds", "Dark Chocolate", "Red Meat", "Eggs"],
    triggers: [{ signal: "micronutrient_pct", nutrient: "iron", op: "<", value: 0.7, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    friction: "high", priorityWeight: 5, cooldownDays: 21, maxExtensions: 2,
  },
  {
    id: "omega3-3", kind: "standard", title: "Omega-3 Boost", noun: "omega-3", category: "micronutrient",
    ask: "Add an omega-3 source each day for 3 days. Walnuts, chia, flax, or a portion of fish.",
    whyTemplate: "Your omega-3 intake has been low this week. It supports mood, focus, and recovery, and a small daily source covers it.",
    durationDays: 3, checkpoints: ["Omega-3-Rich Food"],
    ideas: ["Walnuts", "Chia Seeds", "Ground Flaxseed", "Canned Tuna", "Salmon", "Edamame", "Soybeans", "Hemp Seeds", "Omega-3 Eggs", "Sardines"],
    triggers: [{ signal: "micronutrient_pct", nutrient: "omega-3", op: "<", value: 0.7, ofTarget: true, windowDays: 7, minDataDays: 4 }],
    friction: "high", priorityWeight: 4, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- sleep (behavioral, no shopping; HealthKit-gated) ----------
  {
    id: "sleep-steady-3", kind: "standard", title: "Steady Sleep", noun: "steady sleep", category: "sleep",
    ask: "Be in bed by your target time each night for 3 days. Pick a time and protect it.",
    whyTemplate: "A consistent bedtime is one of the highest-leverage things for steady energy, even more than total hours.",
    durationDays: 3, checkpoints: ["In Bed On Time"], requiresHealthKit: true,
    triggers: [{ signal: "sleep_hours_avg", op: "<", value: 6.5, windowDays: 7, minDataDays: 4 }],
    friction: "low", priorityWeight: 7, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- sleep / wind-down (behavioral, no shopping, no HealthKit) ----------
  {
    id: "wind-down-3", kind: "standard", title: "Wind Down", noun: "winding down", category: "sleep",
    ask: "Put your screens away 30 minutes before bed for 3 days. Read, stretch, or just sit instead.",
    whyTemplate: "Winding down screen-free helps you fall asleep faster, and it needs nothing to track.",
    durationDays: 3, checkpoints: ["Screens Off Early"],
    triggers: [{ signal: "energy_low_count", op: ">=", value: 2, windowDays: 7, minDataDays: 3 }],
    friction: "low", priorityWeight: 7, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- movement (no HealthKit version) ----------
  {
    id: "move-often-3", kind: "standard", title: "Move Often", noun: "movement breaks", category: "movement",
    ask: "Get up and move for a minute a few times a day, for 3 days. Stand, stretch, or take the stairs.",
    whyTemplate: "Long stretches of sitting drain energy and focus. A few movement breaks keep you steadier through the day, no gym required.",
    durationDays: 3, checkpoints: ["Movement Break"],
    triggers: [],
    friction: "low", priorityWeight: 6, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- mood / daylight ----------
  {
    id: "daylight-3", kind: "standard", title: "Daylight", noun: "daylight", category: "mind",
    ask: "Get 10 minutes of outdoor daylight each day for 3 days. A morning walk, coffee outside, or a quick step out.",
    whyTemplate: "Morning daylight lifts mood and sets your body clock for steadier energy and sleep. Ten minutes outside is enough to feel it.",
    durationDays: 3, checkpoints: ["10-Min Daylight"],
    triggers: [],
    friction: "low", priorityWeight: 7, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- digestion / meal timing ----------
  {
    id: "earlier-dinner-3", kind: "standard", title: "Earlier Cutoff", noun: "earlier cutoffs", category: "timing",
    ask: "Stop eating at least 2 hours before bed for 3 days. Pick a cutoff and protect it.",
    whyTemplate: "Eating close to bedtime can disrupt sleep and digestion. Giving your body a couple of hours to settle helps both.",
    durationDays: 3, checkpoints: ["Kitchen Closed"],
    triggers: [],
    friction: "low", priorityWeight: 6, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- cravings / focus — protein breakfast ----------
  {
    id: "protein-breakfast-3", kind: "standard", title: "Protein Breakfast", noun: "protein breakfasts", category: "protein",
    ask: "Have protein with breakfast each day for 3 days. Eggs, Greek yogurt, or a scoop of protein in your coffee or smoothie.",
    whyTemplate: "A protein-forward breakfast steadies blood sugar, which means fewer mid-morning cravings and steadier focus.",
    durationDays: 3, checkpoints: ["Protein Breakfast"],
    ideas: ["Eggs", "Greek Yogurt", "Cottage Cheese", "A Protein Shake", "Protein Oats", "Nut Butter On Toast", "String Cheese", "Milk", "Turkey Sausage", "A Smoothie"],
    triggers: [],
    friction: "low", priorityWeight: 6, cooldownDays: 14, maxExtensions: 2,
  },

  // ---------- digestion / mindful eating ----------
  {
    id: "mindful-meal-3", kind: "standard", title: "Mindful Meal", noun: "mindful meals", category: "mind",
    ask: "Eat one meal a day slowly and screen-free for 3 days. Just the food and you.",
    whyTemplate: "Slowing down at one meal helps digestion and helps you notice when you're actually full, which curbs overeating.",
    durationDays: 3, checkpoints: ["One Slow Meal"],
    triggers: [],
    friction: "low", priorityWeight: 5, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- caffeine (timing/cutoff — sleep, energy, focus, cravings) ----------
  {
    id: "caffeine-curfew-3", kind: "standard", title: "Caffeine Curfew", noun: "caffeine cutoffs", category: "caffeine",
    ask: "Have your last caffeine by 2pm for 3 days. Switch to water, decaf, or herbal tea after that.",
    whyTemplate: "Caffeine lingers in your system for hours. An early cutoff helps you wind down and sleep deeper, which lifts next-day energy and focus.",
    durationDays: 3, checkpoints: ["Cutoff By 2pm"],
    triggers: [],
    friction: "low", priorityWeight: 6, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- weight goal: lose (gated to "lose", weight-framed) ----------
  {
    id: "smart-swap-3", kind: "standard", title: "Smart Swap", noun: "smart swaps", category: "balance",
    ask: "Swap one sugary drink or snack for a lighter option each day for 3 days. Sparkling water, fruit, or Greek yogurt all work.",
    whyTemplate: "Small daily swaps trim calories without feeling like a diet, and they add up faster than you'd expect.",
    durationDays: 3, checkpoints: ["Made the Swap"],
    ideas: ["Sparkling Water", "Fruit", "Greek Yogurt", "Air-Popped Popcorn", "A Dark Chocolate Square", "Herbal Tea", "Veggies And Hummus", "Cottage Cheese", "A Handful Of Nuts", "Plain Coffee"],
    goalDirections: ["lose"],
    triggers: [],
    friction: "low", priorityWeight: 7, cooldownDays: 14, maxExtensions: 2,
  },
  {
    id: "veg-half-plate-3", kind: "standard", title: "Half-Plate Veg", noun: "fuller plates", category: "balance",
    ask: "Fill half your plate with vegetables at one meal each day for 3 days. They fill you up for very few calories.",
    whyTemplate: "Leading with vegetables crowds out heavier foods and keeps you full, which makes eating a little less almost automatic.",
    durationDays: 3, checkpoints: ["Half-Plate Veg"],
    ideas: ["Broccoli", "Spinach", "Bell Peppers", "Carrots", "Frozen Peas", "Zucchini", "Tomatoes", "Mixed Greens", "Green Beans", "Cauliflower"],
    goalDirections: ["lose"],
    triggers: [],
    friction: "medium", priorityWeight: 6, cooldownDays: 21, maxExtensions: 2,
  },
  {
    id: "protein-satiety-3", kind: "standard", title: "Protein To Stay Full", noun: "filling protein", category: "protein",
    ask: "Add a protein to lunch and dinner for 3 days. Extra meat or beans, an egg, or a scoop of Greek yogurt.",
    whyTemplate: "Protein is the most filling macronutrient, so leading with it keeps you satisfied on fewer calories and takes the edge off cravings later.",
    durationDays: 3, checkpoints: ["Lunch Protein", "Dinner Protein"],
    ideas: ["Eggs", "Greek Yogurt", "Chicken Breast", "Cottage Cheese", "Tuna", "Tofu", "Lentils", "Edamame", "Beans", "A Protein Shake"],
    goalDirections: ["lose"],
    triggers: [],
    friction: "medium", priorityWeight: 7, cooldownDays: 14, maxExtensions: 2,
  },
  {
    id: "water-before-meals-3", kind: "standard", title: "Water Before Meals", noun: "pre-meal water", category: "hydration",
    ask: "Drink a glass of water before each main meal for 3 days. Right before you sit down.",
    whyTemplate: "A glass of water before eating takes the edge off hunger, so you start the meal a little less ravenous and tend to stop sooner.",
    durationDays: 3, checkpoints: ["Before Breakfast", "Before Lunch", "Before Dinner"],
    goalDirections: ["lose"],
    triggers: [],
    friction: "low", priorityWeight: 6, cooldownDays: 14, maxExtensions: 2,
  },
  {
    id: "slow-down-3", kind: "standard", title: "Slow Down", noun: "slower meals", category: "mind",
    ask: "Slow down at one meal a day for 3 days. Put the fork down between bites and let the meal take longer.",
    whyTemplate: "Fullness signals take about twenty minutes to reach your brain. Eating slower gives them time to land, so you notice you're satisfied before you overshoot.",
    durationDays: 3, checkpoints: ["One Slow Meal"],
    goalDirections: ["lose"],
    triggers: [],
    friction: "low", priorityWeight: 5, cooldownDays: 21, maxExtensions: 2,
  },

  // ---------- weight goal: gain (gated to "gain", weight-framed) ----------
  {
    id: "calorie-snack-3", kind: "standard", title: "Add a Snack", noun: "extra snacks", category: "balance",
    ask: "Add one calorie-dense snack each day for 3 days. Nut butter, trail mix, whole milk, or a smoothie.",
    whyTemplate: "Gaining comes down to a small daily surplus. One extra nourishing snack is the easiest way to add it without forcing big meals.",
    durationDays: 3, checkpoints: ["Extra Snack"],
    ideas: ["Nut Butter", "Trail Mix", "Whole Milk", "Granola", "Avocado", "Cheese", "Dried Fruit", "A Smoothie", "Peanut Butter Toast", "Hummus"],
    goalDirections: ["gain"],
    triggers: [],
    friction: "low", priorityWeight: 7, cooldownDays: 14, maxExtensions: 2,
  },
  {
    id: "protein-build-3", kind: "standard", title: "Protein To Build On", noun: "muscle-building protein", category: "protein",
    ask: "Add a protein to lunch and dinner for 3 days. Extra meat, fish, eggs, dairy, or a shake.",
    whyTemplate: "Gaining well means building muscle, not just weight, and that takes steady protein. An extra serving at two meals gives your body what it needs to grow.",
    durationDays: 3, checkpoints: ["Lunch Protein", "Dinner Protein"],
    ideas: ["Eggs", "Greek Yogurt", "Chicken Breast", "Salmon", "Ground Beef", "Cottage Cheese", "A Protein Shake", "Milk", "Tofu", "Beans"],
    goalDirections: ["gain"],
    triggers: [],
    friction: "medium", priorityWeight: 7, cooldownDays: 14, maxExtensions: 2,
  },
  {
    id: "bigger-portions-3", kind: "standard", title: "Bigger Portions", noun: "bigger portions", category: "balance",
    ask: "Add a little more to your plate at lunch and dinner for 3 days. A bigger scoop, an extra side, or seconds.",
    whyTemplate: "Gaining comes down to a steady surplus. Slightly bigger portions are an easier way to get there than forcing whole extra meals.",
    durationDays: 3, checkpoints: ["Bigger Lunch", "Bigger Dinner"],
    goalDirections: ["gain"],
    triggers: [],
    friction: "low", priorityWeight: 6, cooldownDays: 14, maxExtensions: 2,
  },
  {
    id: "gain-shake-3", kind: "standard", title: "Add a Shake", noun: "shakes", category: "protein",
    ask: "Have a calorie-rich shake or smoothie once a day for 3 days. Milk, fruit, nut butter, oats, or a scoop of protein.",
    whyTemplate: "Drinking calories is easier than eating them when appetite is the limit. A shake adds a solid hit of energy and protein without filling you up like a meal.",
    durationDays: 3, checkpoints: ["Daily Shake"],
    ideas: ["Whole Milk", "Banana", "Peanut Butter", "Oats", "Greek Yogurt", "A Protein Scoop", "Honey", "Frozen Berries", "Almond Butter", "Chia Seeds"],
    goalDirections: ["gain"],
    triggers: [],
    friction: "low", priorityWeight: 6, cooldownDays: 14, maxExtensions: 2,
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

// Standard habit templates relevant to the user's feeling goal(s) and body goal,
// best-matched first (the rest follow so cycling/fallback still works). Body-goal
// targeted habits (goalDirections set) ONLY appear when the direction matches, so a
// "gain" snack never shows to someone losing. Empty goals = all eligible standard.
export function habitsForGoals(
  goals: FeelingGoal[] | undefined,
  goalDirection?: GoalDirection,
  templates: HabitTemplate[] = HABIT_TEMPLATES,
): HabitTemplate[] {
  const standard = templates.filter((t) => t.kind === "standard");
  // Drop body-goal habits that don't match this user's direction.
  const eligible = standard.filter((t) => !t.goalDirections || (goalDirection != null && t.goalDirections.includes(goalDirection)));
  const cats = new Set((goals ?? []).flatMap((g) => FEELING_GOAL_CATEGORIES[g] ?? []));
  const matches = (t: HabitTemplate) =>
    (t.goalDirections != null && goalDirection != null && t.goalDirections.includes(goalDirection)) ||
    (cats.size > 0 && cats.has(t.category));
  if (cats.size === 0 && goalDirection == null) return eligible;
  const matched = eligible.filter(matches);
  const rest = eligible.filter((t) => !matches(t));
  return [...matched, ...rest];
}
