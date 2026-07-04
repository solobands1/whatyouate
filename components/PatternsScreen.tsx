"use client";

import { useEffect, useMemo, useState } from "react";
import BottomNav from "./BottomNav";
import Card from "./Card";
import WyaaAvatar from "./WyaaAvatar";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import { riseIn } from "../lib/motion";
import { computeReflectionFacts, REFLECTION_DOT, type ReflectionFacts, type Level, type MetricChange } from "../lib/reflectionFacts";
import { computeDiscoveryCandidates } from "../lib/discoveries";
import { computeDaysCompared } from "../lib/dayCompare";

type Discovery = { text: string; confidence: "Building" | "Moderate" };

// A real, deterministic one-line clue in the coach's voice — only ever states true counts.
function patternsHeadline(facts: ReflectionFacts): string {
  if (facts.watch) return `${facts.watch.label} has been your low point lately, low on ${facts.watch.low} of the last ${facts.watch.n} nights.`;
  if (facts.dip && !("none" in facts.dip)) return `Your energy dips most in the ${facts.dip.time.toLowerCase()}, ${facts.dip.count} of the last ${facts.dip.days} nights.`;
  if (facts.energyPhrase) return `Your ${facts.energyPhrase} this week.`;
  return "Your check-ins are starting to build a picture. The clearer patterns will show up here.";
}

const KEEP_CHIP: Record<"yes" | "maybe", { label: string; cls: string }> = {
  yes: { label: "Keeping It", cls: "bg-primary-dark/15 text-primary-dark" },
  maybe: { label: "Might Keep", cls: "bg-primary/15 text-primary" },
};

// Behavioural comparison (Your Days Compared) — example data until we compute the real
// food/movement/sleep vs energy correlations. Shown as Preview like the nutrients page.
const EX_BETTER = ["Breakfast before 9am", "A walk or workout", "In bed before 11pm", "Steady meals through the day"];
const EX_LOWER = ["First meal after noon", "Long gaps without eating", "Caffeine after 2pm", "Little movement"];
const CHANGE_VERB: Record<"up" | "down" | "same", { verb: string; cls: string; arrow: string }> = {
  up: { verb: "improved", cls: "text-primary-dark", arrow: "M5 15l7-7 7 7" },
  down: { verb: "slipped", cls: "text-ink/45", arrow: "M19 9l-7 7-7-7" },
  same: { verb: "held steady", cls: "text-muted/60", arrow: "M5 12h14" },
};

// Representative example data — shown (labeled "Preview") until there's enough real
// reflection data, and unlabeled in demo mode. Same idea as the nutrients Preview: the
// user sees what each card will look like rather than an empty page.
const EX_LEVELS: Record<string, Level[]> = {
  energy: ["ok", "good", "low", "ok", "good", "good", "ok"],
  sleep: ["good", "good", "ok", "good", "good", "ok", "good"],
  mood: ["ok", "good", "good", "ok", "good", "good", "good"],
  stress: ["ok", "low", "ok", "good", "good", "ok", "good"],
  digestion: ["good", "ok", "good", "good", "ok", "good", "good"],
};
const EX_DIPS = { morning: 2, afternoon: 6, evening: 1, days: 9 };
const EX_CHANGES: MetricChange[] = [
  { key: "sleep", label: "Sleep", dir: "up" },
  { key: "energy", label: "Energy", dir: "up" },
  { key: "stress", label: "Stress", dir: "same" },
];
const EX_DISCOVERIES: Discovery[] = [
  { text: "On the nights you slept well, your energy tended to be good the next day too.", confidence: "Building" },
  { text: "Your higher-stress days have often lined up with poorer sleep.", confidence: "Building" },
];
const EX_HABITS = [
  { templateId: "ex1", finishedAt: "ex1", title: "Walk After Lunch", keep: "yes" as const },
  { templateId: "ex2", finishedAt: "ex2", title: "Morning Water", keep: "yes" as const },
];
const EX_HEADLINE = "Your best-energy days have tended to follow nights you slept well.";

