"use client";

// The Patterns page, drawn from a PatternsModel (lib/patterns.ts). Presentational only: no data
// loading, no auth, so the screen, the walkthrough demo and the dev harness all render the same
// thing. It shows what the user's own logs say, with the counts behind every line, and never
// tells them what to do next (nudges and habit builders own that).

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import BottomNav from "./BottomNav";
import Card from "./Card";
import WyaaAvatar from "./WyaaAvatar";
import { openUpgradeModal } from "./UpgradeModal";
import { riseIn } from "../lib/motion";
import { LEVEL_HEX, type Level } from "../lib/reflectionFacts";
import type { ActiveChange } from "../lib/changes";
import type { PatternsNews } from "../lib/patternsNews";
import type {
  BetterSlower, CompareId, DipRhythm, FoodLinks, FoodRow, Lens, PatternFinding,
  PatternsModel, UnlockItem, WatchItem, WeekCompare, WeekGrid,
} from "../lib/patterns";

export type LedgerItem = Pick<ActiveChange, "id" | "templateId" | "label" | "targetKey" | "keep" | "effect" | "stopped" | "regressed">;

const BETTER = LEVEL_HEX.good;
const SLOWER = LEVEL_HEX.low;
const LEVEL_WORD: Record<Level, string> = { good: "Good", ok: "Okay", low: "Low" };

// ── Small pieces ────────────────────────────────────────────────────────────
type IconName =
  | "moon" | "meal" | "move" | "drop" | "stress" | "bolt" | "leaf" | "protein" | "tag" | "spark"
  | "sunrise" | "sun" | "sunset" | "calendar" | "lock" | "seed" | "up" | "down" | "flat" | "compare" | "list" | "arrow";

function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, ReactNode> = {
    moon: <path d="M20 13.2A8 8 0 1 1 10.8 4a6.2 6.2 0 0 0 9.2 9.2z" />,
    meal: <><path d="M4 11h16a8 8 0 0 1-16 0z" /><path d="M9 7c0-1.2 1-1.6 1-2.8M13 7c0-1.2 1-1.6 1-2.8" /></>,
    move: <><circle cx="13.5" cy="4.5" r="1.8" /><path d="M10 21l2-5.5 2.5 2.5V21M8 11.5l3-3.5h3l2.5 3.5 2.5.5M11 8l-1.5 4.5" /></>,
    drop: <path d="M12 3.5c3 3.6 6 6.9 6 10.4a6 6 0 0 1-12 0c0-3.5 3-6.8 6-10.4z" />,
    stress: <polyline points="3 12 7 12 9.5 6 14 18 16.5 12 21 12" />,
    bolt: <path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" />,
    leaf: <><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14" /><path d="M5 19l7-7" /></>,
    protein: <path d="M12 3.5c3.6 0 6 5.2 6 9.2A6 6 0 0 1 6 12.7c0-4 2.4-9.2 6-9.2z" />,
    tag: <><path d="M3.5 12.5V4.5h8l9 9-8 8-9-9z" /><circle cx="8" cy="9" r="1.3" /></>,
    spark: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" opacity="0.5" /><circle cx="12" cy="12" r="3.4" /></>,
    sunrise: <><path d="M4 18h16M7 18a5 5 0 0 1 10 0" /><path d="M12 6v3M5.6 10.6l1.6 1.2M18.4 10.6l-1.6 1.2" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>,
    sunset: <><path d="M4 18h16M7 18a5 5 0 0 1 10 0" /><path d="M12 9V5M9.5 7.5L12 5l2.5 2.5" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
    lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
    seed: <><path d="M12 20v-7" /><path d="M12 13c0-4 3-6 7-6 0 4-3 6-7 6z" /><path d="M12 15c0-3-2.4-5-6-5 0 3 2.4 5 6 5z" /></>,
    up: <path d="M6 14l6-6 6 6" />,
    down: <path d="M6 10l6 6 6-6" />,
    flat: <path d="M5 12h14" />,
    compare: <path d="M5 20V9M12 20V4M19 20v-7" />,
    list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
    arrow: <path d="M5 12h13M13 7l5 5-5 5" />,
  };
  return <svg viewBox="0 0 24 24" className={className} aria-hidden {...p}>{paths[name]}</svg>;
}

