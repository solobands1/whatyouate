// Small helpers for the Patterns page: "New Since You Last Looked" (a line or two inside the
// coach card), the date on the unlock countdown, and ordering by what the user said matters
// most at onboarding (profiles.feeling_goals). Pure functions; the screen does the storage.

import type { ReflectionFacts } from "./reflectionFacts";
import type { DiscoveryCandidate } from "./discoveries";
import type { FoodFeelingLink } from "./foodFeeling";
import type { ActiveChange } from "./changes";

// ── Ordering by stated goal ─────────────────────────────────────────────────
// Onboarding goals mapped onto what the nightly reflection asks about.
const GOAL_METRIC: Record<string, string | null> = { energy: "energy", digestion: "digestion", sleep: "sleep", mood: "mood", focus: "energy", cravings: null };
const METRIC_WORDS: Record<string, RegExp> = {
  energy: /energy|drained|tired/i,
  digestion: /digest/i,
  sleep: /sleep|slept/i,
  mood: /mood/i,
  stress: /stress/i,
};

export function firstGoalMetric(goals: string[] | undefined): string | null {
  for (const g of goals ?? []) { const m = GOAL_METRIC[g]; if (m) return m; }
  return null;
}

// Stable: items about the first goal move to the front, everything else keeps its order.
export function goalFirst<T>(items: T[], metric: string | null, about: (t: T) => string): T[] {
  if (!metric || !METRIC_WORDS[metric]) return items;
  const re = METRIC_WORDS[metric];
  return [...items.filter((t) => re.test(about(t))), ...items.filter((t) => !re.test(about(t)))];
}

// ── Countdown date ──────────────────────────────────────────────────────────
// Assumes one reflection a night from tonight (or tomorrow, if tonight's is already done).
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function unlockEta(nightsLeft: number, reflectedToday: boolean, now = Date.now()): string {
  const offset = reflectedToday ? nightsLeft : nightsLeft - 1;
  if (offset <= 0) return "Tonight";
  if (offset === 1) return "Tomorrow Night";
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return `Around ${WEEKDAY[d.getDay()]}`;
}

// ── New since you last looked ───────────────────────────────────────────────
export interface SeenSnapshot {
  v: 1;
  day: string;
  links: Record<string, { s: number; n: number; c: "Building" | "Moderate" }>;
  energy: string | null;
  dip: string | null;
  habits: Record<string, "better" | "worse" | "flat" | null>;
}

export interface SinceInput {
  foodLinks: FoodFeelingLink[];
  candidates: DiscoveryCandidate[];
  facts: ReflectionFacts;
  changes: Pick<ActiveChange, "templateId" | "label" | "targetKey" | "effect" | "stopped">[];
  goal: string | null;
}

interface Link { key: string; phrase: string; s: number; n: number; hits: number; c: "Building" | "Moderate"; about: string }

const PAIR_PHRASE: Record<string, string> = {
  "sleep-energy": "sleeping well and better energy",
  "sleep-mood": "sleeping well and a better mood",
  "stress-sleep": "high stress and poorer sleep",
  "stress-energy": "high stress and lower energy",
  "digestion-energy": "rough digestion and lower energy",
  "digestion-mood": "rough digestion and a lower mood",
};

// The connections the coach card can show, in the order it shows them: food links first, then
// the reflection discoveries (by their underlying candidates), goal first, top two.
function visibleLinks(input: SinceInput): Link[] {
  const food: Link[] = input.foodLinks.map((l) => ({
    key: `food:${l.tag}:${l.lag}`,
    phrase: `${l.label} and lower energy${l.lag === "next_day" ? " the next day" : ""}`,
    s: l.lowWith - l.lowWithout, n: l.nWith, hits: Math.round(l.lowWith * l.nWith), c: l.confidence, about: "energy",
  }));
  const disc: Link[] = input.candidates.slice(0, 3).map((c) => ({
    key: `disc:${c.id}`, phrase: PAIR_PHRASE[c.id] ?? c.text, s: c.hits / c.n, n: c.n, hits: c.hits, c: c.confidence, about: c.id,
  }));
  return goalFirst([...food, ...disc], input.goal, (l) => l.about.replace("-", " ")).slice(0, 2);
}

function dayKey(now: number) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function seenSnapshot(input: SinceInput, now = Date.now()): SeenSnapshot {
  const links: SeenSnapshot["links"] = {};
  for (const l of visibleLinks(input)) links[l.key] = { s: l.s, n: l.n, c: l.c };
  const habits: SeenSnapshot["habits"] = {};
  for (const c of input.changes) if (!c.stopped) habits[c.templateId] = c.effect?.direction ?? null;
  const dip = input.facts.dip && !("none" in input.facts.dip) ? input.facts.dip.time : null;
  return { v: 1, day: dayKey(now), links, energy: input.facts.energyPhrase, dip, habits };
}

export function parseSeen(raw: string | null): SeenSnapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return s && s.v === 1 && s.links && typeof s.links === "object" && s.habits && typeof s.habits === "object" ? (s as SeenSnapshot) : null;
  } catch {
    return null;
  }
}

const ENERGY_TURN: Record<string, string> = {
  "energy held up well": "Your energy has picked up: it held up well this week.",
  "energy ran low": "Your energy has dipped: it ran low this week.",
  "energy was up and down": "Your energy has been more up and down this week.",
};
const LOW_NIGHTS: Record<string, string> = { energy: "low-energy", sleep: "poor-sleep", mood: "low-mood", digestion: "poor-digestion", stress: "high-stress" };

// At most two short, plain lines, most telling first. Empty when nothing meaningful changed or
// when there is no earlier visit to compare with.
export function sinceLines(prev: SeenSnapshot | null, input: SinceInput): string[] {
  if (!prev) return [];
  const out: string[] = [];
  for (const l of visibleLinks(input)) {
    const was = prev.links[l.key];
    if (!was) out.push(`New connection: ${l.phrase}.`);
    else if (l.n > was.n && ((was.c === "Building" && l.c === "Moderate") || l.s >= was.s + 0.1)) {
      out.push(`Getting clearer: ${l.phrase}, now ${l.hits} of ${l.n} days.`);
    }
  }
  for (const c of input.changes) {
    if (c.stopped || c.effect?.direction !== "better" || prev.habits[c.templateId] === "better") continue;
    out.push(`${c.label} now lines up with fewer ${LOW_NIGHTS[c.targetKey] ?? "low-energy"} nights.`);
  }
  const energy = input.facts.energyPhrase;
  if (energy && prev.energy && energy !== prev.energy && ENERGY_TURN[energy]) out.push(ENERGY_TURN[energy]);
  const dip = input.facts.dip && !("none" in input.facts.dip) ? input.facts.dip.time : null;
  if (dip && dip !== prev.dip) out.push(prev.dip ? `Your energy dips have moved to the ${dip.toLowerCase()}.` : `Your energy dips now show up most in the ${dip.toLowerCase()}.`);
  return out.slice(0, 2);
}
