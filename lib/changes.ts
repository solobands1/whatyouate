// "Changes You're Making" — the ledger of things the user is currently doing (kept habits
// for now; user-logged changes later), each tied to the reflection metric it targets, plus
// a deterministic before/after attribution: did the target metric improve since they
// started? Measurement is passive (the nightly reflections already measure); this just
// compares the windows. Honest guards: needs >=4 reflected days on each side, hedged copy.

import type { HabitHistoryEntry, ReflectionEntry } from "./habitState";
import { HABIT_TEMPLATES } from "./habits";
import { levelFor } from "./reflectionFacts";
import type { ChangeStatusEntry } from "./changeStatus";

const DAY = 86_400_000;

// Which reflection metric each habit category is primarily trying to move.
const CATEGORY_TARGET: Record<string, string> = {
  hydration: "energy", protein: "energy", movement: "energy", micronutrient: "energy", balance: "energy", logging: "energy",
  caffeine: "sleep", sleep: "sleep", timing: "sleep",
  produce: "digestion",
  mind: "mood",
};

export interface ChangeEffect {
  direction: "better" | "worse" | "flat";
  beforePerWeek: number; // low days per week before the change
  afterPerWeek: number;  // low days per week since
  n: number;             // reflected days since the change (confidence)
}

export interface ActiveChange {
  id: string;
  templateId: string;
  label: string;
  startDate: string;   // YYYY-MM-DD the habit was kept
  targetKey: string;   // reflection metric it targets
  keep: "yes" | "maybe";
  effect: ChangeEffect | null; // null until there's enough before/after data
  stopped: boolean;    // user said they stopped (from changeStatus)
}

function effectFor(startDate: string, targetKey: string, reflections: ReflectionEntry[]): ChangeEffect | null {
  const start = new Date(startDate + "T00:00:00").getTime();
  if (Number.isNaN(start)) return null;
  const now = Date.now();
  const before: number[] = [];
  const after: number[] = [];
  for (const e of reflections) {
    const idx = e.answers[targetKey];
    if (typeof idx !== "number") continue;
    const t = new Date(e.date + "T00:00:00").getTime();
    const isLow = levelFor(targetKey, idx) === "low" ? 1 : 0;
    if (t < start && t >= start - 28 * DAY) before.push(isLow);
    else if (t >= start && t <= now) after.push(isLow);
  }
  if (before.length < 4 || after.length < 4) return null;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const bRate = mean(before);
  const aRate = mean(after);
  const diff = bRate - aRate; // positive = fewer low days now = better
  const direction = diff >= 0.2 ? "better" : diff <= -0.2 ? "worse" : "flat";
  return { direction, beforePerWeek: Math.round(bRate * 7), afterPerWeek: Math.round(aRate * 7), n: after.length };
}

export function computeActiveChanges(
  history: HabitHistoryEntry[],
  reflections: ReflectionEntry[],
  statuses: Record<string, ChangeStatusEntry> = {},
): ActiveChange[] {
  const seen = new Set<string>();
  const out: ActiveChange[] = [];
  for (const h of [...history].sort((a, b) => (b.finishedAt || "").localeCompare(a.finishedAt || ""))) {
    if (h.keep !== "yes" && h.keep !== "maybe") continue;
    const dedupe = h.title.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const st = statuses[h.templateId]?.status;
    if (st === "not_for_me") continue; // the user retired this one
    const tmpl = HABIT_TEMPLATES.find((t) => t.id === h.templateId);
    const targetKey = tmpl ? (CATEGORY_TARGET[tmpl.category] ?? "energy") : "energy";
    const startDate = (h.finishedAt || "").slice(0, 10);
    out.push({
      id: h.templateId + (h.finishedAt || ""),
      templateId: h.templateId,
      label: h.title,
      startDate,
      targetKey,
      keep: h.keep,
      effect: startDate ? effectFor(startDate, targetKey, reflections) : null,
      stopped: st === "stopped",
    });
  }
  // Active ones first, stopped ones after.
  return out.sort((a, b) => Number(a.stopped) - Number(b.stopped));
}
