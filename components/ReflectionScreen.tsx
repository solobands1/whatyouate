"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { riseIn } from "../lib/motion";
import BottomNav from "./BottomNav";
import Card from "./Card";
import { useAppData } from "./AppDataProvider";
import { computeReflectionFacts, levelFor, REFLECTION_METRICS, REFLECTION_DIPS_OPTS, REFLECTION_DOT } from "../lib/reflectionFacts";

// Display-only helpers (the derivation lives in lib/reflectionFacts).
function relLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fullDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function dipsText(v: number | number[] | undefined): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const times = v.filter((i) => i > 0).map((i) => REFLECTION_DIPS_OPTS[i]).filter(Boolean);
  return times.length ? times.join(", ") : "None";
}

function Legend({ withMissed }: { withMissed?: boolean }) {
  const items: [string, string][] = [["bg-primary", "Good"], ["bg-primary/35", "Okay"], ["bg-ink/25", "Low"]];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map(([c, l]) => (
        <span key={l} className="flex items-center gap-1.5 text-[10px] text-muted/60">
          <span className={`h-2 w-2 rounded-full ${c}`} /> {l}
        </span>
      ))}
      {withMissed && (
        <span className="flex items-center gap-1.5 text-[10px] text-muted/60">
          <span className="h-2 w-2 rounded-full border border-ink/25" /> Missed
        </span>
      )}
    </div>
  );
}

export default function ReflectionScreen() {
  const router = useRouter();
  const { reflections, loading } = useAppData();
  const [barsReady, setBarsReady] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setBarsReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const sorted = useMemo(() => [...reflections].sort((a, b) => b.date.localeCompare(a.date)), [reflections]);
  const facts = useMemo(() => computeReflectionFacts(reflections), [reflections]);

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 safe-top">
        <header className="mb-6">
          <button
            type="button"
            onClick={() => router.push("/summary")}
            className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted/70 transition active:opacity-60"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Insights
          </button>
          <h1 className="text-2xl font-semibold text-ink">Reflections</h1>
          <p className="mt-1 text-sm text-muted/70">Your nightly reflections and how you&apos;ve felt.</p>
        </header>

        {loading && sorted.length === 0 ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-ink/[0.04]" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <Card>
            <div className="flex flex-col items-center py-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" /></svg>
              </span>
              <p className="mt-3 text-sm font-semibold text-ink">No Reflections Yet</p>
              <p className="mt-1 max-w-[16rem] text-xs text-muted/65">Your nightly reflections will show up here so you can see how you&apos;ve been feeling over time.</p>
            </div>
          </Card>
        ) : (
          <>
            {/* Signals — a couple of interpretations above the raw history. */}
            <section style={riseIn(barsReady, 0)} className="space-y-3">
              {/* This week: one strip that carries both consistency (solid vs hollow) and
                  energy level (dot colour). */}
              <Card>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">This Week</p>
                  {facts.streak >= 2 && (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      {facts.streak}-night streak
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-start justify-between">
                  {facts.week.map((d, i) => (
                    <div key={d.key} className="flex flex-col items-center gap-1.5">
                      <span
                        className={`h-3 w-3 rounded-full ${d.done ? (d.energy ? REFLECTION_DOT[d.energy] : "bg-primary/50") : "border-2 border-ink/15"} ${d.isToday ? "ring-2 ring-primary/25 ring-offset-1 ring-offset-white" : ""}`}
                        style={{ opacity: barsReady ? 1 : 0, transform: barsReady ? "scale(1)" : "scale(0.3)", transition: `opacity 700ms ease ${250 + i * 80}ms, transform 700ms cubic-bezier(0.34,1.56,0.64,1) ${250 + i * 80}ms` }}
                      />
                      <p className={`text-[10px] ${d.isToday ? "font-bold text-ink/80" : "text-muted/60"}`}>{d.label}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm text-ink/80">
                  <span className="font-semibold text-ink">Reflected {facts.reflectedCount} of 7</span>
                  <span className="text-muted/70"> nights{facts.energyPhrase ? ` · ${facts.energyPhrase}` : " this week"}.</span>
                </p>
                <div className="mt-2.5"><Legend withMissed /></div>
              </Card>

              {/* What stands out */}
              {facts.hasSignals && (facts.dip || facts.watch) && (
                <Card>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Worth Noting</p>
                  <div className="mt-2 space-y-1.5">
                    {facts.dip && (
                      "none" in facts.dip ? (
                        <p className="text-sm text-ink">No real energy dips lately, nice.</p>
                      ) : (
                        <p className="text-sm text-ink">You dip most in the <span className="font-semibold">{facts.dip.time.toLowerCase()}</span><span className="text-muted/65"> — {facts.dip.count} of the last {facts.dip.days} nights.</span></p>
                      )
                    )}
                    {facts.watch && (
                      <p className="text-sm text-ink"><span className="font-semibold">{facts.watch.label}</span> has been low<span className="text-muted/65"> on {facts.watch.low} of the last {facts.watch.n} nights.</span></p>
                    )}
                  </div>
                </Card>
              )}
            </section>

            {/* History — the raw timeline. */}
            <section className="mt-7">
              <div className="mb-2 flex items-center justify-between px-1" style={riseIn(barsReady, 1)}>
                <p className="text-xs uppercase tracking-wide text-muted/70">History</p>
                <Legend />
              </div>
              <div className="space-y-3">
                {sorted.map((entry, idx) => {
                  const dips = dipsText(entry.answers.dips);
                  return (
                    <Card key={entry.date} style={riseIn(barsReady, 2 + Math.min(idx, 4))}>
                      <div className="flex items-baseline justify-between">
                        <p className="text-sm font-semibold text-ink">{relLabel(entry.date)}</p>
                        <p className="text-[11px] text-muted/55">{fullDate(entry.date)}</p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                        {REFLECTION_METRICS.map((m) => {
                          const idx = entry.answers[m.key];
                          if (typeof idx !== "number") return null;
                          return (
                            <div key={m.key} className="flex items-center gap-1.5">
                              <span className={`h-2 w-2 shrink-0 rounded-full ${REFLECTION_DOT[levelFor(m.key, idx)]}`} />
                              <span className="text-xs text-muted/65">{m.label}</span>
                              <span className="text-xs font-medium text-ink">{m.opts[idx]}</span>
                            </div>
                          );
                        })}
                        {dips && (
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-ink/20" />
                            <span className="text-xs text-muted/65">Dips</span>
                            <span className="truncate text-xs font-medium text-ink">{dips}</span>
                          </div>
                        )}
                      </div>
                      {entry.note?.trim() && (
                        <p className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2 text-xs leading-relaxed text-ink/70">{entry.note}</p>
                      )}
                    </Card>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
      <BottomNav current="summary" />
    </div>
  );
}
