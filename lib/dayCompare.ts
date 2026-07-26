// "Your Days Compared": split days into high-energy vs low-energy (from the reflection
// energy rating) and surface which real, logged behaviours differ between the two groups.
// Deterministic + honest — every item is a real rate difference across your own days, with
// min-sample guards. No causal claims; the card frames them as "what your better days tend
// to look like." Behavioural data comes from meal counts, workouts, and sleep rating.

import type { ReflectionEntry } from "./habitState";

const MIN_GROUP = 3;   // need at least this many days in each group
const MIN_DIFF = 0.25; // and a behaviour must differ by at least this rate to surface
const MIN_RATE = 0.4;  // and be present on at least this share of the group it lands in

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface DayCtx {
  energyIdx: number | null;
  sleepIdx: number | null;
  mealTimes: number[]; // epoch ms of meals that day
  hasWorkout: boolean;
}

interface DayFacts {
  mealCount: number;
  hasWorkout: boolean;
  sleepIdx: number | null;
}

// Meal *timing* is deliberately excluded: log times are unreliable (backfilled / logged after the
// fact), which is exactly why the coach is banned from timing claims. Only reliable signals —
// movement, meal count, sleep — are compared here.
const BEHAVIOURS: { label: string; test: (d: DayFacts) => boolean }[] = [
  { label: "A walk or workout", test: (d) => d.hasWorkout },
  { label: "Little movement", test: (d) => !d.hasWorkout },
  { label: "Steady meals through the day", test: (d) => d.mealCount >= 3 },
  { label: "Long gaps without eating", test: (d) => d.mealCount > 0 && d.mealCount <= 1 },
  { label: "Slept well", test: (d) => d.sleepIdx != null && d.sleepIdx >= 2 },
  { label: "Slept poorly", test: (d) => d.sleepIdx === 0 },
];

export interface DaysCompared {
  better: string[];
  low: string[];
  hasData: boolean;
}

export function computeDaysCompared(
  reflections: ReflectionEntry[],
  meals: { ts: number }[],
  workouts: { startTs?: number }[],
  windowDays = 30,
): DaysCompared {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (windowDays - 1));

  // Seed a context for every reflected day in the window.
  const byDate = new Map<string, DayCtx>();
  for (const e of reflections) {
    if (new Date(e.date + "T00:00:00") < cutoff) continue;
    byDate.set(e.date, {
      energyIdx: typeof e.answers.energy === "number" ? (e.answers.energy as number) : null,
      sleepIdx: typeof e.answers.sleep === "number" ? (e.answers.sleep as number) : null,
      mealTimes: [],
      hasWorkout: false,
    });
  }
  for (const m of meals) {
    const ctx = byDate.get(dayKey(m.ts));
    if (ctx) ctx.mealTimes.push(m.ts);
  }
  for (const w of workouts) {
    if (typeof w.startTs !== "number") continue;
    const ctx = byDate.get(dayKey(w.startTs));
    if (ctx) ctx.hasWorkout = true;
  }

  const toFacts = (c: DayCtx): DayFacts => ({
    mealCount: c.mealTimes.length,
    hasWorkout: c.hasWorkout,
    sleepIdx: c.sleepIdx,
  });

  const better: DayFacts[] = [];
  const low: DayFacts[] = [];
  for (const c of byDate.values()) {
    if (c.energyIdx == null) continue;
    if (c.energyIdx >= 3) better.push(toFacts(c));
    else if (c.energyIdx <= 1) low.push(toFacts(c));
  }
  if (better.length < MIN_GROUP || low.length < MIN_GROUP) return { better: [], low: [], hasData: false };

  const rate = (group: DayFacts[], test: (d: DayFacts) => boolean) => group.filter(test).length / group.length;

  const betterOut: { label: string; diff: number }[] = [];
  const lowOut: { label: string; diff: number }[] = [];
  for (const b of BEHAVIOURS) {
    const bRate = rate(better, b.test);
    const lRate = rate(low, b.test);
    const diff = bRate - lRate;
    if (diff >= MIN_DIFF && bRate >= MIN_RATE) betterOut.push({ label: b.label, diff });
    else if (-diff >= MIN_DIFF && lRate >= MIN_RATE) lowOut.push({ label: b.label, diff: -diff });
  }
  betterOut.sort((a, b) => b.diff - a.diff);
  lowOut.sort((a, b) => b.diff - a.diff);

  const betterLabels = betterOut.slice(0, 4).map((x) => x.label);
  const lowLabels = lowOut.slice(0, 4).map((x) => x.label);
  return { better: betterLabels, low: lowLabels, hasData: betterLabels.length + lowLabels.length > 0 };
}
