// The Patterns page engine. Pure and deterministic: it turns the data the app already loads
// (reflections, meals, workouts, water) into what the Patterns page shows. No network, no AI,
// no schema change. Every number on the page is a literal count from the user's own days,
// behind a minimum-sample guard, and every sentence is phrased as "lines up with", never
// "causes".
//
// Cost: one pass over up to 56 days plus the loaded meals (capped at 400 by listMeals), then a
// handful of counts per food and per candidate. Well under a millisecond or two on a phone;
// the screen memoises it on its inputs.

import type { ReflectionEntry } from "./habitState";
import type { FeelingGoal, MealLog, WorkoutSession } from "./types";
import { levelFor, REFLECTION_METRICS, type Level } from "./reflectionFacts";
import {
  FEELING_TAG_LABEL,
  NEGATIVE_FEELING_TAGS,
  POSITIVE_FEELING_TAGS,
  sanitizeFeelingTags,
  type FeelingTag,
} from "./foodTags";

// ── Tuning ──────────────────────────────────────────────────────────────────
export const WINDOW_DAYS = 42;        // analysis window (6 weeks)
const GRID_WEEKS = 8;                 // the week-by-week grid shows up to 8 weeks
const STRIP_DAYS = 14;                // the hero's evidence strip
export const HERO_MIN_NIGHTS = 7;     // nights before the clearest pattern can appear
export const COMPARE_MIN_NIGHTS = 9;  // nights before better vs slower days
export const FOODS_MIN_DAYS = 9;      // days with meals AND a reflection before foods
export const DIPS_MIN_NIGHTS = 3;     // nights with the dips question answered
export const WEEKDAY_MIN = 4;         // reflections per weekday before a weekday read
const FOOD_MIN_DAYS = 4;              // a food or food type must show up on this many days
                                      // (same minimum as lib/foodFeeling.ts)
const TYPE_MIN_DAYS = 4;              // a food type (feeling tag) on this many days

// ── Types ───────────────────────────────────────────────────────────────────
export interface PatternsInput {
  reflections: ReflectionEntry[];
  meals: MealLog[];
  workouts: WorkoutSession[];
  waterLogs: Record<string, number>;
  feelingGoals?: FeelingGoal[];
  waterUnit?: "ml" | "oz";
  now?: number;
}

export interface DayMeal { name: string; tags: FeelingTag[]; hour: number; protein: number | null }

export interface DayRecord {
  key: string;
  ts: number;
  weekday: number;
  reflected: boolean;
  energy: number | null;
  sleep: number | null;
  mood: number | null;
  stress: number | null;
  digestion: number | null;
  dips: number[] | null;
  meals: DayMeal[];
  moved: boolean;
  moveMin: number;
  waterMl: number | null;
}

export type Metric = "energy" | "digestion" | "sleep";

export interface Split { withHits: number; withN: number; withoutHits: number; withoutN: number }

export interface StripCell { key: string; dayLabel: string; cond: boolean | null; level: Level | null }

export interface PatternFinding {
  id: string;
  kind: "sleep" | "move" | "water" | "stress" | "food";
  metric: Metric;
  headline: string;
  withLabel: string;
  withoutLabel: string;
  outcomeLabel: string;
  condShort: string;
  outcomeShort: string;
  lagged: boolean;
  split: Split;
  strip: StripCell[];
  score: number;
  overlayId: string | null; // which week-grid overlay shows the same condition
  rowKey: string | null;    // for food findings: the Foods row it came from (metric:id:lag)
}

export interface FoodRow { id: string; label: string; kind: "food" | "type"; n: number; hits: number; dots: Level[]; lag: boolean }
export interface WatchItem { id: string; label: string; kind: "food" | "type"; have: number; need: number }

export interface FoodLinks {
  metric: "energy" | "digestion";
  status: "ready" | "building" | "none";
  eligible: number;
  need: number;
  baseGood: number;
  baseLow: number;
  good: FoodRow[];
  low: FoodRow[];
  watching: WatchItem[];
  neutral: string[];
  all: Record<string, { label: string; n: number; good: number; low: number }>; // same-day counts, every food seen
  goodWords: string;
  lowWords: string;
}

export type CompareId = "sleep" | "move" | "water" | "stress" | "meals" | "protein" | "type";
export interface CompareRow {
  id: string;
  icon: CompareId;
  label: string;
  better: number;
  slower: number;
  betterText: string;
  slowerText: string;
  scaleMax: number;
  effect: number;
}
export interface BetterSlower {
  metric: "energy" | "digestion";
  status: "ready" | "building" | "steady";
  mode: "bands" | "thirds";
  nights: number;
  need: number;
  betterN: number;
  slowerN: number;
  betterDef: string;
  slowerDef: string;
  rows: CompareRow[];
  same: string[];
  summary: string | null;
}

export interface GridCell { key: string; day: number; level: Level | null; reflected: boolean; future: boolean; before: boolean; isToday: boolean }
export interface GridWeek { key: string; label: string; cells: GridCell[]; good: number; rated: number }
export interface Overlay { id: string; label: string; days: string[]; summary: string }
export interface WeekdayRead { weekday: string; hits: number; n: number; words: string }
export interface DayDetail {
  key: string;
  label: string;
  feel: { label: string; word: string; level: Level }[];
  movement: string | null;
  water: string | null;
  foods: string[];
}
export interface WeekGrid {
  weeks: GridWeek[];
  details: Record<string, DayDetail>;
  overlays: Overlay[];
  best: WeekdayRead | null;
  slowest: WeekdayRead | null;
  weekdayRemaining: number;
  weekdayN: number[]; // reflections with an energy answer, per weekday (Sun..Sat)
}

export interface DipCounts { morning: number; afternoon: number; evening: number; nights: number }
export interface DipRhythm { recent: DipCounts | null; prior: DipCounts | null; peak: "morning" | "afternoon" | "evening" | null; answered: number }

export interface LevelCounts { good: number; ok: number; low: number; n: number }
export interface MetricWeek { key: string; label: string; dir: "up" | "down" | "same"; thisWeek: LevelCounts; lastWeek: LevelCounts }
export interface WeekCompare { ready: boolean; rows: MetricWeek[]; thisN: number; lastN: number; readyOn: string | null }

export interface UnlockItem { id: string; title: string; detail: string; have: number; need: number }
export type Lens = "energy" | "digestion";

export interface PatternsTotals {
  nights: number;
  meals: number;
  workouts: number;
  waterDays: number;
  spanDays: number;
  topFood: { label: string; count: number } | null;
  reflectedToday: boolean;
}

export interface PatternsModel {
  totals: PatternsTotals;
  nightsInWindow: number;
  heroStatus: "ready" | "building" | "none";
  findings: PatternFinding[];
  betterSlower: { energy: BetterSlower; digestion: BetterSlower };
  foods: { energy: FoodLinks; digestion: FoodLinks };
  lenses: Lens[];                 // Energy / Digestion, in the order of the user's stated focus
  coverage: { mealDays: number; nights: number; both: number }; // last 6 weeks
  grid: WeekGrid;
  dips: DipRhythm;
  weekCompare: WeekCompare;
  unlocks: UnlockItem[];
}

