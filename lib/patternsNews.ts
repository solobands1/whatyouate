// "New Since You Last Looked" and the one-time "Your First Pattern Is Here" moment.
//
// At the end of each visit the screen stores a small snapshot of the page (localStorage, per
// user). On the next visit, today's model is compared with that snapshot and only real changes
// are listed: a food that started lining up, the clearest pattern holding or shifting, a new
// weekday rhythm, this week moving against last week. Pure functions, no storage here; every
// item carries its counts and none of them suggests what to do.

import { HERO_MIN_NIGHTS, longDate, keyOf, type Lens, type PatternsModel } from "./patterns";

export interface SnapshotRow { key: string; id: string; label: string; metric: Lens; side: "good" | "low"; lag: boolean; hits: number; n: number }
export interface PatternsSnapshot {
  v: 1;
  ts: number;
  day: string;                      // YYYY-MM-DD of the visit
  nights: number;
  heroStatus: PatternsModel["heroStatus"];
  hero: { id: string; headline: string; withHits: number; withN: number; withoutHits: number; withoutN: number } | null;
  rows: SnapshotRow[];              // foods lining up, both lenses
  watching: string[];               // food ids on a Watching list
  best: string | null;              // weekday rhythm, e.g. "Fridays"
  slowest: string | null;
  week: Record<string, "up" | "down" | "same">;
}

export interface NewsItem { id: string; kind: "food" | "pattern" | "weekday" | "week"; title: string; tag: string; detail: string; quiet?: boolean }
export interface PatternsNews { since: string | null; newNights: number; items: NewsItem[] }

function rowsOf(model: PatternsModel): SnapshotRow[] {
  const out: SnapshotRow[] = [];
  for (const metric of ["energy", "digestion"] as const) {
    const fl = model.foods[metric];
    for (const side of ["good", "low"] as const) {
      for (const r of fl[side]) out.push({ key: `${metric}:${r.id}:${r.lag ? 1 : 0}`, id: r.id, label: r.label, metric, side, lag: r.lag, hits: r.hits, n: r.n });
    }
  }
  return out;
}

export function snapshotOf(model: PatternsModel, now = Date.now()): PatternsSnapshot {
  const h = model.heroStatus === "ready" ? model.findings[0] : null;
  const week: Record<string, "up" | "down" | "same"> = {};
  for (const r of model.weekCompare.rows) week[r.key] = r.dir;
  return {
    v: 1,
    ts: now,
    day: keyOf(new Date(now)),
    nights: model.totals.nights,
    heroStatus: model.heroStatus,
    hero: h ? { id: h.id, headline: h.headline, withHits: h.split.withHits, withN: h.split.withN, withoutHits: h.split.withoutHits, withoutN: h.split.withoutN } : null,
    rows: rowsOf(model),
    watching: [...new Set([...model.foods.energy.watching, ...model.foods.digestion.watching].map((w) => w.id))],
    best: model.grid.best?.weekday ?? null,
    slowest: model.grid.slowest?.weekday ?? null,
    week,
  };
}

export function parseSnapshot(raw: string | null): PatternsSnapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return s && s.v === 1 && Array.isArray(s.rows) && typeof s.day === "string" ? (s as PatternsSnapshot) : null;
  } catch {
    return null;
  }
}

const OUTCOME: Record<Lens, Record<"good" | "low", string>> = {
  energy: { good: "better energy", low: "lower energy" },
  digestion: { good: "easier digestion", low: "rougher digestion" },
};
const OUTCOME_WORDS: Record<Lens, Record<"good" | "low", string>> = {
  energy: { good: "Good or Great energy", low: "Drained or Low energy" },
  digestion: { good: "Good or Great digestion", low: "Poor digestion" },
};

// The first real connection ever shown to this user. Shown once (the screen records it). For a
// user with no earlier snapshot (first visit after this ships) it only counts as "first" when
// they are just past the threshold, so long-time users don't get a "first" that isn't.
export function isFirstPatternMoment(prev: PatternsSnapshot | null, model: PatternsModel, alreadyShown: boolean): boolean {
  if (alreadyShown || model.heroStatus !== "ready") return false;
  if (prev) return prev.heroStatus !== "ready";
  return model.nightsInWindow <= HERO_MIN_NIGHTS + 3;
}

