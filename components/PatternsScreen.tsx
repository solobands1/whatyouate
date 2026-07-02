"use client";

import { useEffect, useMemo, useState } from "react";
import BottomNav from "./BottomNav";
import Card from "./Card";
import WyaaAvatar from "./WyaaAvatar";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import { hasEnoughDataForPatterns } from "../lib/trial";
import { riseIn } from "../lib/motion";
import { computeReflectionFacts, REFLECTION_DOT, type ReflectionFacts } from "../lib/reflectionFacts";

// A real, deterministic one-line clue in the coach's voice — only ever states true counts.
function patternsHeadline(facts: ReflectionFacts): string {
  if (facts.watch) return `${facts.watch.label} has been your low point lately, low on ${facts.watch.low} of the last ${facts.watch.n} nights.`;
  if (facts.dip && !("none" in facts.dip)) return `Your energy dips most in the ${facts.dip.time.toLowerCase()}, ${facts.dip.count} of the last ${facts.dip.days} nights.`;
  if (facts.energyPhrase) return `Your ${facts.energyPhrase} this week.`;
  return "Your check-ins are starting to build a picture. The clearer patterns will show up here.";
}

// Chips for the post-habit "keep this up?" answer, shown on "Habits That Stuck".
const KEEP_CHIP: Record<"yes" | "maybe", { label: string; cls: string }> = {
  yes: { label: "Keeping It", cls: "bg-primary-dark/15 text-primary-dark" },
  maybe: { label: "Might Keep", cls: "bg-primary/15 text-primary" },
};

// Sub-metrics shown as weekly strips (energy has its own card above).
const TREND_METRICS: { key: string; label: string }[] = [
  { key: "sleep", label: "Sleep" },
  { key: "mood", label: "Mood" },
  { key: "stress", label: "Stress" },
  { key: "digestion", label: "Digestion" },
];
const CHANGE_VERB: Record<"up" | "down" | "same", { verb: string; cls: string; arrow: string }> = {
  up: { verb: "improved", cls: "text-primary-dark", arrow: "M5 15l7-7 7 7" },
  down: { verb: "slipped", cls: "text-ink/45", arrow: "M19 9l-7 7-7-7" },
  same: { verb: "held steady", cls: "text-muted/60", arrow: "M5 12h14" },
};