// Card titles use Home's section label; labels inside a card use Home's small grey label.
function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/70">{children}</p>;
}
function SubLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">{children}</p>;
}
function Chip({ children, tone = "soft" }: { children: ReactNode; tone?: "soft" | "plain" }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone === "soft" ? "bg-primary/10 text-primary-dark" : "bg-ink/[0.06] text-ink/55"}`}>
      {children}
    </span>
  );
}
function Swatch({ color, square = false }: { color: string; square?: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 ${square ? "rounded-[3px]" : "rounded-full"}`} style={{ background: color }} />;
}
function LevelLegend({ extra }: { extra?: ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted/70">
      {(["good", "ok", "low"] as Level[]).map((l) => (
        <span key={l} className="flex items-center gap-1"><Swatch color={LEVEL_HEX[l]} square /> {LEVEL_WORD[l]}</span>
      ))}
      {extra}
    </div>
  );
}
function Bar({ value, max, color, ready, delay = 0, height = 8, opacity = 1 }: { value: number; max: number; color: string; ready: boolean; delay?: number; height?: number; opacity?: number }) {
  const pct = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex-1" style={{ height }}>
      <div className="h-full rounded-full" style={{ width: ready ? `${pct}%` : "0%", background: color, opacity, transition: `width 1200ms cubic-bezier(0.22,1,0.36,1) ${delay}ms` }} />
    </div>
  );
}
function Progress({ have, need, ready }: { have: number; need: number; ready: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/10">
      <div className="h-full rounded-full bg-primary" style={{ width: ready ? `${Math.min(100, (have / Math.max(need, 1)) * 100)}%` : "0%", transition: "width 1200ms cubic-bezier(0.22,1,0.36,1) 200ms" }} />
    </div>
  );
}
function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex shrink-0 rounded-full bg-ink/[0.05] p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={`rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition ${value === o.value ? "bg-white text-ink shadow-[0_1px_3px_rgba(31,41,55,0.12)]" : "text-ink/50"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
function plural(n: number, one: string, many = one + "s") { return `${n} ${n === 1 ? one : many}`; }
const LENS_LABEL: Record<Lens, string> = { energy: "Energy", digestion: "Digestion" };

// ── Header ──────────────────────────────────────────────────────────────────
function Header({ model }: { model: PatternsModel }) {
  const t = model.totals;
  const pills: [IconName, string][] = [["moon", `${plural(t.nights, "Night")} Reflected`], ["meal", plural(t.meals, "Meal")]];
  if (t.workouts) pills.push(["move", plural(t.workouts, "Workout")]);
  if (t.waterDays) pills.push(["drop", `${plural(t.waterDays, "Day")} Of Water`]);
  return (
    <header className="mb-5">
      <h1 className="text-2xl font-semibold text-ink">Patterns</h1>
      <p className="mt-1 text-sm text-muted/70">What lines up with how you feel, counted from your own logs</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {pills.map(([icon, label]) => (
          <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-medium text-ink/70 shadow-[0_1px_2px_rgba(40,80,140,0.08)]">
            <Icon name={icon} className="h-3.5 w-3.5 text-primary-dark/80" /> {label}
          </span>
        ))}
      </div>
    </header>
  );
}

// ── New since you last looked ───────────────────────────────────────────────
const NEWS_ICON: Record<PatternsNews["items"][number]["kind"], IconName> = { pattern: "spark", food: "meal", weekday: "calendar", week: "compare" };

function NewsCard({ news, style }: { news: PatternsNews; style: CSSProperties }) {
  return (
    <Card className="mb-5" style={style}>
      <SectionLabel>New Since You Last Looked</SectionLabel>
      {news.since && (
        <p className="mt-1 text-[12px] text-muted/75">
          Since {news.since}{news.newNights > 0 ? `, ${plural(news.newNights, "new Nightly Reflection")}` : ""}
        </p>
      )}
      <div className="mt-2 divide-y divide-ink/[0.06]">
        {news.items.map((it) => (
          <div key={it.id} className="flex items-start gap-3 py-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-dark"><Icon name={NEWS_ICON[it.kind]} className="h-3.5 w-3.5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-[13.5px] font-semibold text-ink">{it.title}</p>
                <Chip tone={it.quiet ? "plain" : "soft"}>{it.tag}</Chip>
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-ink/70">{it.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Hero: the clearest pattern ──────────────────────────────────────────────
function EvidenceStat({ label, hits, n, outcome, color, strong, ready, delay }: { label: string; hits: number; n: number; outcome: string; color: string; strong: boolean; ready: boolean; delay: number }) {
  return (
    <div className={`rounded-xl px-3 py-3 ${strong ? "bg-white shadow-[0_2px_10px_rgba(40,80,140,0.10)]" : "bg-white/60"}`}>
      <p className="min-h-[30px] text-[11.5px] leading-snug text-muted/80">{label}</p>
      <p className={`mt-1 font-semibold leading-none ${strong ? "text-ink" : "text-ink/60"}`}>
        <span className="text-[28px]">{hits}</span>
        <span className="text-[14px] font-medium text-muted/70"> of {n}</span>
      </p>
      <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-ink/[0.06]"><Bar value={hits} max={n} color={color} ready={ready} delay={delay} height={6} /></div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted/70">had {outcome}</p>
    </div>
  );
}

function EvidenceStrip({ f }: { f: PatternFinding }) {
  const cols = { gridTemplateColumns: `repeat(${f.strip.length}, minmax(0, 1fr))` };
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <SubLabel>Last 14 Days</SubLabel>
        <span className="text-[10.5px] text-muted/60">Each column is one day</span>
      </div>
      <p className="mt-2 text-[11px] font-medium text-ink/70">{f.condShort}{f.lagged ? " (Day Before)" : ""}</p>
      <div className="mt-1 grid gap-[3px]" style={cols}>
        {f.strip.map((c) => (
          <div key={c.key} className="flex h-4 items-center justify-center">
            {c.cond == null ? <span className="h-[2px] w-2 rounded-full bg-ink/10" /> : c.cond ? <span className="h-2.5 w-2.5 rounded-full bg-ink/75" /> : <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-ink/20" />}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] font-medium text-ink/70">{f.outcomeShort}</p>
      <div className="mt-1 grid gap-[3px]" style={cols}>
        {f.strip.map((c) => (
          <div key={c.key} className="flex flex-col items-center gap-1">
            <span className={`aspect-square w-full max-w-[18px] rounded-[5px] ${c.level ? "" : "border-[1.5px] border-ink/10"}`} style={c.level ? { background: LEVEL_HEX[c.level] } : undefined} />
            <span className="text-[9px] text-muted/55">{c.dayLabel}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted/70">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-ink/75" /> Yes</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border-[1.5px] border-ink/25" /> No</span>
        {(["good", "ok", "low"] as Level[]).map((l) => (
          <span key={l} className="flex items-center gap-1"><Swatch color={LEVEL_HEX[l]} square /> {LEVEL_WORD[l]}</span>
        ))}
      </div>
    </div>
  );
}

function HeroCard({ f, firstMoment, nights, ready, style }: { f: PatternFinding; firstMoment: boolean; nights: number; ready: boolean; style: CSSProperties }) {
  const s = f.split;
  return (
    <Card className="relative overflow-hidden" data-tour="patterns-coach" style={style}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-primary/[0.13] via-primary/[0.05] to-transparent" />
      <div className="relative">
        {firstMoment && (
          // The same quiet glow Home uses when a habit is built: shown once, then recorded.
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-white/80 px-3 py-3 shadow-[0_2px_10px_rgba(40,80,140,0.08)]">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary animate-habit-glow"><Icon name="spark" className="h-5 w-5" /></span>
            <div className="min-w-0">
              <SectionLabel>Your First Pattern Is Here</SectionLabel>
              <p className="mt-0.5 text-[12.5px] leading-snug text-ink/70">{plural(nights, "Nightly Reflection")} in, your logs show their first clear connection.</p>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2"><WyaaAvatar size={26} /><SectionLabel>Your Clearest Pattern</SectionLabel></div>
        <p className="mt-3.5 text-[21px] font-semibold leading-[1.28] tracking-[-0.01em] text-ink">{f.headline}</p>
        <div className="mt-2.5"><Chip>Based On {s.withN + s.withoutN} Days</Chip></div>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <EvidenceStat label={f.withLabel} hits={s.withHits} n={s.withN} outcome={f.outcomeLabel} color={BETTER} strong ready={ready} delay={250} />
          <EvidenceStat label={f.withoutLabel} hits={s.withoutHits} n={s.withoutN} outcome={f.outcomeLabel} color={SLOWER} strong={false} ready={ready} delay={400} />
        </div>
        <EvidenceStrip f={f} />
        <p className="mt-3.5 text-[11px] leading-relaxed text-muted/55">These line up in your own logs. That doesn&apos;t show one causes the other.</p>
      </div>
    </Card>
  );
}

function Ring({ have, need }: { have: number; need: number }) {
  const r = 26, c = 2 * Math.PI * r;
  const pct = Math.min(1, have / Math.max(need, 1));
  return (
    <div className="relative h-[68px] w-[68px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(111,168,255,0.16)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="#6FA8FF" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[17px] font-semibold text-ink">{have}</span>
        <span className="mt-0.5 text-[10px] text-muted/70">of {need}</span>
      </div>
    </div>
  );
}

// Says plainly that the Nightly Reflection is what powers Patterns, with the user's own counts.
function reflectionLine(model: PatternsModel): string {
  const c = model.coverage, t = model.totals;
  if (t.nights === 0 && t.meals > 0) {
    return `You've logged ${plural(t.meals, "meal")} and no Nightly Reflections yet. Patterns compare each night's reflection with what you logged that day, so they start with your first one. It opens at 5pm each evening.`;
  }
  if (c.mealDays - c.both >= 3) {
    return `You've logged meals on ${plural(c.mealDays, "day")} and done ${plural(c.nights, "Nightly Reflection")}. Patterns can only use the ${plural(c.both, "day")} that have both.`;
  }
  return "Your Nightly Reflection is what powers Patterns. Each one is compared with what you logged that day, and it opens at 5pm each evening.";
}

