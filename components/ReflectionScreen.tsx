"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { riseIn } from "../lib/motion";
import BottomNav from "./BottomNav";
import Card from "./Card";
import { useAuth } from "./AuthProvider";
import { fetchReflections } from "../lib/supabaseDb";
import type { ReflectionEntry } from "../lib/habitState";

// Metric metadata mirrors REFLECTION_QUESTIONS in HomeScreen. Kept local so this screen
// stays self-contained. `opts` index maps to the stored answer number.
const METRICS: { key: string; label: string; opts: string[] }[] = [
  { key: "energy", label: "Energy", opts: ["Drained", "Low", "Okay", "Good", "Great"] },
  { key: "sleep", label: "Sleep", opts: ["Poor", "Okay", "Good", "Great"] },
  { key: "mood", label: "Mood", opts: ["Poor", "Okay", "Good", "Great"] },
  { key: "stress", label: "Stress", opts: ["None", "Mild", "Moderate", "High"] },
  { key: "digestion", label: "Digestion", opts: ["Poor", "Okay", "Good", "Great"] },
];
const DIPS_OPTS = ["None", "Morning", "Afternoon", "Evening"];
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

// Dark blue / light blue / grey — matches "Your Energy Lately" on the Patterns page.
type Level = "good" | "ok" | "low";
const DOT: Record<Level, string> = { good: "bg-primary", ok: "bg-primary/35", low: "bg-ink/25" };