export default function PatternsScreen() {
  const { user } = useAuth();
  const { meals, reflections, habitHistory } = useAppData();
  const facts = useMemo(() => computeReflectionFacts(reflections), [reflections]);
  const energyDays = facts.week.filter((d) => d.energy !== null);
  const lowDays = facts.week.filter((d) => d.energy === "low").length;
  const headline = useMemo(() => patternsHeadline(facts), [facts]);
  const keptHabits = useMemo(() => {
    const seen = new Set<string>();
    return habitHistory
      .filter((h) => h.keep === "yes" || h.keep === "maybe")
      .sort((a, b) => (b.finishedAt || "").localeCompare(a.finishedAt || ""))
      .filter((h) => { const k = h.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }, [habitHistory]);
  const [isDemoMode, setIsDemoMode] = useState(false);
  // Flips true just after mount so bars/dots animate in from zero on load.
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

  const hasEnough = isDemoMode || hasEnoughDataForPatterns(meals);

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 safe-top">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">Patterns</h1>
          <p className="mt-1 text-sm text-muted/70">What seems to affect how you feel</p>
        </header>

        {!hasEnough ? (
          /* Honest early state until there's enough data to find anything real. */
          <Card className="flex flex-col items-center py-10 text-center">
            <WyaaAvatar size={64} />
            <p className="mt-5 text-base font-semibold text-ink">Still learning your patterns</p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted/70">
              As you log meals and do your nightly check-ins, the coach starts connecting what you eat and do to how you feel. Your first clues will show up here.
            </p>
          </Card>
        ) : (
          <>
            {/* Headline clue, in the coach's voice */}
            <Card className="relative" style={riseIn(ready, 0)}>
              <div className="flex items-start gap-3">
                <div className="-mt-1 shrink-0">
                  <WyaaAvatar size={40} />
                </div>
                <div>
                  <p className="text-[15px] font-medium leading-relaxed text-ink/90">{headline}</p>
                  <div className="mt-2">
                    <span className="text-[11px] font-medium text-primary/70">— Coach</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Energy trend */}
            <Card className="mt-6" style={riseIn(ready, 1)}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Your Energy Lately</p>
              <p className="mt-2 text-sm text-ink/80">
                {energyDays.length === 0 ? (
                  "Do your nightly check-ins to start seeing your energy here."
                ) : facts.energyPhrase ? (
                  <>Your <span className="font-semibold text-ink">{facts.energyPhrase}</span> this week.</>
                ) : (
                  <><span className="font-semibold text-ink">{lowDays} low-energy {lowDays === 1 ? "day" : "days"}</span> this week.</>
                )}
              </p>
              <div className="mt-3 flex items-end justify-between">
                {facts.week.map((d, i) => (
                  <div key={d.key} className="flex flex-col items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${d.energy ? REFLECTION_DOT[d.energy] : "border border-ink/15"}`} style={{ opacity: ready ? 1 : 0, transform: ready ? "scale(1)" : "scale(0.3)", transition: `opacity 900ms ease ${i * 180}ms, transform 900ms cubic-bezier(0.34,1.56,0.64,1) ${i * 180}ms` }} />
                    <span className="text-[10px] text-muted/60">{d.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1 text-[10px] text-muted/60"><span className="h-2 w-2 rounded-full bg-primary" /> High</span>
                <span className="flex items-center gap-1 text-[10px] text-muted/60"><span className="h-2 w-2 rounded-full bg-primary/35" /> Average</span>
                <span className="flex items-center gap-1 text-[10px] text-muted/60"><span className="h-2 w-2 rounded-full bg-ink/25" /> Low</span>
              </div>
            </Card>

            {/* This week's other trends — real reflection data */}
            {facts.total > 0 && (
              <Card className="mt-6" style={riseIn(ready, 2)}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">This Week</p>
                <div className="mt-3 space-y-2.5">
                  {TREND_METRICS.map((m) => (
                    <div key={m.key} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-xs text-muted/65">{m.label}</span>
                      <div className="flex flex-1 items-center justify-between">
                        {(facts.metricWeeks[m.key] ?? []).map((lvl, i) => (
                          <span key={i} className={`h-2.5 w-2.5 rounded-full ${lvl ? REFLECTION_DOT[lvl] : "border border-ink/15"}`} style={{ opacity: ready ? 1 : 0, transform: ready ? "scale(1)" : "scale(0.3)", transition: `opacity 800ms ease ${i * 90}ms, transform 800ms cubic-bezier(0.34,1.56,0.64,1) ${i * 90}ms` }} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-1 text-[10px] text-muted/60"><span className="h-2 w-2 rounded-full bg-primary" /> Good</span>
                  <span className="flex items-center gap-1 text-[10px] text-muted/60"><span className="h-2 w-2 rounded-full bg-primary/35" /> Okay</span>
                  <span className="flex items-center gap-1 text-[10px] text-muted/60"><span className="h-2 w-2 rounded-full bg-ink/25" /> Low</span>
                </div>
              </Card>
            )}

            {/* When energy dips — real distribution */}
            {facts.dipsDist && (facts.dipsDist.morning + facts.dipsDist.afternoon + facts.dipsDist.evening > 0) && (
              <Card className="mt-6" style={riseIn(ready, 3)}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">When Your Energy Dips</p>
                <p className="mt-1 text-sm text-muted/65">Across your last {facts.dipsDist.days} nights.</p>
                <div className="mt-4 space-y-2.5">
                  {([["Morning", facts.dipsDist.morning], ["Afternoon", facts.dipsDist.afternoon], ["Evening", facts.dipsDist.evening]] as [string, number][]).map(([label, count], i) => {
                    const max = Math.max(facts.dipsDist!.morning, facts.dipsDist!.afternoon, facts.dipsDist!.evening, 1);
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

            {/* What changed vs last week — real deltas */}
            {facts.changes && (
              <Card className="mt-6" style={riseIn(ready, 4)}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Compared To Last Week</p>
                <div className="mt-3 space-y-2">
                  {facts.changes.map((c) => (
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

            {/* Habits that stuck — real, from the post-habit "keep this up?" answer */}
            {keptHabits.length > 0 && (
              <Card className="mt-6" style={riseIn(ready, 5)}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Habits That Stuck</p>
                <p className="mt-1 text-sm text-muted/65">The ones you decided were worth keeping.</p>
                <div className="mt-3 space-y-2">
                  {keptHabits.map((h) => (
                    <div key={h.templateId + h.finishedAt} className="flex items-center justify-between gap-2 rounded-xl border border-primary/15 bg-primary/[0.05] px-3 py-2.5">
                      <p className="text-sm font-semibold text-ink">{h.title}</p>
                      <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${KEEP_CHIP[h.keep as "yes" | "maybe"].cls}`}>{KEEP_CHIP[h.keep as "yes" | "maybe"].label}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <p className="mt-4 px-1 text-[11px] leading-relaxed text-muted/50">
              These are observations from your data, not medical advice. The more you log and check in, the sharper they get.
            </p>
          </>
        )}
      </div>
      <BottomNav current="patterns" />
    </div>
  );
}
