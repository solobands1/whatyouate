// Deterministic discovery candidates from reflections. We compute REAL co-occurrence
// counts (same-entry: "last night's sleep" pairs with "today's" energy/mood/etc.), then
// the AI layer only selects + phrases these — it never invents numbers. Everything here is
// a literal count with a min-sample guard, so nothing is fabricated. See project_data_wiring.

import type { ReflectionEntry } from "./habitState";

const MIN_SAMPLE = 5;   // need at least this many antecedent days to say anything
const MIN_RATE = 0.6;   // and the consequent must hold on at least this fraction

type Pred = (idx: number) => boolean;
const good = (idx: number) => idx >= 3;        // energy: Good/Great
const goodMid = (idx: number) => idx >= 2;     // sleep/mood/digestion (4-opt): Good/Great
const low = (idx: number) => idx <= 1;         // energy: Drained/Low
const poor = (idx: number) => idx === 0;       // sleep/mood/digestion: Poor
const highStress = (idx: number) => idx >= 3;  // stress: High

interface Pair {
  id: string;
  a: { key: string; pred: Pred; phrase: string };  // antecedent, e.g. "slept well"
  b: { key: string; pred: Pred; phrase: string };  // consequent, e.g. "energy was good"
}

// A small, curated set of self-report links worth surfacing. Kept conservative on purpose.
const PAIRS: Pair[] = [
  { id: "sleep-energy", a: { key: "sleep", pred: goodMid, phrase: "slept well" }, b: { key: "energy", pred: good, phrase: "your energy was good too" } },
  { id: "sleep-mood", a: { key: "sleep", pred: goodMid, phrase: "slept well" }, b: { key: "mood", pred: goodMid, phrase: "your mood was good too" } },
  { id: "stress-sleep", a: { key: "stress", pred: highStress, phrase: "felt high stress" }, b: { key: "sleep", pred: poor, phrase: "you slept poorly" } },
  { id: "stress-energy", a: { key: "stress", pred: highStress, phrase: "felt high stress" }, b: { key: "energy", pred: low, phrase: "your energy ran low" } },
  { id: "digestion-energy", a: { key: "digestion", pred: poor, phrase: "digestion was poor" }, b: { key: "energy", pred: low, phrase: "your energy ran low" } },
  { id: "digestion-mood", a: { key: "digestion", pred: poor, phrase: "digestion was poor" }, b: { key: "mood", pred: poor, phrase: "your mood dipped" } },
];

export interface DiscoveryCandidate {
  id: string;
  text: string;                          // honest, real-count statement
  confidence: "Building" | "Moderate";   // by sample size
  n: number;
  hits: number;
}

function conf(n: number): "Building" | "Moderate" {
  return n >= 10 ? "Moderate" : "Building";
}

export function computeDiscoveryCandidates(reflections: ReflectionEntry[], windowDays = 30): DiscoveryCandidate[] {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (windowDays - 1));
  const rows = reflections.filter((e) => new Date(e.date + "T00:00:00") >= cutoff);

  const out: DiscoveryCandidate[] = [];
  for (const p of PAIRS) {
    let n = 0, hits = 0;
    for (const e of rows) {
      const av = e.answers[p.a.key];
      const bv = e.answers[p.b.key];
      if (typeof av !== "number" || typeof bv !== "number") continue;
      if (!p.a.pred(av)) continue;
      n++;
      if (p.b.pred(bv)) hits++;
    }
    if (n < MIN_SAMPLE) continue;
    if (hits / n < MIN_RATE) continue;
    out.push({
      id: p.id,
      text: `On ${n} of the days you ${p.a.phrase}, ${p.b.phrase} on ${hits} of them.`,
      confidence: conf(n),
      n,
      hits,
    });
  }
  // Strongest first (highest rate, then largest sample).
  return out.sort((x, y) => (y.hits / y.n) - (x.hits / x.n) || y.n - x.n);
}
