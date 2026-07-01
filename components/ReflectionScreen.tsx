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

type Level = "good" | "ok" | "low";
const DOT: Record<Level, string> = { good: "bg-emerald-500", ok: "bg-amber-400", low: "bg-rose-500" };

// Map an answer index to a good/ok/low band. Stress is inverted (None is good).
function levelFor(key: string, idx: number): Level {
  if (key === "energy") return idx <= 1 ? "low" : idx === 2 ? "ok" : "good";
  if (key === "stress") return idx === 0 ? "good" : idx <= 2 ? "ok" : "low";
  return idx === 0 ? "low" : idx === 1 ? "ok" : "good"; // sleep / mood / digestion
}

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

  // Newest first.
  const sorted = useMemo(
    () => (entries ? [...entries].sort((a, b) => b.date.localeCompare(a.date)) : []),
    [entries],
  );

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
          <h1 className="text-2xl font-semibold text-ink">Nightly Check-ins</h1>
          <p className="mt-1 text-sm text-muted/70">How you&apos;ve felt over time, from your nightly reflections</p>
        </header>

        <section style={riseIn(barsReady, 0)}>
          <p className="mb-2 px-1 text-xs uppercase tracking-wide text-muted/70">History</p>

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
                <p className="mt-3 text-sm font-semibold text-ink">No reflections yet</p>
                <p className="mt-1 max-w-[16rem] text-xs text-muted/65">Your nightly check-ins will show up here so you can see how you&apos;ve been feeling over time.</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              {sorted.map((entry) => {
                const dips = dipsText(entry.answers.dips);
                return (
                  <Card key={entry.date}>
                    <div className="flex items-baseline justify-between">
                      <p className="text-sm font-semibold text-ink">{relLabel(entry.date)}</p>
                      <p className="text-[11px] text-muted/55">{fullDate(entry.date)}</p>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {METRICS.map((m) => {
                        const idx = entry.answers[m.key];
                        if (typeof idx !== "number") return null;
                        return (
                          <div key={m.key} className="flex items-center gap-2.5">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[levelFor(m.key, idx)]}`} />
                            <span className="w-20 shrink-0 text-xs text-muted/65">{m.label}</span>
                            <span className="text-xs font-medium text-ink">{m.opts[idx]}</span>
                          </div>
                        );
                      })}
                      {dips && (
                        <div className="flex items-center gap-2.5">
                          <span className="h-2 w-2 shrink-0 rounded-full bg-ink/20" />
                          <span className="w-20 shrink-0 text-xs text-muted/65">Dips</span>
                          <span className="text-xs font-medium text-ink">{dips}</span>
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
          )}
        </section>
      </div>
      <BottomNav current="summary" />
    </div>
  );
}
