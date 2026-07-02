// Pure derivation layer over nightly reflections. One place that turns raw ReflectionEntry
// rows into the facts every surface renders (the Reflections page, the Patterns page, and
// later the AI coach). Deterministic + testable — no React, no fabrication, just counts and
// trends with real numbers. Interpretation ("what it means") is a separate, AI job.

import type { ReflectionEntry } from "./habitState";

export const REFLECTION_METRICS: { key: string; label: string; opts: string[] }[] = [
  { key: "energy", label: "Energy", opts: ["Drained", "Low", "Okay", "Good", "Great"] },
  { key: "sleep", label: "Sleep", opts: ["Poor", "Okay", "Good", "Great"] },
  { key: "mood", label: "Mood", opts: ["Poor", "Okay", "Good", "Great"] },
  { key: "stress", label: "Stress", opts: ["None", "Mild", "Moderate", "High"] },
  { key: "digestion", label: "Digestion", opts: ["Poor", "Okay", "Good", "Great"] },
];
export const REFLECTION_DIPS_OPTS = ["None", "Morning", "Afternoon", "Evening"];
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

// Dark blue / light blue / grey — matches "Your Energy Lately" on the Patterns page.
export type Level = "good" | "ok" | "low";
export const REFLECTION_DOT: Record<Level, string> = { good: "bg-primary", ok: "bg-primary/35", low: "bg-ink/25" };

// Map an answer index to a good/ok/low band. Stress is inverted (None is good).
export function levelFor(key: string, idx: number): Level {
  if (key === "energy") return idx <= 1 ? "low" : idx === 2 ? "ok" : "good";
  if (key === "stress") return idx === 0 ? "good" : idx <= 2 ? "ok" : "low";
  return idx === 0 ? "low" : idx === 1 ? "ok" : "good"; // sleep / mood / digestion
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function dateKey(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export interface DayCell {
  key: string;
  label: string;
  isToday: boolean;
  energy: Level | null;
  done: boolean;
}

export type DipSignal = { time: string; count: number; days: number } | { none: true } | null;

export interface ReflectionFacts {
  total: number;                    // how many reflections exist
  hasSignals: boolean;              // enough data (>=3) to interpret
  week: DayCell[];                  // last 7 days, oldest -> newest
  reflectedCount: number;           // nights reflected in the last 7
  energyPhrase: string | null;      // short read of this week's energy
  streak: number;                   // consecutive reflected nights
  dip: DipSignal;                   // most common energy-dip time
  watch: { label: string; low: number; n: number } | null; // the area most often low
}

function recentWithin(sorted: ReflectionEntry[], days: number): ReflectionEntry[] {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  return sorted.filter((e) => new Date(e.date + "T00:00:00") >= cutoff);
}

function last7Days(sorted: ReflectionEntry[]): DayCell[] {
  const byDate = new Map(sorted.map((e) => [e.date, e]));
  const out: DayCell[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const e = byDate.get(dateKey(d));
    const idx = e && typeof e.answers.energy === "number" ? (e.answers.energy as number) : null;
    out.push({ key: dateKey(d), label: WEEKDAY[d.getDay()], isToday: i === 0, energy: idx == null ? null : levelFor("energy", idx), done: !!e });
  }
  return out;
}

function energyPhrase(levels: (Level | null)[]): string | null {
  const vals = levels.filter((l): l is Level => l !== null);
  if (vals.length < 3) return null;
  const good = vals.filter((l) => l === "good").length;
  const low = vals.filter((l) => l === "low").length;
  if (good >= Math.ceil(vals.length * 0.6)) return "energy held up well";
  if (low >= Math.ceil(vals.length * 0.5)) return "energy ran low";
  return "energy was up and down";
}

function dipSignal(recent: ReflectionEntry[]): DipSignal {
  const counts = [0, 0, 0, 0];
  let days = 0;
  recent.forEach((e) => {
    const v = e.answers.dips;
    if (Array.isArray(v)) { days++; v.forEach((i) => { if (i > 0 && i < 4) counts[i]++; }); }
  });
  if (days < 3) return null;
  const max = Math.max(counts[1], counts[2], counts[3]);
  if (max === 0) return { none: true };
  return { time: REFLECTION_DIPS_OPTS[counts.indexOf(max)], count: max, days };
}

function watchArea(recent: ReflectionEntry[]): { label: string; low: number; n: number } | null {
  let worst: { label: string; low: number; n: number } | null = null;
  for (const m of REFLECTION_METRICS) {
    let low = 0, n = 0;
    recent.forEach((e) => {
      const idx = e.answers[m.key];
      if (typeof idx === "number") { n++; if (levelFor(m.key, idx) === "low") low++; }
    });
    if (n >= 3 && low >= 2 && (!worst || low > worst.low)) worst = { label: m.label, low, n };
  }
  return worst;
}

// Consecutive reflected nights ending today (or yesterday, since tonight's may not be done
// yet). Walks the date set so it isn't capped at a week.
function currentStreak(sorted: ReflectionEntry[]): number {
  const set = new Set(sorted.map((e) => e.date));
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (!set.has(dateKey(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (set.has(dateKey(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

export function computeReflectionFacts(entries: ReflectionEntry[]): ReflectionFacts {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const week = last7Days(sorted);
  const recent = recentWithin(sorted, 14);
  return {
    total: sorted.length,
    hasSignals: sorted.length >= 3,
    week,
    reflectedCount: week.filter((d) => d.done).length,
    energyPhrase: energyPhrase(week.map((d) => d.energy)),
    streak: currentStreak(sorted),
    dip: sorted.length >= 3 ? dipSignal(recent) : null,
    watch: sorted.length >= 3 ? watchArea(recent) : null,
  };
}