function BuildingHero({ model, style }: { model: PatternsModel; style: CSSProperties }) {
  const t = model.totals;
  const unlock = model.unlocks.find((u) => u.id === "hero");
  const need = unlock?.need ?? 7;
  const left = Math.max(0, need - model.nightsInWindow);
  const eta = unlock?.detail.split(", ").slice(1).join(", ");
  const built: [IconName, number, string][] = [
    ["moon", t.nights, t.nights === 1 ? "Night Reflected" : "Nights Reflected"],
    ["meal", t.meals, t.meals === 1 ? "Meal Logged" : "Meals Logged"],
    ["move", t.workouts, t.workouts === 1 ? "Workout" : "Workouts"],
    ["drop", t.waterDays, t.waterDays === 1 ? "Day Of Water" : "Days Of Water"],
  ];
  return (
    <Card className="relative overflow-hidden" data-tour="patterns-coach" style={style}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-primary/[0.13] to-transparent" />
      <div className="relative">
        <div className="flex items-center gap-4">
          <Ring have={model.nightsInWindow} need={need} />
          <div className="min-w-0">
            <SectionLabel>Your First Pattern</SectionLabel>
            <p className="mt-1 text-[18px] font-semibold leading-snug text-ink">{plural(left, "more Nightly Reflection")} to go</p>
            {eta && <p className="mt-0.5 text-[12.5px] text-muted/80">At one a night, that&apos;s {eta}</p>}
          </div>
        </div>
        <p className="mt-3.5 text-[13px] leading-relaxed text-ink/75">{reflectionLine(model)}</p>
        <div className="mt-4"><SubLabel>What You&apos;ve Built So Far</SubLabel></div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {built.map(([icon, value, label]) => (
            <div key={label} className="flex items-center gap-2.5 rounded-xl bg-white/80 px-3 py-2.5 shadow-[0_1px_3px_rgba(40,80,140,0.08)]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-dark"><Icon name={icon} /></span>
              <div className="min-w-0 leading-tight">
                <p className="text-[17px] font-semibold text-ink">{value}</p>
                <p className="truncate text-[11px] text-muted/75">{label}</p>
              </div>
            </div>
          ))}
        </div>
        {t.topFood && (
          <p className="mt-3 text-[13px] text-ink/75">Most logged so far: <span className="font-semibold text-ink">{t.topFood.label}</span>, {t.topFood.count} times.</p>
        )}
      </div>
    </Card>
  );
}