// Map an answer index to a good/ok/low band. Stress is inverted (None is good).
function levelFor(key: string, idx: number): Level {
  if (key === "energy") return idx <= 1 ? "low" : idx === 2 ? "ok" : "good";
  if (key === "stress") return idx === 0 ? "good" : idx <= 2 ? "ok" : "low";
  return idx === 0 ? "low" : idx === 1 ? "ok" : "good"; // sleep / mood / digestion
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function dateKey(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

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
  const times = v.filter((i) => i > 0).map((i) => DIPS_OPTS[i]).filter(Boolean);
  return times.length ? times.join(", ") : "None";
}

// ── Derived signals (all guarded on real data, shown with real counts) ───────
function recentWithin(sorted: ReflectionEntry[], days: number): ReflectionEntry[] {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  return sorted.filter((e) => new Date(e.date + "T00:00:00") >= cutoff);
}

// Last 7 calendar days, oldest→newest, with weekday label + whether a reflection exists.
function last7Days(sorted: ReflectionEntry[]) {
  const byDate = new Map(sorted.map((e) => [e.date, e]));
  const out: { key: string; label: string; isToday: boolean; energy: Level | null; done: boolean }[] = [];
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

// Short fragment (not a full sentence) so it can tack onto the "Reflected X of 7" line.
function energyPhrase(levels: (Level | null)[]): string | null {
  const vals = levels.filter((l): l is Level => l !== null);
  if (vals.length < 3) return null;
  const good = vals.filter((l) => l === "good").length;
  const low = vals.filter((l) => l === "low").length;
  if (good >= Math.ceil(vals.length * 0.6)) return "energy held up well";
  if (low >= Math.ceil(vals.length * 0.5)) return "energy ran low";
  return "energy was up and down";
}

function dipSignal(recent: ReflectionEntry[]): { time: string; count: number; days: number } | { none: true } | null {
  const counts = [0, 0, 0, 0];
  let days = 0;
  recent.forEach((e) => {
    const v = e.answers.dips;
    if (Array.isArray(v)) { days++; v.forEach((i) => { if (i > 0 && i < 4) counts[i]++; }); }
  });
  if (days < 3) return null;
  const max = Math.max(counts[1], counts[2], counts[3]);
  if (max === 0) return { none: true };
  return { time: DIPS_OPTS[counts.indexOf(max)], count: max, days };
}

function watchArea(recent: ReflectionEntry[]): { label: string; low: number; n: number } | null {
  let worst: { label: string; low: number; n: number } | null = null;
  for (const m of METRICS) {
    let low = 0, n = 0;
    recent.forEach((e) => {
      const idx = e.answers[m.key];
      if (typeof idx === "number") { n++; if (levelFor(m.key, idx) === "low") low++; }
    });
    if (n >= 3 && low >= 2 && (!worst || low > worst.low)) worst = { label: m.label, low, n };
  }
  return worst;
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
  const { user } = useAuth();
  const [entries, setEntries] = useState<ReflectionEntry[] | null>(null);
  const [barsReady, setBarsReady] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setBarsReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchReflections(user.id)
      .then((rows) => { if (!cancelled) setEntries(rows); })
      .catch(() => { if (!cancelled) setEntries([]); });
    return () => { cancelled = true; };
  }, [user]);

  const sorted = useMemo(
    () => (entries ? [...entries].sort((a, b) => b.date.localeCompare(a.date)) : []),
    [entries],
  );

  const week = useMemo(() => last7Days(sorted), [sorted]);
  const reflectedCount = week.filter((d) => d.done).length;
  const energyPhrase7 = useMemo(() => energyPhrase(week.map((d) => d.energy)), [week]);
  const stands = useMemo(() => {
    if (sorted.length < 3) return null;
    const recent = recentWithin(sorted, 14);
    return { dip: dipSignal(recent), watch: watchArea(recent) };
  }, [sorted]);

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
          <p className="mt-1 text-sm text-muted/70">How you&apos;ve felt over time, from your nightly reflections</p>
        </header>

        {entries === null ? (
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
                <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">This Week</p>
                <div className="mt-3 flex items-start justify-between">
                  {week.map((d, i) => (
                    <div key={d.key} className="flex flex-col items-center gap-1.5">
                      <span
                        className={`h-3 w-3 rounded-full ${d.done ? (d.energy ? DOT[d.energy] : "bg-primary/50") : "border-2 border-ink/15"}`}
                        style={{ opacity: barsReady ? 1 : 0, transform: barsReady ? "scale(1)" : "scale(0.3)", transition: `opacity 700ms ease ${250 + i * 80}ms, transform 700ms cubic-bezier(0.34,1.56,0.64,1) ${250 + i * 80}ms` }}
                      />
                      <p className={`text-[10px] ${d.isToday ? "font-bold text-ink/80" : "text-muted/60"}`}>{d.label}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm text-ink/80">
                  <span className="font-semibold text-ink">Reflected {reflectedCount} of 7</span>
                  <span className="text-muted/70"> nights{energyPhrase7 ? ` · ${energyPhrase7}` : " this week"}.</span>
                </p>
                <div className="mt-2.5"><Legend withMissed /></div>
              </Card>

              {/* What stands out */}
              {stands && (stands.dip || stands.watch) && (
                <Card>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Worth Noting</p>
                  <div className="mt-2 space-y-1.5">
                    {stands.dip && (
                      "none" in stands.dip ? (
                        <p className="text-sm text-ink">No real energy dips lately, nice.</p>
                      ) : (
                        <p className="text-sm text-ink">You dip most in the <span className="font-semibold">{stands.dip.time.toLowerCase()}</span><span className="text-muted/65"> — {stands.dip.count} of the last {stands.dip.days} nights.</span></p>
                      )
                    )}
                    {stands.watch && (
                      <p className="text-sm text-ink"><span className="font-semibold">{stands.watch.label}</span> has been low<span className="text-muted/65"> on {stands.watch.low} of the last {stands.watch.n} nights.</span></p>
                    )}
                  </div>
                </Card>
              )}
            </section>

            {/* History — the raw timeline. */}
            <section style={riseIn(barsReady, 1)} className="mt-7">
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-xs uppercase tracking-wide text-muted/70">History</p>
                <Legend />
              </div>
              <div className="space-y-3">
                {sorted.map((entry) => {
                  const dips = dipsText(entry.answers.dips);
                  return (
                    <Card key={entry.date}>
                      <div className="flex items-baseline justify-between">
                        <p className="text-sm font-semibold text-ink">{relLabel(entry.date)}</p>
                        <p className="text-[11px] text-muted/55">{fullDate(entry.date)}</p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                        {METRICS.map((m) => {
                          const idx = entry.answers[m.key];
                          if (typeof idx !== "number") return null;
                          return (
                            <div key={m.key} className="flex items-center gap-1.5">
                              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[levelFor(m.key, idx)]}`} />
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