// ── Date helpers ────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
const WEEKDAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number) { return String(n).padStart(2, "0"); }
export function keyOf(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function midnight(ts: number): Date { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function parseKey(key: string): Date { return new Date(key + "T00:00:00"); }
export function shortDate(key: string): string { const d = parseKey(key); return `${MONTH[d.getMonth()]} ${d.getDate()}`; }
export function longDate(key: string): string { const d = parseKey(key); return `${WEEKDAY_ABBR[d.getDay()]}, ${MONTH[d.getMonth()]} ${d.getDate()}`; }

function num(v: unknown): number | null { return typeof v === "number" ? v : null; }
// Answers are option indexes. Anything outside the question's options (old or hand-edited rows)
// is treated as unanswered rather than guessed at.
const ANSWER_MAX: Record<string, number> = { energy: 4, sleep: 3, mood: 3, stress: 3, digestion: 3 };
function answer(answers: Record<string, unknown>, key: string): number | null {
  const v = answers?.[key];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= ANSWER_MAX[key] ? v : null;
}
function plural(n: number, one: string, many = one + "s") { return `${n} ${n === 1 ? one : many}`; }

// ── Meals ───────────────────────────────────────────────────────────────────
function titleCase(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
function isRealMeal(m: MealLog): boolean {
  if (m.status && m.status !== "done") return false;
  return m.analysisJson?.source !== "supplement";
}
function mealName(m: MealLog): string | null {
  const a = m.analysisJson;
  const raw = a?.canonical_name || a?.name || a?.detected_items?.[0]?.name || "";
  const t = titleCase(raw);
  return t && t !== "Unknown" && t !== "Meal" ? t : null;
}
function mealProtein(m: MealLog): number | null {
  if (typeof m.protein === "number") return m.protein;
  const r = m.analysisJson?.estimated_ranges;
  return r ? (r.protein_g_min + r.protein_g_max) / 2 : null;
}
// Food names read better mid-sentence with small joining words lowercased.
export function inSentence(label: string): string {
  return label.replace(/\b(And|Or|With|Of|In|On)\b/g, (w) => w.toLowerCase());
}
const TYPE_TITLE: Record<FeelingTag, string> = {
  fried_greasy: "Fried Or Greasy Food",
  high_sugar: "Sugary Food",
  refined_carbs: "Refined Carbs",
  heavy_large: "Large, Heavy Meals",
  alcohol: "Alcohol",
  caffeine: "Caffeine",
  highly_processed: "Highly Processed Food",
  low_protein: "Low-Protein Meals",
  dairy_heavy: "Dairy-Heavy Food",
  very_spicy: "Very Spicy Food",
  vegetable_forward: "Vegetables Or Greens",
  lean_protein: "Lean Protein",
  whole_food: "Whole Foods",
  complex_carbs: "Whole-Grain Carbs",
  light_fresh: "Light, Fresh Meals",
  balanced_meal: "Balanced Meals",
};
const NEG = new Set<string>(NEGATIVE_FEELING_TAGS);
const POS = new Set<string>(POSITIVE_FEELING_TAGS);

// ── Day records ─────────────────────────────────────────────────────────────
export function buildDays(input: PatternsInput, spanDays: number): DayRecord[] {
  const today = midnight(input.now ?? Date.now());
  const start = addDays(today, -(spanDays - 1));
  const byKey = new Map<string, DayRecord>();
  const out: DayRecord[] = [];
  for (let i = 0; i < spanDays; i++) {
    const d = addDays(start, i);
    const rec: DayRecord = {
      key: keyOf(d), ts: d.getTime(), weekday: d.getDay(), reflected: false,
      energy: null, sleep: null, mood: null, stress: null, digestion: null, dips: null,
      meals: [], moved: false, moveMin: 0, waterMl: null,
    };
    byKey.set(rec.key, rec);
    out.push(rec);
  }
  for (const e of input.reflections) {
    if (!e || typeof e.date !== "string") continue;
    const r = byKey.get(e.date);
    if (!r) continue;
    r.reflected = true;
    const a = (e.answers ?? {}) as Record<string, unknown>;
    r.energy = answer(a, "energy");
    r.sleep = answer(a, "sleep");
    r.mood = answer(a, "mood");
    r.stress = answer(a, "stress");
    r.digestion = answer(a, "digestion");
    r.dips = Array.isArray(a.dips) ? (a.dips as unknown[]).filter((x): x is number => typeof x === "number" && x >= 0 && x <= 3) : null;
  }
  for (const m of input.meals) {
    if (!m || !Number.isFinite(m.ts) || !isRealMeal(m)) continue;
    const name = mealName(m);
    const r = byKey.get(keyOf(new Date(m.ts)));
    if (!r || !name) continue;
    r.meals.push({ name, tags: sanitizeFeelingTags(m.analysisJson?.feeling_tags), hour: new Date(m.ts).getHours(), protein: mealProtein(m) });
  }
  for (const w of input.workouts) {
    if (typeof w?.startTs !== "number" || !Number.isFinite(w.startTs)) continue;
    const r = byKey.get(keyOf(new Date(w.startTs)));
    if (!r) continue;
    r.moved = true;
    r.moveMin += w.durationMin ?? (w.endTs ? Math.round((w.endTs - w.startTs) / 60000) : 0);
  }
  for (const [k, ml] of Object.entries(input.waterLogs ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || typeof ml !== "number" || ml <= 0) continue; // skips the "goal" key
    const r = byKey.get(k);
    if (r) r.waterMl = ml;
  }
  return out;
}

// ── Outcomes ────────────────────────────────────────────────────────────────
const GOOD: Record<Metric, (v: number) => boolean> = { energy: (v) => v >= 3, digestion: (v) => v >= 2, sleep: (v) => v >= 2 };
const LOW: Record<Metric, (v: number) => boolean> = { energy: (v) => v <= 1, digestion: (v) => v === 0, sleep: (v) => v === 0 };
const GOOD_WORDS: Record<Metric, string> = { energy: "Good or Great energy", digestion: "Good or Great digestion", sleep: "Good or Great sleep" };
const LOW_WORDS: Record<Metric, string> = { energy: "Drained or Low energy", digestion: "Poor digestion", sleep: "Poor sleep" };
const METRIC_TITLE: Record<Metric, string> = { energy: "Energy", digestion: "Digestion", sleep: "Sleep" };

function metricValue(d: DayRecord, m: Metric): number | null { return d[m]; }

// Two-proportion z score. Many foods get compared, so a plain rate gap lets chance through; this
// asks whether the gap is bigger than the sample sizes would produce by luck.
function zScore(h1: number, n1: number, h2: number, n2: number): number {
  if (!n1 || !n2) return 0;
  const p = (h1 + h2) / (n1 + n2);
  if (p <= 0 || p >= 1) return 0;
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se ? (h1 / n1 - h2 / n2) / se : 0;
}
const Z_MIN = 1.96;      // sleep, movement, water, stress: a handful of comparisons
const Z_MIN_FOOD = 2.3;  // foods: dozens of comparisons, so a stricter bar

function splitDays(n: number, cond: (i: number) => boolean | null, outcome: (i: number) => boolean | null): Split {
  const s: Split = { withHits: 0, withN: 0, withoutHits: 0, withoutN: 0 };
  for (let i = 0; i < n; i++) {
    const c = cond(i);
    const o = outcome(i);
    if (c == null || o == null) continue;
    if (c) { s.withN++; if (o) s.withHits++; } else { s.withoutN++; if (o) s.withoutHits++; }
  }
  return s;
}

// ── Water helpers ───────────────────────────────────────────────────────────
function waterText(ml: number, unit: "ml" | "oz"): string {
  if (unit === "oz") return `${Math.round(ml / 29.5735)} oz`;
  return `${(ml / 1000).toFixed(1)} L`;
}
function waterThreshold(days: DayRecord[]): number | null {
  const vals = days.map((d) => d.waterMl).filter((v): v is number => v != null).sort((a, b) => a - b);
  if (vals.length < 8) return null;
  const median = vals[Math.floor(vals.length / 2)];
  return Math.round(median / 100) * 100; // a round, readable cut (1.8 L, not 1.83 L)
}

// ── Foods ───────────────────────────────────────────────────────────────────
interface FoodItem { id: string; label: string; kind: "food" | "type"; tag?: FeelingTag }

function itemsOf(meals: DayMeal[]): FoodItem[] {
  const seen = new Set<string>();
  const out: FoodItem[] = [];
  for (const m of meals) {
    const fid = "f:" + m.name;
    if (!seen.has(fid)) { seen.add(fid); out.push({ id: fid, label: m.name, kind: "food" }); }
    for (const t of m.tags) {
      const tid = "t:" + t;
      if (!seen.has(tid)) { seen.add(tid); out.push({ id: tid, label: TYPE_TITLE[t], kind: "type", tag: t }); }
    }
  }
  return out;
}
function dayItems(d: DayRecord): FoodItem[] { return itemsOf(d.meals); }
const EVENING_HOUR = 17;
function eveningMeals(d: DayRecord): DayMeal[] { return d.meals.filter((m) => m.hour >= EVENING_HOUR); }
function itemNeed(kind: "food" | "type") { return kind === "food" ? FOOD_MIN_DAYS : TYPE_MIN_DAYS; }

interface Tally { eligible: number; good: number; low: number; items: Map<string, { item: FoodItem; levels: Level[]; keys: string[]; good: number; low: number }> }

// Same day: foods logged on day D against D's reflection. Night before (lag): foods from D-1's
// evening meals against D's reflection, the "chips at night, rough morning" case.
function tallyFoods(days: DayRecord[], metric: "energy" | "digestion", lag: boolean): Tally {
  const t: Tally = { eligible: 0, good: 0, low: 0, items: new Map() };
  for (let i = lag ? 1 : 0; i < days.length; i++) {
    const v = metricValue(days[i], metric);
    if (v == null) continue;
    const src = lag ? eveningMeals(days[i - 1]) : days[i].meals;
    if (!src.length) continue; // only days with meal data, so "without" is meaningful
    t.eligible++;
    const isGood = GOOD[metric](v), isLow = LOW[metric](v);
    if (isGood) t.good++;
    if (isLow) t.low++;
    for (const it of itemsOf(src)) {
      const cur = t.items.get(it.id) ?? { item: it, levels: [], keys: [], good: 0, low: 0 };
      cur.levels.push(levelFor(metric, v));
      cur.keys.push(days[i].key);
      if (isGood) cur.good++;
      if (isLow) cur.low++;
      t.items.set(it.id, cur);
    }
  }
  return t;
}

function computeFoodLinks(days: DayRecord[], metric: "energy" | "digestion"): FoodLinks {
  const same = tallyFoods(days, metric, false);
  const out: FoodLinks = {
    metric, status: "building", eligible: same.eligible, need: FOODS_MIN_DAYS,
    baseGood: same.good, baseLow: same.low, good: [], low: [], watching: [], neutral: [], all: {},
    goodWords: GOOD_WORDS[metric], lowWords: LOW_WORDS[metric],
  };

  const shown = new Set<string>();
  if (same.eligible >= FOODS_MIN_DAYS) {
    type Ranked = FoodRow & { rank: number; side: "good" | "low"; sig: string };
    const ranked: Ranked[] = [];
    for (const lag of [false, true]) {
      const t = lag ? tallyFoods(days, metric, true) : same;
      if (t.eligible < FOODS_MIN_DAYS) continue;
      const goodRate = t.good / t.eligible, lowRate = t.low / t.eligible;
      for (const { item, levels, keys, good, low } of t.items.values()) {
        const sig = (lag ? "L" : "S") + keys.join(",");
        const n = levels.length;
        if (n < itemNeed(item.kind)) continue;
        // Compare against days WITHOUT this food, so a food eaten most days can't ride the base rate.
        const restN = t.eligible - n;
        if (restN < 4) continue;
        const gr = good / n, lr = low / n;
        const restGood = (t.good - good) / restN, restLow = (t.low - low) / restN;
        const dots = levels.slice(-12);
        // A food type that tends to support how people feel is never put on the rough side, and
        // vice versa (the rule from lib/foodFeeling.ts), so thin data can't shame a vegetable.
        const canGood = item.kind === "food" || POS.has(item.tag!);
        const canLow = item.kind === "food" || NEG.has(item.tag!);
        if (canGood && gr >= 0.5 && gr - restGood >= 0.25 && gr - goodRate >= 0.15 && zScore(good, n, t.good - good, restN) >= Z_MIN_FOOD) {
          ranked.push({ id: item.id, label: item.label, kind: item.kind, n, hits: good, dots, lag, rank: (gr - restGood) * Math.sqrt(n), side: "good", sig });
        } else if (canLow && lr >= 0.4 && lr - restLow >= 0.25 && lr - lowRate >= 0.15 && zScore(low, n, t.low - low, restN) >= Z_MIN_FOOD) {
          ranked.push({ id: item.id, label: item.label, kind: item.kind, n, hits: low, dots, lag, rank: (lr - restLow) * Math.sqrt(n), side: "low", sig });
        }
      }
    }
    // One row per food: its strongest reading (same day or night before) wins.
    // A food type that lands on exactly the same days as one food (Caffeine = every Latte) is the
    // same evidence twice; keep the food, which is the more specific of the two.
    ranked.sort((a, b) => b.rank - a.rank || (a.kind === "food" ? -1 : 1));
    const sigs = new Set<string>();
    for (const r of ranked) {
      if (shown.has(r.id) || sigs.has(r.sig)) continue;
      sigs.add(r.sig);
      const list = r.side === "good" ? out.good : out.low;
      if (list.length >= 3) continue;
      shown.add(r.id);
      const { rank: _rank, side: _side, sig: _sig, ...row } = r;
      list.push(row);
    }
    out.status = out.good.length + out.low.length > 0 ? "ready" : "none";
  }

  for (const [id, x] of same.items) out.all[id] = { label: x.item.label, n: x.levels.length, good: x.good, low: x.low };

  // Watching: everything logged so far that hasn't got enough days to be compared yet, each
  // counting toward what it needs. Shown from the first night so the card is never empty.
  const all = [...same.items.values()].filter((x) => !shown.has(x.item.id));
  out.watching = all
    .filter((x) => x.levels.length < itemNeed(x.item.kind))
    .sort((a, b) => b.levels.length / itemNeed(b.item.kind) - a.levels.length / itemNeed(a.item.kind) || (a.item.kind === b.item.kind ? 0 : a.item.kind === "food" ? -1 : 1) || a.item.label.localeCompare(b.item.label))
    .slice(0, 5)
    .map((x) => ({ id: x.item.id, label: x.item.label, kind: x.item.kind, have: x.levels.length, need: itemNeed(x.item.kind) }));
  out.neutral = same.eligible >= FOODS_MIN_DAYS
    ? all.filter((x) => x.levels.length >= itemNeed(x.item.kind) && x.item.kind === "food")
        .sort((a, b) => b.levels.length - a.levels.length).slice(0, 4).map((x) => x.item.label)
    : [];
  return out;
}

// ── Candidate patterns (the hero) ───────────────────────────────────────────
interface Spec {
  id: string;
  kind: PatternFinding["kind"];
  metric: Metric;
  outcome: (v: number) => boolean;
  outcomeLabel: string;
  cond: (i: number) => boolean | null;
  headline: string;   // frequency-free ("line up with")
  often?: string;     // used instead when the rate with the condition is at least 60%
  withLabel: string;
  withoutLabel: string;
  condShort: string;
  lagged?: boolean;
  overlayId?: string | null;
  rowKey?: string;
  minDiff?: number;
}

function evaluate(days: DayRecord[], spec: Spec, focus: string[]): PatternFinding | null {
  const outcome = (i: number) => { const v = metricValue(days[i], spec.metric); return v == null ? null : spec.outcome(v); };
  const s = splitDays(days.length, spec.cond, outcome);
  // A food headline in the hero needs a little more than a list row: 6 days with the food.
  if (s.withN < (spec.kind === "food" ? 6 : 4) || s.withoutN < 4) return null;
  const rw = s.withHits / s.withN, ro = s.withoutHits / s.withoutN;
  const diff = rw - ro;
  const z = zScore(s.withHits, s.withN, s.withoutHits, s.withoutN);
  if (rw < 0.4 || diff < (spec.minDiff ?? 0.25) || z < (spec.kind === "food" ? Z_MIN_FOOD : Z_MIN)) return null;
  // Personalise the output, never the input: a pattern about what the user said they want to
  // feel better about leads when it is close, but a clearly stronger one still wins.
  const rank = focus.indexOf(spec.metric);
  const weight = rank === 0 ? 1.25 : rank > 0 ? 1.1 : 1;
  const strip: StripCell[] = [];
  for (let i = Math.max(0, days.length - STRIP_DAYS); i < days.length; i++) {
    const v = metricValue(days[i], spec.metric);
    strip.push({ key: days[i].key, dayLabel: WEEKDAY_SHORT[days[i].weekday], cond: spec.cond(i), level: v == null ? null : levelFor(spec.metric, v) });
  }
  return {
    id: spec.id, kind: spec.kind, metric: spec.metric, headline: rw >= 0.6 && spec.often ? spec.often : spec.headline,
    withLabel: spec.withLabel, withoutLabel: spec.withoutLabel, outcomeLabel: spec.outcomeLabel,
    condShort: spec.condShort, outcomeShort: METRIC_TITLE[spec.metric], lagged: !!spec.lagged,
    split: s, strip, score: z * weight, overlayId: spec.overlayId ?? null, rowKey: spec.rowKey ?? null,
  };
}

function capFirst(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function buildSpecs(days: DayRecord[], foods: { energy: FoodLinks; digestion: FoodLinks }, unit: "ml" | "oz"): Spec[] {
  const specs: Spec[] = [];
  const at = (i: number) => days[i];
  const good = (m: Metric) => GOOD[m];
  const low = (m: Metric) => LOW[m];

  specs.push({
    id: "sleep-energy", kind: "sleep", metric: "energy", outcome: good("energy"), outcomeLabel: GOOD_WORDS.energy,
    cond: (i) => (at(i).sleep == null ? null : at(i).sleep! >= 2),
    headline: "Your better-energy days line up with a good night's sleep.",
    often: "Your better-energy days often follow a good night's sleep.",
    withLabel: "After you slept well", withoutLabel: "After an okay or poor night", condShort: "Slept Well", overlayId: "sleep",
  });

  const workoutDays = days.filter((d) => d.moved).length;
  if (workoutDays >= 3) {
    specs.push({
      id: "move-energy", kind: "move", metric: "energy", outcome: good("energy"), outcomeLabel: GOOD_WORDS.energy,
      cond: (i) => at(i).moved,
      headline: "Days you moved line up with better energy.",
    often: "Days you moved often turned out to be better-energy days.",
      withLabel: "With a walk or workout", withoutLabel: "Days without one", condShort: "Moved", overlayId: "move",
    });
  }

  const cut = waterThreshold(days);
  if (cut != null) {
    const t = waterText(cut, unit);
    specs.push({
      id: "water-energy", kind: "water", metric: "energy", outcome: good("energy"), outcomeLabel: GOOD_WORDS.energy,
      cond: (i) => (at(i).waterMl == null ? null : at(i).waterMl! >= cut),
      headline: "Days with more water line up with better energy.",
      withLabel: `${t} or more of water`, withoutLabel: `Under ${t}`, condShort: `${t}+ Water`, overlayId: "water",
    });
  }

  specs.push({
    id: "stress-energy", kind: "stress", metric: "energy", outcome: low("energy"), outcomeLabel: LOW_WORDS.energy,
    cond: (i) => (at(i).stress == null ? null : at(i).stress === 3),
    headline: "High-stress days line up with lower energy.",
    often: "High-stress days often come with lower energy.",
    withLabel: "High-stress days", withoutLabel: "Other days", condShort: "High Stress",
  });

  // Today's stress against the NEXT night's sleep (tomorrow's reflection asks about last night),
  // so the order in time is right.
  specs.push({
    id: "stress-sleep", kind: "stress", metric: "sleep", outcome: (v) => v <= 1, outcomeLabel: "Okay or Poor sleep",
    cond: (i) => (i === 0 || at(i - 1).stress == null ? null : at(i - 1).stress === 3),
    headline: "A high-stress day lines up with a rougher night's sleep after it.",
    often: "A high-stress day often comes before a rougher night's sleep.",
    withLabel: "After a high-stress day", withoutLabel: "After other days", condShort: "Stress Day Before", lagged: true,
  });

  // Foods: the strongest row on each side becomes a candidate, counted the same way. Covers
  // energy and digestion, same day and night before (evening meals against the next day).
  for (const metric of ["energy", "digestion"] as const) {
    const fl = foods[metric];
    if (fl.status !== "ready") continue;
    const sides: [FoodRow | undefined, "good" | "low"][] = [[fl.good[0], "good"], [fl.low[0], "low"]];
    for (const [row, side] of sides) {
      if (!row) continue;
      const has = row.lag
        ? (i: number) => { if (i === 0) return null; const eve = eveningMeals(at(i - 1)); return eve.length ? itemsOf(eve).some((it) => it.id === row.id) : null; }
        : (i: number) => (at(i).meals.length === 0 ? null : dayItems(at(i)).some((it) => it.id === row.id));
      const phrase = row.kind === "type" ? FEELING_TAG_LABEL[row.id.slice(2) as FeelingTag] : inSentence(row.label).toLowerCase();
      const outcomeWord = metric === "energy" ? (side === "good" ? "better energy" : "lower energy") : side === "good" ? "easier digestion" : "rougher digestion";
      specs.push({
        id: `food-${metric}-${side}-${row.lag ? "lag" : "same"}-${row.id}`, kind: "food", metric,
        outcome: side === "good" ? good(metric) : low(metric),
        outcomeLabel: side === "good" ? GOOD_WORDS[metric] : LOW_WORDS[metric],
        cond: has,
        headline: row.lag
          ? `Evenings with ${phrase} line up with ${outcomeWord} the next day.`
          : `Days with ${phrase} line up with ${outcomeWord}.`,
        withLabel: row.lag ? `After ${phrase} in the evening` : `Days with ${phrase}`,
        withoutLabel: row.lag ? "After other evenings" : "Other days you logged meals",
        condShort: row.lag ? "Night Before" : row.label,
        lagged: row.lag,
        overlayId: metric === "energy" ? (row.lag ? `food:lag:${row.id}` : `food:${row.id}`) : null,
        rowKey: `${metric}:${row.id}:${row.lag ? 1 : 0}`,
        minDiff: 0.3,
      });
    }
  }
  return specs;
}

// ── Better days vs slower days ──────────────────────────────────────────────
function share(group: DayRecord[], test: (d: DayRecord) => boolean | null): { hits: number; n: number } {
  let hits = 0, n = 0;
  for (const d of group) { const t = test(d); if (t == null) continue; n++; if (t) hits++; }
  return { hits, n };
}
function avg(group: DayRecord[], pick: (d: DayRecord) => number | null): { mean: number; n: number; v: number } {
  const vals = group.map(pick).filter((x): x is number => x != null);
  const n = vals.length;
  const mean = n ? vals.reduce((a, b) => a + b, 0) / n : 0;
  const v = n > 1 ? vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, n, v };
}
// Small groups swing a lot, so a row only counts as different when the gap clears a light bar
// (z for shares, Welch t for averages). Anything under it is listed as "about the same".
const ROW_MIN_STAT = 1.96;

const SAME_LABEL: Record<Exclude<CompareId, "type">, string> = {
  sleep: "Sleep", move: "Movement", water: "Water", stress: "Stress", meals: "Meals Logged", protein: "Protein",
};
const PHRASE: Record<Exclude<CompareId, "type">, [string, string]> = {
  sleep: ["more often followed a good night's sleep", "less often followed a good night's sleep"],
  move: ["more often had a walk or workout", "less often had a walk or workout"],
  water: ["had more water", "had less water"],
  stress: ["had high stress more often", "had high stress less often"],
  meals: ["had more meals logged", "had fewer meals logged"],
  protein: ["had more protein", "had less protein"],
};

function computeBetterSlower(days: DayRecord[], unit: "ml" | "oz", workoutsInWindow: number, foodsShown: Set<string>, metric: Lens): BetterSlower {
  const val = (d: DayRecord) => metricValue(d, metric)!;
  const rated = days.filter((d) => metricValue(d, metric) != null);
  const out: BetterSlower = {
    metric, status: "building", mode: "bands", nights: rated.length, need: COMPARE_MIN_NIGHTS, betterN: 0, slowerN: 0,
    betterDef: GOOD_WORDS[metric], slowerDef: LOW_WORDS[metric], rows: [], same: [], summary: null,
  };
  if (rated.length < COMPARE_MIN_NIGHTS) return out;
  let better = rated.filter((d) => GOOD[metric](val(d)));
  let slower = rated.filter((d) => LOW[metric](val(d)));
  if (better.length < 3 || slower.length < 3) {
    // Steady users rarely hit the extremes: compare their own top and bottom thirds instead,
    // but only when those are genuinely apart (same guard as lib/dayCompare.ts).
    const sorted = [...rated].sort((a, b) => val(b) - val(a) || b.ts - a.ts);
    const k = Math.max(3, Math.floor(sorted.length / 3));
    if (sorted.length < 2 * k) return { ...out, status: "steady" };
    better = sorted.slice(0, k);
    slower = sorted.slice(sorted.length - k);
    const mean = (g: DayRecord[]) => g.reduce((s, d) => s + val(d), 0) / g.length;
    if (mean(better) - mean(slower) < (metric === "energy" ? 0.75 : 0.6)) return { ...out, status: "steady" };
    out.mode = "thirds";
    out.betterDef = `Your top third by ${metric}`;
    out.slowerDef = `Your bottom third by ${metric}`;
  }
  out.status = "ready";
  out.betterN = better.length;
  out.slowerN = slower.length;

  const rows: (CompareRow & { phrase: string })[] = [];
  const same: string[] = [];
  const pushShare = (id: Exclude<CompareId, "type">, label: string, test: (d: DayRecord) => boolean | null) => {
    const b = share(better, test), s = share(slower, test);
    if (b.n < 3 || s.n < 3) return;
    const br = b.hits / b.n, sr = s.hits / s.n;
    const effect = Math.abs(br - sr);
    if (effect < 0.2 || Math.abs(zScore(b.hits, b.n, s.hits, s.n)) < ROW_MIN_STAT) { same.push(SAME_LABEL[id]); return; }
    rows.push({ id, icon: id, label, better: br, slower: sr, betterText: `${b.hits} of ${b.n}`, slowerText: `${s.hits} of ${s.n}`, scaleMax: 1, effect, phrase: PHRASE[id][br > sr ? 0 : 1] });
  };
  const pushAvg = (id: Exclude<CompareId, "type">, label: string, pick: (d: DayRecord) => number | null, fmt: (v: number) => string) => {
    const b = avg(better, pick), s = avg(slower, pick);
    if (b.n < 3 || s.n < 3) return;
    const top = Math.max(b.mean, s.mean);
    if (top <= 0) return;
    const effect = Math.abs(b.mean - s.mean) / top;
    const se = Math.sqrt(b.v / b.n + s.v / s.n);
    const t = se > 0 ? Math.abs(b.mean - s.mean) / se : Infinity;
    if (effect < 0.15 || t < ROW_MIN_STAT) { same.push(SAME_LABEL[id]); return; }
    rows.push({ id, icon: id, label, better: b.mean, slower: s.mean, betterText: fmt(b.mean), slowerText: fmt(s.mean), scaleMax: top * 1.12, effect, phrase: PHRASE[id][b.mean > s.mean ? 0 : 1] });
  };

  pushShare("sleep", "Slept Well The Night Before", (d) => (d.sleep == null ? null : d.sleep >= 2));
  if (workoutsInWindow >= 3) pushShare("move", "A Walk Or Workout", (d) => d.moved);
  pushAvg("water", "Water", (d) => d.waterMl, (v) => waterText(v, unit));
  pushShare("stress", "High Stress", (d) => (d.stress == null ? null : d.stress === 3));
  pushAvg("meals", "Meals Logged", (d) => (d.meals.length ? d.meals.length : null), (v) => v.toFixed(1));
  pushAvg("protein", "Protein Logged", (d) => {
    if (d.meals.length < 2) return null;
    const ps = d.meals.map((m) => m.protein).filter((p): p is number => p != null);
    return ps.length ? ps.reduce((a, b) => a + b, 0) : null;
  }, (v) => `${Math.round(v)} g`);

  // Meal types (the tags added to every logged meal). Up to two, only in the honest direction:
  // a type that tends to drag energy down only when it shows up more on slower days, and the
  // reverse for supportive types. Types already shown in Foods And Your Days are left out.
  const withMeals = (g: DayRecord[]) => g.filter((d) => d.meals.length > 0);
  const bm = withMeals(better), sm = withMeals(slower);
  if (bm.length >= 4 && sm.length >= 4) {
    const typeRows: (CompareRow & { phrase: string })[] = [];
    for (const tag of [...NEGATIVE_FEELING_TAGS, ...POSITIVE_FEELING_TAGS] as FeelingTag[]) {
      if (foodsShown.has("t:" + tag)) continue;
      const has = (d: DayRecord) => d.meals.some((m) => m.tags.includes(tag));
      const bh = bm.filter(has).length, sh = sm.filter(has).length;
      const br = bh / bm.length, sr = sh / sm.length;
      const neg = NEG.has(tag);
      const effect = neg ? sr - br : br - sr;
      if (effect < 0.25 || (neg ? sh : bh) < 3) continue;
      if (Math.abs(zScore(bh, bm.length, sh, sm.length)) < Z_MIN_FOOD) continue; // many types compared
      typeRows.push({
        id: "type:" + tag, icon: "type", label: TYPE_TITLE[tag], better: br, slower: sr,
        betterText: `${bh} of ${bm.length}`, slowerText: `${sh} of ${sm.length}`, scaleMax: 1, effect,
        phrase: `${neg ? "less" : "more"} often had ${FEELING_TAG_LABEL[tag]}`,
      });
    }
    typeRows.sort((a, b) => b.effect - a.effect);
    rows.push(...typeRows.slice(0, 2));
  }

  rows.sort((a, b) => b.effect - a.effect);
  out.rows = rows.map(({ phrase: _p, ...r }) => r);
  out.same = same;
  if (rows.length) out.summary = `${metric === "energy" ? "Your better days" : "Your easier digestion days"} ${rows.slice(0, 2).map((r) => r.phrase).join(" and ")}.`;
  return out;
}

// ── Week-by-week grid ───────────────────────────────────────────────────────
function computeGrid(allDays: DayRecord[], windowDays: DayRecord[], foods: FoodLinks, unit: "ml" | "oz", now: number): WeekGrid {
  const today = midnight(now);
  const todayKey = keyOf(today);
  const firstData = allDays.find((d) => d.reflected || d.meals.length > 0);
  // Monday-start weeks, from the week of the first log (up to 8 weeks back) to this week.
  const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
  const thisMonday = mondayOf(today);
  const earliestMonday = addDays(thisMonday, -7 * (GRID_WEEKS - 1));
  let startMonday = firstData ? mondayOf(parseKey(firstData.key)) : thisMonday;
  if (startMonday < earliestMonday) startMonday = earliestMonday;
  const byKey = new Map(allDays.map((d) => [d.key, d]));
  const firstKey = firstData?.key ?? todayKey;

  const weeks: GridWeek[] = [];
  for (let w = startMonday; w <= thisMonday; w = addDays(w, 7)) {
    const cells: GridCell[] = [];
    let good = 0, rated = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(w, i);
      const key = keyOf(d);
      const rec = byKey.get(key);
      const level = rec && rec.energy != null ? levelFor("energy", rec.energy) : null;
      if (level) { rated++; if (level === "good") good++; }
      cells.push({ key, day: d.getDate(), level, reflected: !!rec?.reflected, future: d > today, before: key < firstKey, isToday: key === todayKey });
    }
    weeks.push({ key: keyOf(w), label: shortDate(keyOf(w)), cells, good, rated });
  }

  // Overlays: let the user lay a condition over the grid and see for themselves how it lines up.
  const overlays: Overlay[] = [];
  const summarise = (daysWith: DayRecord[], what: string, side: "good" | "low") => {
    const rated2 = daysWith.filter((d) => d.energy != null);
    const hits = rated2.filter((d) => (side === "good" ? d.energy! >= 3 : d.energy! <= 1)).length;
    return `${what} on ${plural(daysWith.length, "day")}. ${hits} of the ${rated2.length} you rated were ${side === "good" ? GOOD_WORDS.energy : LOW_WORDS.energy} days.`;
  };
  const sleptWell = windowDays.filter((d) => d.sleep != null && d.sleep >= 2);
  if (sleptWell.length >= 3) overlays.push({ id: "sleep", label: "Slept Well", days: sleptWell.map((d) => d.key), summary: summarise(sleptWell, "You slept well", "good") });
  const moved = windowDays.filter((d) => d.moved);
  if (moved.length >= 3) overlays.push({ id: "move", label: "Moved", days: moved.map((d) => d.key), summary: summarise(moved, "You moved", "good") });
  const cut = waterThreshold(windowDays);
  if (cut != null) {
    const t = waterText(cut, unit);
    const wet = windowDays.filter((d) => d.waterMl != null && d.waterMl >= cut);
    overlays.push({ id: "water", label: `${t}+ Water`, days: wet.map((d) => d.key), summary: summarise(wet, `You logged ${t} or more of water`, "good") });
  }
  const foodRows: [FoodRow, "good" | "low"][] = [
    ...foods.good.slice(0, 1).map((r) => [r, "good"] as [FoodRow, "good"]),
    ...foods.low.slice(0, 2).map((r) => [r, "low"] as [FoodRow, "low"]),
  ];
  for (const [row, side] of foodRows) {
    const name = row.kind === "type" ? FEELING_TAG_LABEL[row.id.slice(2) as FeelingTag] : inSentence(row.label).toLowerCase();
    if (row.lag) {
      // Night-before foods mark the MORNING AFTER, so the mark sits on the day it lines up with.
      const after = windowDays.filter((d, i) => i > 0 && itemsOf(eveningMeals(windowDays[i - 1])).some((it) => it.id === row.id));
      overlays.push({ id: `food:lag:${row.id}`, label: `After ${row.label}`, days: after.map((d) => d.key), summary: summarise(after, `The day after an evening with ${name}`, side).replace(/^The day after an evening with (.+?) on (\d+) days?\./, (_m, f, n) => `${n} ${n === "1" ? "day came" : "days came"} after an evening with ${f}.`) });
    } else {
      const withIt = windowDays.filter((d) => dayItems(d).some((it) => it.id === row.id));
      overlays.push({ id: `food:${row.id}`, label: row.label, days: withIt.map((d) => d.key), summary: summarise(withIt, capFirst(name), side) });
    }
  }

  // Weekday rhythm across every day in the grid.
  const counts = Array.from({ length: 7 }, () => ({ n: 0, good: 0, low: 0 }));
  for (const d of allDays) {
    if (d.energy == null) continue;
    const c = counts[d.weekday];
    c.n++;
    if (d.energy >= 3) c.good++;
    if (d.energy <= 1) c.low++;
  }
  const total = counts.reduce((s, c) => s + c.n, 0);
  const goodAll = counts.reduce((s, c) => s + c.good, 0) / Math.max(total, 1);
  const lowAll = counts.reduce((s, c) => s + c.low, 0) / Math.max(total, 1);
  let best: WeekdayRead | null = null, slowest: WeekdayRead | null = null;
  let bestLift = 0.25, slowLift = 0.25;
  counts.forEach((c, wd) => {
    if (c.n < WEEKDAY_MIN) return;
    const g = c.good / c.n - goodAll, l = c.low / c.n - lowAll;
    if (g >= bestLift) { bestLift = g; best = { weekday: WEEKDAY_PLURAL[wd], hits: c.good, n: c.n, words: GOOD_WORDS.energy }; }
    if (l >= slowLift) { slowLift = l; slowest = { weekday: WEEKDAY_PLURAL[wd], hits: c.low, n: c.n, words: LOW_WORDS.energy }; }
  });
  const weekdayRemaining = counts.reduce((s, c) => s + Math.max(0, WEEKDAY_MIN - c.n), 0);

  // What each day held, for tapping a square.
  const details: Record<string, DayDetail> = {};
  for (const d of allDays) {
    if (!d.reflected && !d.meals.length && !d.moved && d.waterMl == null) continue;
    const feel: DayDetail["feel"] = [];
    for (const m of REFLECTION_METRICS) {
      const v = d[m.key as "energy" | "sleep" | "mood" | "stress" | "digestion"];
      if (v == null || !m.opts[v]) continue;
      feel.push({ label: m.label, word: m.opts[v], level: levelFor(m.key, v) });
    }
    details[d.key] = {
      key: d.key,
      label: longDate(d.key),
      feel,
      movement: d.moved ? (d.moveMin ? `Moved ${d.moveMin} min` : "Moved") : null,
      water: d.waterMl != null ? `${waterText(d.waterMl, unit)} water` : null,
      foods: [...new Set(d.meals.map((m) => m.name))],
    };
  }
  return { weeks, details, overlays, best, slowest, weekdayRemaining, weekdayN: counts.map((c) => c.n) };
}

// ── Energy dips ─────────────────────────────────────────────────────────────
function dipCounts(days: DayRecord[]): DipCounts {
  const c: DipCounts = { morning: 0, afternoon: 0, evening: 0, nights: 0 };
  for (const d of days) {
    if (!d.dips) continue;
    c.nights++;
    if (d.dips.includes(1)) c.morning++;
    if (d.dips.includes(2)) c.afternoon++;
    if (d.dips.includes(3)) c.evening++;
  }
  return c;
}
function computeDips(allDays: DayRecord[]): DipRhythm {
  const n = allDays.length;
  const recentDays = allDays.slice(Math.max(0, n - 14));
  const priorDays = allDays.slice(Math.max(0, n - 28), Math.max(0, n - 14));
  const recent = dipCounts(recentDays);
  const prior = dipCounts(priorDays);
  const answered = recent.nights;
  if (recent.nights < DIPS_MIN_NIGHTS) return { recent: null, prior: null, peak: null, answered };
  const max = Math.max(recent.morning, recent.afternoon, recent.evening);
  const peak = max === 0 ? null : recent.afternoon === max ? "afternoon" : recent.morning === max ? "morning" : "evening";
  return { recent, prior: prior.nights >= 5 ? prior : null, peak, answered };
}

// ── Compared to last week ───────────────────────────────────────────────────
const WEEK_METRICS: { key: "energy" | "sleep" | "mood" | "stress" | "digestion"; label: string }[] = [
  { key: "energy", label: "Energy" },
  { key: "sleep", label: "Sleep" },
  { key: "mood", label: "Mood" },
  { key: "stress", label: "Stress" },
  { key: "digestion", label: "Digestion" },
];
const LEVEL_SCORE: Record<Level, number> = { good: 2, ok: 1, low: 0 };

function computeWeekCompare(allDays: DayRecord[], now: number, focus: string[]): WeekCompare {
  const n = allDays.length;
  const thisWeek = allDays.slice(Math.max(0, n - 7));
  const lastWeek = allDays.slice(Math.max(0, n - 14), Math.max(0, n - 7));
  const rows: MetricWeek[] = [];
  // What the user said they care about comes first.
  const ordered = [...WEEK_METRICS].sort((a, b) => {
    const ra = focus.indexOf(a.key), rb = focus.indexOf(b.key);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  });
  for (const m of ordered) {
    const tally = (g: DayRecord[]): LevelCounts => {
      const c: LevelCounts = { good: 0, ok: 0, low: 0, n: 0 };
      for (const d of g) { const v = d[m.key]; if (v == null) continue; c[levelFor(m.key, v)]++; c.n++; }
      return c;
    };
    const a = tally(thisWeek), b = tally(lastWeek);
    if (a.n < 2 || b.n < 2) continue;
    const score = (c: LevelCounts) => (c.good * LEVEL_SCORE.good + c.ok * LEVEL_SCORE.ok) / c.n;
    // Same threshold as lib/reflectionFacts.ts whatChanged, so this page and the coach agree.
    const sa = score(a), sb = score(b);
    rows.push({ key: m.key, label: m.label, dir: sa > sb + 0.34 ? "up" : sa < sb - 0.34 ? "down" : "same", thisWeek: a, lastWeek: b });
  }
  const thisN = thisWeek.filter((d) => d.reflected).length;
  const lastN = lastWeek.filter((d) => d.reflected).length;
  let readyOn: string | null = null;
  if (!rows.length) {
    // Last week fills as days roll over: it holds 2 nights once the second-oldest recent
    // reflection is 7 days old (assuming the user keeps reflecting each night).
    const recent = allDays.slice(Math.max(0, n - 14)).filter((d) => d.reflected);
    if (recent.length >= 2) {
      const when = addDays(parseKey(recent[1].key), 7);
      if (when.getTime() > midnight(now).getTime()) readyOn = keyOf(when);
    }
  }
  return { ready: rows.length > 0, rows, thisN, lastN, readyOn };
}

// ── Totals ──────────────────────────────────────────────────────────────────
function computeTotals(input: PatternsInput, now: number): PatternsTotals {
  const meals = input.meals.filter((m) => m && Number.isFinite(m.ts) && isRealMeal(m));
  const reflections = input.reflections.filter((r) => r && typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  const counts = new Map<string, number>();
  let first = now;
  for (const m of meals) {
    const name = mealName(m);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    if (m.ts < first) first = m.ts;
  }
  for (const r of reflections) { const t = parseKey(r.date).getTime(); if (t < first) first = t; }
  let topFood: PatternsTotals["topFood"] = null;
  for (const [label, count] of counts) if (count >= 2 && (!topFood || count > topFood.count)) topFood = { label, count };
  const waterDays = Object.entries(input.waterLogs ?? {}).filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === "number" && v > 0).length;
  const spanDays = Math.max(1, Math.round((midnight(now).getTime() - midnight(first).getTime()) / DAY_MS) + 1);
  const todayKey = keyOf(midnight(now));
  return {
    nights: reflections.length, meals: meals.length, workouts: input.workouts.filter((w) => typeof w?.startTs === "number").length,
    waterDays, spanDays, topFood, reflectedToday: reflections.some((r) => r.date === todayKey),
  };
}

// ── When each countdown should land ─────────────────────────────────────────
// Assumes a Nightly Reflection every night from tonight (or tomorrow, if tonight's is done).
// It's an estimate and the copy says "around".
const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function nightOffset(nightsNeeded: number, reflectedToday: boolean): number {
  return reflectedToday ? nightsNeeded : nightsNeeded - 1;
}
export function etaPhrase(offsetDays: number, now: number): string {
  if (offsetDays <= 0) return "tonight";
  if (offsetDays === 1) return "tomorrow night";
  const d = addDays(midnight(now), offsetDays);
  return offsetDays <= 6 ? `around ${WEEKDAY_FULL[d.getDay()]}` : `around ${longDate(keyOf(d))}`;
}
function weekdayOffset(counts: number[], reflectedToday: boolean, now: number): number {
  const c = [...counts];
  const today = midnight(now);
  for (let off = reflectedToday ? 1 : 0; off < 120; off++) {
    if (c.every((x) => x >= WEEKDAY_MIN)) return Math.max(0, off - 1);
    c[addDays(today, off).getDay()]++;
  }
  return 120;
}

// ── Model ───────────────────────────────────────────────────────────────────
// Onboarding's feeling goals (profiles.feeling_goals) mapped onto what the Nightly Reflection
// asks about, in the order the user picked them.
const GOAL_METRIC: Record<string, string | null> = { energy: "energy", digestion: "digestion", sleep: "sleep", mood: "mood", focus: "energy", cravings: null };

export function computePatternsModel(input: PatternsInput): PatternsModel {
  const now = input.now ?? Date.now();
  const unit = input.waterUnit ?? "ml";
  const focus: string[] = [];
  for (const g of input.feelingGoals ?? []) { const m = GOAL_METRIC[g]; if (m && !focus.includes(m)) focus.push(m); }
  const lenses: Lens[] = focus.indexOf("digestion") >= 0 && (focus.indexOf("energy") < 0 || focus.indexOf("digestion") < focus.indexOf("energy")) ? ["digestion", "energy"] : ["energy", "digestion"];

  const allDays = buildDays(input, GRID_WEEKS * 7);
  const days = allDays.slice(allDays.length - WINDOW_DAYS);
  const nightsInWindow = days.filter((d) => d.energy != null).length;
  const workoutsInWindow = days.filter((d) => d.moved).length;
  const totals = computeTotals(input, now);
  const coverage = {
    mealDays: days.filter((d) => d.meals.length > 0).length,
    nights: days.filter((d) => d.reflected).length,
    both: days.filter((d) => d.meals.length > 0 && d.reflected).length,
  };

  const foods = { energy: computeFoodLinks(days, "energy"), digestion: computeFoodLinks(days, "digestion") };

  let findings: PatternFinding[] = [];
  if (nightsInWindow >= HERO_MIN_NIGHTS) {
    findings = buildSpecs(days, foods, unit)
      .map((s) => evaluate(days, s, focus))
      .filter((f): f is PatternFinding => f != null)
      .sort((a, b) => b.score - a.score);
  }
  const heroStatus: PatternsModel["heroStatus"] = nightsInWindow < HERO_MIN_NIGHTS ? "building" : findings.length ? "ready" : "none";

  const shown = (fl: FoodLinks) => new Set([...fl.good, ...fl.low].map((r) => r.id));
  const betterSlower = {
    energy: computeBetterSlower(days, unit, workoutsInWindow, shown(foods.energy), "energy"),
    digestion: computeBetterSlower(days, unit, workoutsInWindow, shown(foods.digestion), "digestion"),
  };
  const grid = computeGrid(allDays, days, foods.energy, unit, now);
  const dips = computeDips(allDays);
  const weekCompare = computeWeekCompare(allDays, now, focus);

  const unlocks: UnlockItem[] = [];
  const rt = totals.reflectedToday;
  const nights = (k: number) => `${plural(k, "more Nightly Reflection")}, ${etaPhrase(nightOffset(k, rt), now)}`;
  if (heroStatus === "building") {
    unlocks.push({ id: "hero", title: "Your Clearest Pattern", detail: nights(HERO_MIN_NIGHTS - nightsInWindow), have: nightsInWindow, need: HERO_MIN_NIGHTS });
  }
  if (foods.energy.status === "building") {
    const k = FOODS_MIN_DAYS - foods.energy.eligible;
    unlocks.push({ id: "foods", title: "Your First Food And Feeling Read", detail: `${plural(k, "more day", "more days")} with meals and a Nightly Reflection, ${etaPhrase(nightOffset(k, rt), now)}`, have: foods.energy.eligible, need: FOODS_MIN_DAYS });
  }
  const bs = betterSlower[lenses[0]];
  if (bs.status === "building") {
    unlocks.push({ id: "compare", title: "Your Better Days Vs Your Slower Days", detail: nights(COMPARE_MIN_NIGHTS - bs.nights), have: bs.nights, need: COMPARE_MIN_NIGHTS });
  }
  if (!dips.recent) {
    unlocks.push({ id: "dips", title: "When Your Energy Dips", detail: nights(DIPS_MIN_NIGHTS - dips.answered), have: dips.answered, need: DIPS_MIN_NIGHTS });
  }
  if (!weekCompare.ready) {
    const have = Math.min(2, weekCompare.thisN) + Math.min(2, weekCompare.lastN);
    let off = Math.max(0, nightOffset(2 - Math.min(2, totals.nights), rt)) + 7;
    if (weekCompare.readyOn) off = Math.round((parseKey(weekCompare.readyOn).getTime() - midnight(now).getTime()) / DAY_MS);
    const detail = `Ready ${etaPhrase(off, now)}, with 2 Nightly Reflections in each of two weeks`;
    unlocks.push({ id: "week", title: "Compared To Last Week", detail, have, need: 4 });
  }
  if (!grid.best && !grid.slowest && grid.weekdayRemaining > 0) {
    const need = WEEKDAY_MIN * 7;
    unlocks.push({
      id: "weekday", title: "Your Weekday Rhythm",
      detail: `${plural(grid.weekdayRemaining, "more Nightly Reflection")}, ${WEEKDAY_MIN} of each weekday, ${etaPhrase(weekdayOffset(grid.weekdayN, rt, now), now)}`,
      have: need - grid.weekdayRemaining, need,
    });
  }

  return { totals, nightsInWindow, heroStatus, findings, betterSlower, foods, lenses, coverage, grid, dips, weekCompare, unlocks };
}
