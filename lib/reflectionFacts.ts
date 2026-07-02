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

export interface DipsDistribution { morning: number; afternoon: number; evening: number; days: number }
export type ChangeDir = "up" | "down" | "same";
export interface MetricChange { key: string; label: string; dir: ChangeDir }

export interface ReflectionFacts {
  total: number;                    // how many reflections exist
  hasSignals: boolean;              // enough data (>=3) to interpret
  week: DayCell[];                  // last 7 days, oldest -> newest (energy)
  metricWeeks: Record<string, (Level | null)[]>; // per-metric last-7 level strips
  reflectedCount: number;           // nights reflected in the last 7
  energyPhrase: string | null;      // short read of this week's energy
  streak: number;                   // consecutive reflected nights
  dip: DipSignal;                   // most common energy-dip time
  dipsDist: DipsDistribution | null;// full morning/afternoon/evening distribution
  watch: { label: string; low: number; n: number } | null; // the area most often low
  changes: MetricChange[] | null;   // improved/worsened vs last week
}

const LEVEL_SCORE: Record<Level, number> = { good: 2, ok: 1, low: 0 };

// Last 7 days of a given metric, oldest -> newest, null where no reflection exists.
function metricWeek(byDate: Map<string, ReflectionEntry>, key: string): (Level | null)[] {
  const out: (Level | null)[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const e = byDate.get(dateKey(d));
    const idx = e && typeof e.answers[key] === "number" ? (e.answers[key] as number) : null;
    out.push(idx == null ? null : levelFor(key, idx));
  }
  return out;
}

function dipsDistribution(recent: ReflectionEntry[]): DipsDistribution | null {
  const counts = [0, 0, 0, 0];
  let days = 0;
  recent.forEach((e) => {
    const v = e.answers.dips;
    if (Array.isArray(v)) { days++; v.forEach((i) => { if (i > 0 && i < 4) counts[i]++; }); }
  });
  if (days < 3) return null;
  return { morning: counts[1], afternoon: counts[2], evening: counts[3], days };
}

// Improvement direction per metric, this week (0-6d) vs the prior week (7-13d). Uses the
// good/ok/low band score so "up" always means "felt better" (stress is already inverted).
function whatChanged(entries: ReflectionEntry[]): MetricChange[] | null {
  const inWindow = (e: ReflectionEntry, from: number, to: number) => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const t = new Date(e.date + "T00:00:00").getTime();
    return t <= now.getTime() - from * 86_400_000 && t > now.getTime() - to * 86_400_000;
  };
  const avg = (rows: ReflectionEntry[], key: string): number | null => {
    const scores = rows.map((e) => e.answers[key]).filter((v): v is number => typeof v === "number").map((idx) => LEVEL_SCORE[levelFor(key, idx)]);
    return scores.length >= 2 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  };
  const thisWeek = entries.filter((e) => inWindow(e, 0, 7));
  const lastWeek = entries.filter((e) => inWindow(e, 7, 14));
  const out: MetricChange[] = [];
  for (const m of REFLECTION_METRICS) {
    const a = avg(thisWeek, m.key);
    const b = avg(lastWeek, m.key);
    if (a == null || b == null) continue;
    out.push({ key: m.key, label: m.label, dir: a > b + 0.34 ? "up" : a < b - 0.34 ? "down" : "same" });
  }
  return out.length ? out : null;
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
  const byDate = new Map(sorted.map((e) => [e.date, e]));
  const week = last7Days(sorted);
  const recent = recentWithin(sorted, 14);
  const metricWeeks: Record<string, (Level | null)[]> = {};
  for (const m of REFLECTION_METRICS) metricWeeks[m.key] = metricWeek(byDate, m.key);
  return {
    total: sorted.length,
    hasSignals: sorted.length >= 3,
    week,
    metricWeeks,
    reflectedCount: week.filter((d) => d.done).length,
    energyPhrase: energyPhrase(week.map((d) => d.energy)),
    streak: currentStreak(sorted),
    dip: sorted.length >= 3 ? dipSignal(recent) : null,
    dipsDist: dipsDistribution(recent),
    watch: sorted.length >= 3 ? watchArea(recent) : null,
    changes: whatChanged(sorted),
  };
}