function Eyebrow({ children, preview }: { children: React.ReactNode; preview?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">{children}</p>
      {preview && <span className="text-[10px] font-semibold uppercase tracking-wide text-primary/60">Preview</span>}
    </div>
  );
}

const DOT_LEGEND = (
  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
    <span className="flex items-center gap-1 text-[10px] text-muted/60"><span className="h-2 w-2 rounded-full bg-primary" /> Good</span>
    <span className="flex items-center gap-1 text-[10px] text-muted/60"><span className="h-2 w-2 rounded-full bg-primary/35" /> Okay</span>
    <span className="flex items-center gap-1 text-[10px] text-muted/60"><span className="h-2 w-2 rounded-full bg-ink/25" /> Low</span>
  </div>
);

export default function PatternsScreen() {
  const { user } = useAuth();
  const { reflections, habitHistory, meals, workouts } = useAppData();
  const facts = useMemo(() => computeReflectionFacts(reflections), [reflections]);
  const daysCompared = useMemo(() => computeDaysCompared(reflections, meals, workouts), [reflections, meals, workouts]);
  const headline = useMemo(() => patternsHeadline(facts), [facts]);
  const keptHabits = useMemo(() => {
    const seen = new Set<string>();
    return habitHistory
      .filter((h) => h.keep === "yes" || h.keep === "maybe")
      .sort((a, b) => (b.finishedAt || "").localeCompare(a.finishedAt || ""))
      .filter((h) => { const k = h.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }, [habitHistory]);

  // AI discoveries: the coach phrases the strongest real co-occurrence counts. Cached per
  // day + data signature so we don't re-hit the API on every visit.
  const candidates = useMemo(() => computeDiscoveryCandidates(reflections), [reflections]);
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  useEffect(() => {
    if (!user || candidates.length === 0) { setDiscoveries([]); return; }
    const sig = candidates.map((c) => `${c.id}:${c.n}:${c.hits}`).join("|");
    const cacheKey = `wya_discoveries_${user.id}`;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached && cached.sig === sig && Array.isArray(cached.discoveries)) { setDiscoveries(cached.discoveries); return; }
    } catch {}
    let cancelled = false;
    fetch("/api/discoveries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidates }) })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const d: Discovery[] = Array.isArray(data?.discoveries) ? data.discoveries : [];
        setDiscoveries(d);
        try { localStorage.setItem(cacheKey, JSON.stringify({ sig, discoveries: d })); } catch {}
      })
      .catch(() => { if (!cancelled) setDiscoveries(candidates.slice(0, 3).map((c) => ({ text: c.text, confidence: c.confidence }))); });
    return () => { cancelled = true; };
  }, [user, candidates]);

  const [isDemoMode, setIsDemoMode] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(r);
  }, []);
  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    if (localStorage.getItem(`wya_demo_mode_${user.id}`) === "true") setIsDemoMode(true);
    const handler = () => {
      if (user && localStorage.getItem(`wya_demo_mode_${user.id}`) === "true") setIsDemoMode(true);
    };
    window.addEventListener("wya_demo_mode_on", handler);
    return () => window.removeEventListener("wya_demo_mode_on", handler);
  }, [user]);

  if (!user) return null;

  // Each card decides real-vs-preview from ITS OWN data (reflection volume for the trend
  // cards, completed habits for the habits card, etc.), so no card ever just disappears.
  // Example data + a "Preview" label until that card has enough; demo shows it unlabeled.
  const demo = isDemoMode;

  // Trend cards (headline, energy, this week) need a few reflections to not look sparse.
  const fewRefl = facts.total < 3;
  const trendEx = demo || fewRefl;
  const preview = !demo && fewRefl;
  const weekCells = trendEx ? facts.week.map((d, i) => ({ ...d, energy: EX_LEVELS.energy[i] ?? null, done: true })) : facts.week;
  const headlineText = trendEx ? EX_HEADLINE : headline;

  // Your Days Compared — real behavioural difference between high/low energy days when we
  // have enough of both, else example data as a Preview.
  const daysReal = daysCompared.hasData;
  const daysPreview = !demo && !daysReal;
  const betterList = demo || !daysReal ? EX_BETTER : daysCompared.better;
  const lowList = demo || !daysReal ? EX_LOWER : daysCompared.low;

  // Discoveries — need enough co-occurrence data (may be empty even with some reflections).
  const discPreview = !demo && discoveries.length === 0;
  const shownDiscoveries = demo || discoveries.length === 0 ? EX_DISCOVERIES : discoveries;

  // Energy dips — need a few nights that actually logged dips.
  const realDips = facts.dipsDist && facts.dipsDist.morning + facts.dipsDist.afternoon + facts.dipsDist.evening > 0 ? facts.dipsDist : null;
  const dipsPreview = !demo && !realDips;
  const dips = demo || !realDips ? EX_DIPS : realDips;

  // Compared to last week — needs two weeks of data.
  const realChanges = facts.changes && facts.changes.length ? facts.changes : null;
  const changesPreview = !demo && !realChanges;
  const changes = demo || !realChanges ? EX_CHANGES : realChanges;

  // Habits that stuck — independent of reflections; needs a completed, kept habit.
  const habitsPreview = !demo && keptHabits.length === 0;
  const habits = demo || keptHabits.length === 0 ? EX_HABITS : keptHabits;

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 safe-top">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">Patterns</h1>
          <p className="mt-1 text-sm text-muted/70">What seems to affect how you feel</p>
          {preview && (
            <div className="mt-2 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] text-primary/80">
              Do 3 nightly check-ins to unlock your real patterns
            </div>
          )}
        </header>

        {/* Headline clue, in the coach's voice */}
        <Card className="relative" style={riseIn(ready, 0)}>
          <div className="flex items-start gap-3">
            <div className="-mt-1 shrink-0"><WyaaAvatar size={40} /></div>
            <div>
              <p className="text-[15px] font-medium leading-relaxed text-ink/90">{headlineText}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[11px] font-medium text-primary/70">— Coach</span>
                {preview && <span className="text-[10px] font-semibold uppercase tracking-wide text-primary/60">Preview</span>}
              </div>
            </div>
          </div>
        </Card>

        {/* Discoveries */}
        {shownDiscoveries.length > 0 && (
          <Card className="mt-6" style={riseIn(ready, 1)}>
            <Eyebrow preview={discPreview}>What The Coach Is Noticing</Eyebrow>
            <div className="mt-3 space-y-2.5">
              {shownDiscoveries.map((d, i) => (
                <div key={i} className="rounded-xl border border-primary/15 bg-primary/[0.05] px-3 py-2.5">
                  <p className="text-sm text-ink/90">{d.text}</p>
                  <span className="mt-1.5 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary/70">Confidence: {d.confidence}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted/50">These are associations in your check-ins, not proven causes.</p>
          </Card>
        )}

        {/* Energy trend */}
        <Card className="mt-6" style={riseIn(ready, 2)}>
          <Eyebrow preview={preview}>Your Energy Lately</Eyebrow>
          <p className="mt-2 text-sm text-ink/80">
            {trendEx ? (
              <>Your <span className="font-semibold text-ink">energy held up well</span> this week.</>
            ) : facts.energyPhrase ? (
              <>Your <span className="font-semibold text-ink">{facts.energyPhrase}</span> this week.</>
            ) : (
              <><span className="font-semibold text-ink">{facts.week.filter((d) => d.energy === "low").length} low-energy days</span> this week.</>
            )}
          </p>
          <div className="mt-3 flex items-end justify-between">
            {weekCells.map((d, i) => (
              <div key={d.key} className="flex flex-col items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${d.energy ? REFLECTION_DOT[d.energy] : "border border-ink/15"}`} style={{ opacity: ready ? 1 : 0, transform: ready ? "scale(1)" : "scale(0.3)", transition: `opacity 900ms ease ${i * 180}ms, transform 900ms cubic-bezier(0.34,1.56,0.64,1) ${i * 180}ms` }} />
                <span className="text-[10px] text-muted/60">{d.label}</span>
              </div>
            ))}
          </div>
          {DOT_LEGEND}
        </Card>

        {/* What tends to help vs not — behavioral comparison (preview until we compute it) */}
        <Card className="mt-6" style={riseIn(ready, 3)}>
          <Eyebrow preview={daysPreview}>Your Days Compared</Eyebrow>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-dark/80">Better Days</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/70">Low-Energy Days</p>
            <ul className="space-y-1.5">
              {betterList.map((d) => (
                <li key={d} className="flex items-start gap-2 text-[13px] text-ink/80">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary-dark/15 text-primary-dark">
                    <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4L19 7" /></svg>
                  </span>
                  {d}
                </li>
              ))}
            </ul>
            <ul className="space-y-1.5">
              {lowList.map((d) => (
                <li key={d} className="flex items-start gap-2 text-[13px] text-ink/80">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink/[0.08] text-ink/45">
                    <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v5M12 16.5v.5" /></svg>
                  </span>
                  {d}
                </li>
              ))}
            </ul>
          </div>
        </Card>

        {/* When energy dips */}
        {(
          <Card className="mt-6" style={riseIn(ready, 4)}>
            <Eyebrow preview={dipsPreview}>When Your Energy Dips</Eyebrow>
            <p className="mt-1 text-sm text-muted/65">Across your last {dips.days} nights.</p>
            <div className="mt-4 space-y-2.5">
              {([["Morning", dips.morning], ["Afternoon", dips.afternoon], ["Evening", dips.evening]] as [string, number][]).map(([label, count], i) => {
                const max = Math.max(dips.morning, dips.afternoon, dips.evening, 1);
                return (
                  <div key={label} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-muted/65">{label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/5">
                      <div className="h-full rounded-full bg-primary" style={{ width: ready ? `${Math.round((count / max) * 100)}%` : "0%", transition: `width 1400ms cubic-bezier(0.22,1,0.36,1) ${i * 200}ms` }} />
                    </div>
                    <span className="w-4 shrink-0 text-right text-[11px] font-medium text-ink/70">{count}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Compared to last week */}
        {(
          <Card className="mt-6" style={riseIn(ready, 5)}>
            <Eyebrow preview={changesPreview}>Compared To Last Week</Eyebrow>
            <div className="mt-3 space-y-2">
              {changes.map((c) => (
                <div key={c.key} className="flex items-center gap-2.5">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink/[0.04] ${CHANGE_VERB[c.dir].cls}`}>
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d={CHANGE_VERB[c.dir].arrow} /></svg>
                  </span>
                  <span className="text-sm text-ink/80"><span className="font-semibold text-ink">{c.label}</span> {CHANGE_VERB[c.dir].verb}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Habits that stuck */}
        {(
          <Card className="mt-6" style={riseIn(ready, 6)}>
            <Eyebrow preview={habitsPreview}>Habits That Stuck</Eyebrow>
            <p className="mt-1 text-sm text-muted/65">The ones you decided were worth keeping.</p>
            <div className="mt-3 space-y-2">
              {habits.map((h) => (
                <div key={h.templateId + h.finishedAt} className="flex items-center justify-between gap-2 rounded-xl border border-primary/15 bg-primary/[0.05] px-3 py-2.5">
                  <p className="text-sm font-semibold text-ink">{h.title}</p>
                  <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${KEEP_CHIP[h.keep as "yes" | "maybe"].cls}`}>{KEEP_CHIP[h.keep as "yes" | "maybe"].label}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <p className="mt-4 px-1 text-[11px] leading-relaxed text-muted/50">
          {preview
            ? "This is a preview. Do your nightly check-ins and these become your real patterns."
            : "These are observations from your data, not medical advice. The more you log and check in, the sharper they get."}
        </p>
      </div>
      <BottomNav current="patterns" />
    </div>
  );
}