export function newsSince(prev: PatternsSnapshot | null, model: PatternsModel, opts: { firstMoment?: boolean } = {}): PatternsNews {
  if (!prev) return { since: null, newNights: 0, items: [] };
  const items: NewsItem[] = [];
  const pct = (h: number, n: number) => (n ? h / n : 0);

  // 1. The clearest pattern.
  const h = model.heroStatus === "ready" ? model.findings[0] : null;
  if (h && !opts.firstMoment) {
    const s = h.split;
    if (prev.hero && prev.hero.id === h.id) {
      const gapNow = pct(s.withHits, s.withN) - pct(s.withoutHits, s.withoutN);
      const gapThen = pct(prev.hero.withHits, prev.hero.withN) - pct(prev.hero.withoutHits, prev.hero.withoutN);
      const moreDays = s.withN + s.withoutN > prev.hero.withN + prev.hero.withoutN;
      if (moreDays) {
        const tag = gapNow > gapThen + 0.05 ? "Got Clearer" : gapNow < gapThen - 0.05 ? "Less Clear" : "Held Up";
        items.push({
          id: "hero", kind: "pattern", title: "Your Clearest Pattern", tag, quiet: tag === "Less Clear",
          detail: `${s.withHits} of ${s.withN} days now, up from ${prev.hero.withHits} of ${prev.hero.withN}. Other days: ${s.withoutHits} of ${s.withoutN}.`,
        });
      }
    } else if (prev.hero) {
      items.push({ id: "hero", kind: "pattern", title: "Your Clearest Pattern", tag: "Something New Leads", detail: `${h.headline} ${s.withHits} of ${s.withN} days.` });
    }
  } else if (!h && prev.hero) {
    items.push({ id: "hero", kind: "pattern", title: "Your Clearest Pattern", tag: "No Longer Clear", quiet: true, detail: "With more days logged, the gap that stood out is now too small to call a pattern." });
  }

  // 2. Foods: newly lining up (and whether they came off the Watching list), or no longer.
  const nowRows = rowsOf(model);
  const prevKeys = new Set(prev.rows.map((r) => r.key));
  const prevWatching = new Set(prev.watching);
  for (const r of nowRows) {
    if (prevKeys.has(r.key)) continue;
    const when = r.lag ? " the next day" : "";
    items.push({
      id: "food:" + r.key, kind: "food", title: r.label,
      tag: prevWatching.has(r.id) ? "From Watching To Lining Up" : "Now Lining Up",
      detail: `${r.lag ? "Evenings with it line up" : "Lines up"} with ${OUTCOME[r.metric][r.side]}${when}: ${r.hits} of ${r.n} days had ${OUTCOME_WORDS[r.metric][r.side]}.`,
    });
  }
  const nowKeys = new Set(nowRows.map((r) => r.key));
  for (const r of prev.rows) {
    if (nowKeys.has(r.key) || r.lag) continue;
    const c = model.foods[r.metric].all[r.id];
    if (!c) continue;
    items.push({
      id: "gone:" + r.key, kind: "food", title: r.label, tag: "No Longer Stands Out", quiet: true,
      detail: `${c[r.side]} of ${c.n} days had ${OUTCOME_WORDS[r.metric][r.side]}, close to your other days now.`,
    });
  }

  // 3. Weekday rhythm.
  const g = model.grid;
  if (g.slowest && g.slowest.weekday !== prev.slowest) {
    items.push({ id: "weekday:slow", kind: "weekday", title: "Your Weekday Rhythm", tag: "New", detail: `${g.slowest.weekday} have been your slowest: ${g.slowest.words} on ${g.slowest.hits} of ${g.slowest.n}.` });
  }
  if (g.best && g.best.weekday !== prev.best) {
    items.push({ id: "weekday:best", kind: "weekday", title: "Your Weekday Rhythm", tag: "New", detail: `${g.best.weekday} have been your strongest: ${g.best.words} on ${g.best.hits} of ${g.best.n}.` });
  }

  // 4. This week against last week, where the verdict changed since the last visit.
  for (const r of model.weekCompare.rows) {
    if (r.dir === "same" || prev.week[r.key] === r.dir) continue;
    items.push({
      id: "week:" + r.key, kind: "week", title: `${r.label} This Week`, tag: r.dir === "up" ? "Improved" : "Slipped", quiet: r.dir === "down",
      detail: `This week: ${r.thisWeek.good} Good, ${r.thisWeek.ok} Okay, ${r.thisWeek.low} Low. Last week: ${r.lastWeek.good} Good, ${r.lastWeek.ok} Okay, ${r.lastWeek.low} Low.`,
    });
  }

  // Most telling first; things that faded go last. Three at most, so it stays a glance.
  const order: Record<NewsItem["kind"], number> = { pattern: 0, food: 1, weekday: 2, week: 3 };
  items.sort((a, b) => Number(!!a.quiet) - Number(!!b.quiet) || order[a.kind] - order[b.kind]);
  return { since: longDate(prev.day), newNights: Math.max(0, model.totals.nights - prev.nights), items: items.slice(0, 3) };
}