function QuietHero({ model, style }: { model: PatternsModel; style: CSSProperties }) {
  return (
    <Card className="relative overflow-hidden" data-tour="patterns-coach" style={style}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-primary/[0.10] to-transparent" />
      <div className="relative">
        <div className="flex items-center gap-2"><WyaaAvatar size={26} /><SectionLabel>Your Clearest Pattern</SectionLabel></div>
        <p className="mt-3 text-[19px] font-semibold leading-snug text-ink">Nothing stands out clearly yet</p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink/70">
          Across your {plural(model.nightsInWindow, "Nightly Reflection")} so far, no gap is big enough to call a pattern. This checks again after every one.
        </p>
      </div>
    </Card>
  );
}

// After free access ends: the clearest pattern stays visible as proof, the rest is counted
// behind the existing upgrade path.
function MorePatternsCard({ model, ledger, style }: { model: PatternsModel; ledger: LedgerItem[]; style: CSSProperties }) {
  const hero = model.findings[0];
  const heroKey = hero?.rowKey ?? hero?.id;
  const keys = new Set<string>();
  for (const f of model.findings.slice(1)) keys.add(f.rowKey ?? f.id);
  let foodCount = 0;
  for (const m of ["energy", "digestion"] as const) {
    for (const r of [...model.foods[m].good, ...model.foods[m].low]) {
      const k = `${m}:${r.id}:${r.lag ? 1 : 0}`;
      if (k === heroKey) continue;
      foodCount++;
      keys.add(k);
    }
  }
  const bs = model.betterSlower[model.lenses[0]];
  const changed = model.weekCompare.rows.filter((r) => r.dir !== "same").length;
  const lines: [string, string][] = [];
  if (foodCount) lines.push(["Foods And Your Days", `${plural(foodCount, "food")} lining up`]);
  if (bs.status === "ready" && bs.rows.length) lines.push(["Your Better Days Vs Your Slower Days", plural(bs.rows.length, "difference")]);
  if (changed) lines.push(["Compared To Last Week", `${plural(changed, "change")} this week`]);
  if (ledger.length) lines.push(["Changes You're Making", `${plural(ledger.length, "habit")} tracked`]);
  const count = keys.size;
  return (
    <Card className="mt-5" style={style}>
      <SectionLabel>{count > 0 ? `${plural(count, "More Pattern")} Found` : "More From Your Logs"}</SectionLabel>
      {lines.length > 0 && (
        <div className="mt-2 divide-y divide-ink/[0.06]">
          {lines.map(([title, value]) => (
            <div key={title} className="flex items-center gap-2.5 py-2.5">
              <Icon name="lock" className="h-3.5 w-3.5 shrink-0 text-primary/70" />
              <p className="min-w-0 flex-1 text-[13px] text-ink/80">{title}</p>
              <span className="shrink-0 text-[12px] font-semibold text-ink">{value}</span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[12.5px] leading-relaxed text-muted/80">Each one comes with the days behind it, like the pattern above.</p>
      <button type="button" onClick={openUpgradeModal} className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]">Unlock Pro</button>
    </Card>
  );
}

// ── Foods and your days ─────────────────────────────────────────────────────
function FoodRowView({ r }: { r: FoodRow }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-[14px] font-medium text-ink">{r.label}</p>
          {r.kind === "type" && <Chip tone="plain">Meal Type</Chip>}
          {r.lag && <Chip tone="plain">Night Before</Chip>}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-[3px]" aria-label={`${r.hits} of ${r.n} days`}>
          {r.dots.map((l, i) => <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: LEVEL_HEX[l] }} />)}
        </div>
      </div>
      <p className="shrink-0 text-right leading-tight">
        <span className="text-[16px] font-semibold text-ink">{r.hits}</span>
        <span className="text-[12px] text-muted/75"> of {r.n}</span>
        <span className="block text-[10.5px] text-muted/60">days</span>
      </p>
    </div>
  );
}

function WatchList({ items, title }: { items: WatchItem[]; title: string }) {
  if (!items.length) return null;
  return (
    <div className="mt-4">
      <SubLabel>{title}</SubLabel>
      <div className="mt-2 space-y-2">
        {items.map((w) => (
          <div key={w.id} className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[13px] text-ink/80">
              {w.label}{w.kind === "type" && <span className="ml-1.5 align-middle"><Chip tone="plain">Meal Type</Chip></span>}
            </p>
            <div className="flex shrink-0 gap-[3px]">
              {Array.from({ length: w.need }, (_, i) => <span key={i} className={`h-2 w-2 rounded-full ${i < w.have ? "bg-primary" : "border-[1.5px] border-primary/30"}`} />)}
            </div>
            <span className="w-[62px] shrink-0 text-right text-[11px] tabular-nums text-muted/70">{w.have} of {w.need} days</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FoodsCard({ model, lens, setLens, ready, style }: { model: PatternsModel; lens: Lens; setLens: (l: Lens) => void; ready: boolean; style: CSSProperties }) {
  const fl: FoodLinks = model.foods[lens];
  const word = lens === "energy" ? { good: "Better Energy", low: "Lower Energy" } : { good: "Easier Digestion", low: "Rougher Digestion" };
  const eta = model.unlocks.find((u) => u.id === "foods")?.detail.split(", ").slice(1).join(", ");
  return (
    <Card className="mt-5" style={style}>
      <SectionLabel>Foods And Your Days</SectionLabel>
      <div className="mt-2.5"><Segmented value={lens} onChange={setLens} options={model.lenses.map((l) => ({ value: l, label: LENS_LABEL[l] }))} /></div>
      {fl.status === "building" ? (
        <>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink/80">
            Your first food and feeling read comes after {fl.need} days with meals and a Nightly Reflection. You have {fl.eligible}{eta ? `, so it should land ${eta}` : ""}.
          </p>
          <div className="mt-2"><Progress have={fl.eligible} need={fl.need} ready={ready} /></div>
          <WatchList items={fl.watching} title="Watching So Far" />
          {fl.watching.length > 0 && <p className="mt-2.5 text-[11px] leading-relaxed text-muted/60">Each one needs 4 days with a Nightly Reflection, plus days without it to compare against.</p>}
        </>
      ) : (
        <>
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted/80">
            Across {fl.eligible} days with meals and a Nightly Reflection, {fl.baseGood} had {fl.goodWords} and {fl.baseLow} had {fl.lowWords}.
          </p>
          {fl.status === "none" && (
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink/80">No food stands apart yet. A food shows up here once it&apos;s on 4 or more days and lines up clearly.</p>
          )}
          {fl.low.length > 0 && (
            <div className="mt-3.5">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink/80"><Swatch color={LEVEL_HEX.low} /> Lining Up With {word.low}</p>
              <div className="divide-y divide-ink/[0.06]">{fl.low.map((r) => <FoodRowView key={r.id + r.lag} r={r} />)}</div>
            </div>
          )}
          {fl.good.length > 0 && (
            <div className="mt-3.5">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink/80"><Swatch color={LEVEL_HEX.good} /> Lining Up With {word.good}</p>
              <div className="divide-y divide-ink/[0.06]">{fl.good.map((r) => <FoodRowView key={r.id + r.lag} r={r} />)}</div>
            </div>
          )}
          {fl.status === "ready" && <LevelLegend extra={<span>Each dot is a day you logged it</span>} />}
          {fl.neutral.length > 0 && (
            <p className="mt-3.5 text-[12px] leading-relaxed text-muted/75"><span className="font-semibold text-ink/70">About the same either way:</span> {fl.neutral.join(", ")}.</p>
          )}
          <WatchList items={fl.watching} title="Still Watching" />
          {[...fl.good, ...fl.low].some((r) => r.lag) && (
            <p className="mt-3 text-[11px] leading-relaxed text-muted/60">Night Before means it was in your evening meals the day before.</p>
          )}
        </>
      )}
    </Card>
  );
}

// ── Better days vs slower days ──────────────────────────────────────────────
const COMPARE_ICON: Record<CompareId, IconName> = { sleep: "moon", move: "move", water: "drop", stress: "stress", meals: "meal", protein: "protein", type: "tag" };

function BetterSlowerCard({ model, lens, setLens, ready, style }: { model: PatternsModel; lens: Lens; setLens: (l: Lens) => void; ready: boolean; style: CSSProperties }) {
  const data: BetterSlower = model.betterSlower[lens];
  const names = lens === "energy" ? ["Better Days", "Slower Days"] : ["Easier Days", "Rougher Days"];
  return (
    <Card className="mt-5" data-tour="patterns-days" style={style}>
      <SectionLabel>Your Better Days Vs Your Slower Days</SectionLabel>
      <div className="mt-2.5"><Segmented value={lens} onChange={setLens} options={model.lenses.map((l) => ({ value: l, label: LENS_LABEL[l] }))} /></div>
      {data.status === "building" ? (
        <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink/75">This needs {data.need} Nightly Reflections with a {lens} answer. You have {data.nights}.</p>
      ) : data.status === "steady" ? (
        <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink/75">Your {lens} has been very even across your {plural(data.nights, "Nightly Reflection")}, so there&apos;s no clear split into better and slower days yet.</p>
      ) : (
        <>
          {data.summary && <p className="mt-2.5 text-[15px] leading-snug text-ink">{data.summary}</p>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[{ c: BETTER, t: names[0], n: data.betterN, d: data.betterDef }, { c: SLOWER, t: names[1], n: data.slowerN, d: data.slowerDef }].map((g) => (
              <div key={g.t} className="rounded-xl bg-surface px-3 py-2">
                <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink"><Swatch color={g.c} square /> {g.t} <span className="font-normal text-muted/70">{g.n}</span></p>
                <p className="mt-0.5 text-[10.5px] leading-snug text-muted/70">{g.d}</p>
              </div>
            ))}
          </div>
          {data.rows.length > 0 ? (
            <div className="mt-4 space-y-4">
              {data.rows.map((r, i) => (
                <div key={r.id}>
                  <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink/85">
                    <Icon name={COMPARE_ICON[r.icon]} className="h-3.5 w-3.5 text-muted/70" /> {r.label}
                    {r.icon === "type" && <Chip tone="plain">Meal Type</Chip>}
                  </p>
                  <div className="mt-1.5 space-y-1">
                    <div className="flex items-center gap-2"><Bar value={r.better} max={r.scaleMax} color={BETTER} ready={ready} delay={150 + i * 120} /><span className="w-[52px] shrink-0 text-right text-[11.5px] font-semibold tabular-nums text-ink">{r.betterText}</span></div>
                    <div className="flex items-center gap-2"><Bar value={r.slower} max={r.scaleMax} color={SLOWER} ready={ready} delay={220 + i * 120} /><span className="w-[52px] shrink-0 text-right text-[11.5px] tabular-nums text-muted/80">{r.slowerText}</span></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-muted/75">Nothing you log differs much between the two yet.</p>
          )}
          {data.same.length > 0 && (
            <p className="mt-4 text-[12px] leading-relaxed text-muted/75"><span className="font-semibold text-ink/70">About the same on both:</span> {data.same.join(", ")}.</p>
          )}
        </>
      )}
    </Card>
  );
}

// ── This week: compared to last week, plus energy dips ──────────────────────
const VERDICT: Record<"up" | "down" | "same", { label: string; icon: IconName; cls: string }> = {
  up: { label: "Improved", icon: "up", cls: "bg-primary/10 text-primary-dark" },
  down: { label: "Slipped", icon: "down", cls: "bg-ink/[0.06] text-ink/60" },
  same: { label: "Held Steady", icon: "flat", cls: "bg-ink/[0.04] text-muted/80" },
};

function SplitBar({ c, height, opacity = 1 }: { c: { good: number; ok: number; low: number; n: number }; height: number; opacity?: number }) {
  return (
    <div className="flex w-full gap-[2px] overflow-hidden rounded-full" style={{ height, opacity }}>
      {(["good", "ok", "low"] as Level[]).filter((l) => c[l] > 0).map((l) => (
        <span key={l} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(c[l] / c.n) * 100}%`, background: LEVEL_HEX[l] }} />
      ))}
    </div>
  );
}

function ThisWeekCard({ wc, dips, showCompare, ready, style }: { wc: WeekCompare; dips: DipRhythm; showCompare: boolean; ready: boolean; style: CSSProperties }) {
  const r = dips.recent;
  const name = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" } as const;
  let dipLine = "";
  if (r) {
    const total = r.morning + r.afternoon + r.evening;
    if (!dips.peak) dipLine = `No energy dips in your last ${plural(r.nights, "Nightly Reflection")}.`;
    else if (total === 1) dipLine = `One dip in your last ${r.nights} nights so far, in the ${name[dips.peak].toLowerCase()}.`;
    else {
      dipLine = `${name[dips.peak]} is when your energy dips most: ${r[dips.peak]} of your last ${r.nights} nights`;
      dipLine += dips.prior ? `, against ${dips.prior[dips.peak]} of ${dips.prior.nights} the two weeks before.` : ".";
    }
  }
  return (
    <Card className="mt-5" style={{ ...style }}>
      <SectionLabel>This Week</SectionLabel>
      <p className="mt-1 text-[12.5px] text-muted/75">{plural(wc.thisN, "Nightly Reflection")} this week, {wc.lastN} last week</p>
      {showCompare && wc.ready && (
        <div className="mt-3">
          <SubLabel>Compared To Last Week</SubLabel>
          <div className="mt-2 space-y-2.5">
            {wc.rows.map((row) => (
              <div key={row.key} className="flex items-center gap-2.5">
                <span className="w-[62px] shrink-0 text-[12.5px] font-medium text-ink">{row.label}</span>
                <div className="flex-1 space-y-[3px]" style={{ opacity: ready ? 1 : 0, transition: "opacity 700ms ease" }}>
                  <SplitBar c={row.lastWeek} height={4} opacity={0.55} />
                  <SplitBar c={row.thisWeek} height={8} />
                </div>
                <span className="w-[34px] shrink-0 text-right text-[11px] tabular-nums text-ink/70">{row.thisWeek.good} of {row.thisWeek.n}</span>
                <span className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${VERDICT[row.dir].cls}`}>
                  <Icon name={VERDICT[row.dir].icon} className="h-3 w-3" /> {VERDICT[row.dir].label}
                </span>
              </div>
            ))}
          </div>
          <LevelLegend extra={<span>Thin bar last week, thick bar this week. Numbers count Good nights this week.</span>} />
        </div>
      )}
      {r && (
        <div className="mt-4">
          <SubLabel>Energy Dips</SubLabel>
          <p className="mt-1.5 text-[13px] leading-snug text-ink/85">{dipLine}</p>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {([["morning", "sunrise"], ["afternoon", "sun"], ["evening", "sunset"]] as const).map(([k, icon], i) => {
              const peak = dips.peak === k;
              return (
                <div key={k} className={`rounded-xl px-2.5 py-2 ${peak ? "bg-primary/[0.08]" : "bg-surface"}`}>
                  <p className={`flex items-center gap-1 text-[11px] ${peak ? "font-semibold text-ink" : "text-muted/75"}`}><Icon name={icon} className={`h-3.5 w-3.5 ${peak ? "text-primary-dark" : "text-muted/60"}`} /> {name[k]}</p>
                  <p className="mt-1 leading-none"><span className={`text-[17px] font-semibold ${peak ? "text-ink" : "text-ink/60"}`}>{r[k]}</span><span className="text-[11px] text-muted/70"> of {r.nights}</span></p>
                  <div className="mt-1.5 flex h-1.5 rounded-full bg-ink/[0.05]"><Bar value={r[k]} max={r.nights} color={peak ? BETTER : LEVEL_HEX.ok} ready={ready} delay={i * 120} height={6} /></div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Week by week ────────────────────────────────────────────────────────────
function WeekGridCard({ grid, heroOverlay, ready, style }: { grid: WeekGrid; heroOverlay: string | null; ready: boolean; style: CSSProperties }) {
  const [overlayId, setOverlayId] = useState<string | null>(grid.overlays.some((o) => o.id === heroOverlay) ? heroOverlay : null);
  const latest = useMemo(() => {
    const keys = Object.keys(grid.details).sort();
    for (let i = keys.length - 1; i >= 0; i--) if (grid.details[keys[i]].feel.length) return keys[i];
    return keys[keys.length - 1] ?? null;
  }, [grid.details]);
  const [selected, setSelected] = useState<string | null>(latest);
  const overlay = grid.overlays.find((o) => o.id === overlayId) ?? null;
  const marked = useMemo(() => new Set(overlay?.days ?? []), [overlay]);
  const detail = selected ? grid.details[selected] : null;

  let line = "Each square is a day, shaded by the energy you gave it in that night's Nightly Reflection. Tap one to see what it held.";
  if (grid.slowest && grid.best) line = `${grid.slowest.weekday} have been your slowest: ${grid.slowest.words} on ${grid.slowest.hits} of ${grid.slowest.n}. ${grid.best.weekday} have been your strongest, ${grid.best.hits} of ${grid.best.n}.`;
  else if (grid.slowest) line = `${grid.slowest.weekday} have been your slowest: ${grid.slowest.words} on ${grid.slowest.hits} of ${grid.slowest.n}.`;
  else if (grid.best) line = `${grid.best.weekday} have been your strongest: ${grid.best.words} on ${grid.best.hits} of ${grid.best.n}.`;

  return (
    <Card className="mt-5" style={style}>
      <SectionLabel>Your Energy, Week By Week</SectionLabel>
      <p className="mt-2 text-[14px] leading-snug text-ink/85">{line}</p>
      {grid.overlays.length > 0 && (
        <div className="-mx-4 mt-3 overflow-x-auto px-4 pb-1">
          <div className="flex w-max items-center gap-1.5">
            <span className="mr-0.5 text-[11px] font-medium text-muted/70">Show</span>
            {grid.overlays.map((o) => (
              <button key={o.id} type="button" onClick={() => setOverlayId(overlayId === o.id ? null : o.id)} aria-pressed={overlayId === o.id}
                className={`rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold transition ${overlayId === o.id ? "bg-ink/85 text-white" : "bg-ink/[0.05] text-ink/65"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-3 grid items-center gap-[5px]" style={{ gridTemplateColumns: "40px repeat(7, minmax(0, 1fr)) 34px" }}>
        <span />
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="text-center text-[10px] text-muted/60">{d}</span>)}
        <span className="text-right text-[9.5px] text-muted/55">Good</span>
        {grid.weeks.map((w, wi) => <WeekRow key={w.key} w={w} wi={wi} marked={marked} selected={selected} onSelect={setSelected} ready={ready} />)}
      </div>
      {overlay && <p className="mt-3 rounded-xl bg-surface px-3 py-2.5 text-[12.5px] leading-relaxed text-ink/80">{overlay.summary}</p>}
      <LevelLegend extra={<>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] border-[1.5px] border-ink/15" /> No Reflection</span>
        {overlay && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-ink/80" /> {overlay.label}</span>}
      </>} />
      {detail && (
        <div className="mt-3 rounded-xl border border-ink/[0.06] bg-surface px-3 py-3">
          <p className="text-[12.5px] font-semibold text-ink">{detail.label}</p>
          {detail.feel.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {detail.feel.map((f) => (
                <span key={f.label} className="flex items-center gap-1 text-[11.5px] text-muted/80"><Swatch color={LEVEL_HEX[f.level]} /> {f.label} <span className="font-medium text-ink">{f.word}</span></span>
              ))}
            </div>
          ) : <p className="mt-1 text-[11.5px] text-muted/70">No Nightly Reflection that night</p>}
          {(detail.movement || detail.water) && <p className="mt-1.5 text-[11.5px] text-ink/70">{[detail.movement, detail.water].filter(Boolean).join(" · ")}</p>}
          {detail.foods.length > 0 && <p className="mt-1 text-[11.5px] leading-relaxed text-ink/70"><span className="text-muted/70">Ate:</span> {detail.foods.join(", ")}</p>}
        </div>
      )}
    </Card>
  );
}

function WeekRow({ w, wi, marked, selected, onSelect, ready }: { w: WeekGrid["weeks"][number]; wi: number; marked: Set<string>; selected: string | null; onSelect: (k: string) => void; ready: boolean }) {
  return (
    <>
      <span className="text-[10px] text-muted/60">{w.label}</span>
      {w.cells.map((c, ci) => {
        const isSel = selected === c.key;
        const base = c.future || c.before ? "bg-ink/[0.025]" : c.level ? "" : c.reflected ? "bg-primary/15" : "border-[1.5px] border-ink/10 bg-white";
        return (
          <button key={c.key} type="button" disabled={c.future || c.before} onClick={() => onSelect(c.key)} aria-label={c.key}
            className={`relative flex aspect-square w-full items-center justify-center rounded-[8px] ${base} ${isSel ? "ring-2 ring-ink/70 ring-offset-1" : c.isToday ? "ring-1 ring-ink/30 ring-offset-1" : ""}`}
            style={{ background: c.level ? LEVEL_HEX[c.level] : undefined, opacity: ready ? 1 : 0, transform: ready ? "scale(1)" : "scale(0.6)", transition: `opacity 500ms ease ${wi * 60 + ci * 25}ms, transform 600ms cubic-bezier(0.34,1.56,0.64,1) ${wi * 60 + ci * 25}ms` }}>
            {marked.has(c.key) && <span className="h-[7px] w-[7px] rounded-full bg-ink/85" style={{ boxShadow: "0 0 0 1.5px #fff" }} />}
          </button>
        );
      })}
      <span className="text-right text-[11px] tabular-nums text-ink/60">{w.rated ? w.good : ""}</span>
    </>
  );
}

// ── Changes you're making (compact) ─────────────────────────────────────────
const LOW_NIGHTS: Record<string, string> = {
  energy: "Low-energy nights a week", sleep: "Poor-sleep nights a week", mood: "Low-mood nights a week", digestion: "Poor-digestion nights a week", stress: "High-stress nights a week",
};
const KEEP_CHIP: Record<"yes" | "maybe", string> = { yes: "Keeping It", maybe: "Might Keep" };

function ChangesCard({ ledger, style }: { ledger: LedgerItem[]; style: CSSProperties }) {
  return (
    <Card className="mt-5" style={style}>
      <SectionLabel>Changes You&apos;re Making</SectionLabel>
      <p className="mt-1 text-[12.5px] text-muted/75">Habits you kept, and how your nights compare before and since</p>
      <div className="mt-2 divide-y divide-ink/[0.06]">
        {ledger.map((c) => {
          const e = c.effect;
          return (
            <div key={c.id} className={`flex items-center gap-3 py-3 ${c.stopped ? "opacity-70" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[14px] font-semibold text-ink">{c.label}</p>
                  {c.stopped ? <Chip tone="plain">Paused</Chip> : <Chip>{KEEP_CHIP[c.keep as "yes" | "maybe"]}</Chip>}
                </div>
                <p className="mt-0.5 text-[11.5px] text-muted/75">
                  {c.stopped ? "Paused for now" : e ? `${LOW_NIGHTS[c.targetKey] ?? LOW_NIGHTS.energy}, from ${plural(e.n, "night")} since` : "Still counting: needs 4 nights before and 4 after"}
                </p>
              </div>
              {!c.stopped && e && (
                <div className="flex shrink-0 items-center gap-1.5 text-ink">
                  <span className="text-[16px] font-semibold text-ink/50">{e.beforePerWeek}</span>
                  <Icon name="arrow" className="h-3.5 w-3.5 text-muted/60" />
                  <span className="text-[16px] font-semibold">{e.afterPerWeek}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Still building ──────────────────────────────────────────────────────────
const UNLOCK_ICON: Record<string, IconName> = { hero: "seed", foods: "meal", compare: "compare", week: "calendar", dips: "sun", weekday: "calendar", changes: "list" };

function UnlockCard({ items, ready, style }: { items: UnlockItem[]; ready: boolean; style: CSSProperties }) {
  return (
    <Card className="mt-5" style={style}>
      <SectionLabel>Still Building</SectionLabel>
      <div className="mt-2 divide-y divide-ink/[0.06]">
        {items.map((u) => (
          <div key={u.id} className="flex items-start gap-3 py-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-dark"><Icon name={UNLOCK_ICON[u.id] ?? "seed"} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[13.5px] font-semibold text-ink">{u.title}</p>
                {u.need > 0 && <span className="shrink-0 text-[11px] tabular-nums text-muted/70">{u.have} of {u.need}</span>}
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-muted/75">{u.detail.charAt(0).toUpperCase() + u.detail.slice(1)}</p>
              {u.need > 0 && <div className="mt-2"><Progress have={u.have} need={u.need} ready={ready} /></div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function PatternsView({ model, ledger, locked, news, firstMoment }: { model: PatternsModel; ledger: LedgerItem[]; locked: boolean; news?: PatternsNews | null; firstMoment?: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(r);
  }, []);
  // One Energy / Digestion lens shared by both cards that have it, opening on the user's focus.
  const [lens, setLens] = useState<Lens>(model.lenses[0]);

  const building = model.heroStatus === "building";
  const hero = model.heroStatus === "ready" ? model.findings[0] : null;
  // While the first-pattern card shows, it already carries the hero countdown.
  const unlocks: UnlockItem[] = model.unlocks.filter((u) => !(building && u.id === "hero"));
  if (!ledger.length) unlocks.push({ id: "changes", title: "Changes You're Making", detail: "Shows up once you finish a habit builder, like Find Your Rhythm, and keep it. It then compares your nights before and since.", have: 0, need: 0 });
  const showCompare = model.betterSlower.energy.status !== "building" || model.betterSlower.digestion.status !== "building";
  const showThisWeek = model.weekCompare.ready || !!model.dips.recent;

  let step = 0;
  const rise = () => riseIn(ready, step++);

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-28 safe-top">
        <div data-tour="patterns-intro">
          <Header model={model} />
          {news && news.items.length > 0 && <NewsCard news={news} style={rise()} />}
          {building ? <BuildingHero model={model} style={rise()} />
            : hero ? <HeroCard f={hero} firstMoment={!!firstMoment} nights={model.totals.nights} ready={ready} style={rise()} />
            : <QuietHero model={model} style={rise()} />}
        </div>

        {locked ? (
          !building && <MorePatternsCard model={model} ledger={ledger} style={rise()} />
        ) : (
          <>
            <FoodsCard model={model} lens={lens} setLens={setLens} ready={ready} style={rise()} />
            {!building && showCompare && (
              <BetterSlowerCard model={model} lens={lens} setLens={setLens} ready={ready} style={rise()} />
            )}
          </>
        )}

        {showThisWeek && (!locked || model.dips.recent) && (
          <ThisWeekCard wc={model.weekCompare} dips={model.dips} showCompare={!locked} ready={ready} style={rise()} />
        )}

        <WeekGridCard grid={model.grid} heroOverlay={hero?.overlayId ?? null} ready={ready} style={rise()} />

        {!locked && ledger.length > 0 && <ChangesCard ledger={ledger} style={rise()} />}

        {unlocks.length > 0 && <UnlockCard items={unlocks} ready={ready} style={rise()} />}

        <p className="mt-5 px-1 text-[11px] leading-relaxed text-muted/50">
          These are observations from your data, not medical advice. The more you log and check in, the sharper they get.
        </p>
      </div>
      <BottomNav current="patterns" />
    </div>
  );
}
