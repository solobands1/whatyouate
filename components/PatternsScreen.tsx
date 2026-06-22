"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BottomNav from "./BottomNav";
import Card from "./Card";
import WyaaAvatar from "./WyaaAvatar";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import { hasEnoughDataForPatterns } from "../lib/trial";

// Sample/placeholder content until the pattern engine + persisted reflections exist.
const FACTORS = [
  { label: "Hydration", strength: 0.9 },
  { label: "Sleep Consistency", strength: 0.72 },
  { label: "Protein At Breakfast", strength: 0.58 },
];

const HABITS: { title: string; result: string; tone: "great" | "good" | "neutral" }[] = [
  { title: "Walk After Lunch", result: "Helped A Lot", tone: "great" },
  { title: "Hydration", result: "Helped", tone: "good" },
  { title: "Protein At Breakfast", result: "Not Sure", tone: "neutral" },
];

const TONE_CHIP: Record<"great" | "good" | "neutral", string> = {
  great: "bg-emerald-500/15 text-emerald-600",
  good: "bg-primary/15 text-primary",
  neutral: "bg-ink/[0.08] text-ink/55",
};

// Behaviour/timing differences (kept distinct from the ranked factors above).
const BETTER_DAYS = ["Breakfast before 9am", "A walk or workout", "In bed before 11pm", "Steady meals through the day"];
const LOWER_DAYS = ["First meal after noon", "Caffeine after 2pm", "Long gaps without eating", "Little movement"];

// The uncertain frontier — things still being investigated, not the confident findings above.
const CLUES: { text: string; confidence: string; habit: string }[] = [
  { text: "Iron-rich foods have been lower on your low-energy days.", confidence: "Moderate", habit: "iron" },
  { text: "Afternoon dips have lined up with later, heavier lunches.", confidence: "Building", habit: "lunch timing" },
];

// 7-day energy trend (sample).
const ENERGY_WEEK: ("high" | "avg" | "low")[] = ["avg", "high", "low", "avg", "high", "high", "avg"];
const ENERGY_DAY_LABELS = ["T", "W", "T", "F", "S", "S", "M"];
const ENERGY_DOT: Record<"high" | "avg" | "low", string> = {
  high: "bg-primary",
  avg: "bg-primary/35",
  low: "bg-amber-400/80",
};

export default function PatternsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { meals } = useAppData();
  const [isDemoMode, setIsDemoMode] = useState(false);

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
            <Card className="relative">
              <div className="flex items-start gap-3">
                <div className="-mt-1 shrink-0">
                  <WyaaAvatar size={40} />
                </div>
                <div>
                  <p className="text-[15px] font-medium leading-relaxed text-ink/90">Water keeps showing up on your better days. It&apos;s the clearest signal so far.</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-primary/70">— Coach</span>
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary/70">Confidence: Building</span>
                  </div>
                </div>
              </div>
            </Card>

            {/* Energy trend */}
            <Card className="mt-6">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Your Energy Lately</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                  <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 15l7-7 7 7" /></svg>
                  Improving
                </span>
              </div>
              <p className="mt-2 text-sm text-ink/80"><span className="font-semibold text-ink">2 Low-Energy Days</span> this week, down from 4 last week.</p>
              <div className="mt-3 flex items-end justify-between">
                {ENERGY_WEEK.map((lvl, i) => (
                  <div key={i} className="flex flex-col items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${ENERGY_DOT[lvl]}`} />
                    <span className="text-[10px] text-muted/60">{ENERGY_DAY_LABELS[i]}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1 text-[10px] text-muted/60"><span className="h-2 w-2 rounded-full bg-primary" /> High</span>
                <span className="flex items-center gap-1 text-[10px] text-muted/60"><span className="h-2 w-2 rounded-full bg-primary/35" /> Average</span>
                <span className="flex items-center gap-1 text-[10px] text-muted/60"><span className="h-2 w-2 rounded-full bg-amber-400/80" /> Low</span>
              </div>
            </Card>

            {/* What seems to matter most */}
            <Card className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">What Seems To Matter Most</p>
              <p className="mt-1 text-sm text-muted/65">The factors most linked to your better days.</p>
              <div className="mt-4 space-y-3.5">
                {FACTORS.map((f, i) => (
                  <div key={f.label} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">{i + 1}</span>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-ink">{f.label}</p>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/5">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(f.strength * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Best vs low-energy days */}
            <Card className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Your Days Compared</p>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600/80">Better Days</p>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600/80">Low-Energy Days</p>
                <ul className="space-y-1.5">
                  {BETTER_DAYS.map((d) => (
                    <li key={d} className="flex items-start gap-2 text-[13px] text-ink/80">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4L19 7" /></svg>
                      </span>
                      {d}
                    </li>
                  ))}
                </ul>
                <ul className="space-y-1.5">
                  {LOWER_DAYS.map((d) => (
                    <li key={d} className="flex items-start gap-2 text-[13px] text-ink/80">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
                        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v5M12 16.5v.5" /></svg>
                      </span>
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>

            {/* Potential clues */}
            <Card className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Potential Clues</p>
              <p className="mt-1 text-sm text-muted/65">Worth keeping an eye on, not conclusions yet.</p>
              <div className="mt-3 space-y-2.5">
                {CLUES.map((c) => (
                  <div key={c.text} className="rounded-xl border border-primary/15 bg-primary/[0.05] px-3 py-2.5">
                    <p className="text-sm text-ink/90">{c.text}</p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary/70">Confidence: {c.confidence}</span>
                      <button
                        type="button"
                        onClick={() => router.push("/")}
                        className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-primary/80 transition active:opacity-60"
                      >
                        Try as a habit
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Habit effectiveness */}
            <Card className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Habit Effectiveness</p>
              <p className="mt-1 text-sm text-muted/65">Whether the habits you tried actually helped.</p>
              <div className="mt-3 space-y-2">
                {HABITS.map((h) => (
                  <div key={h.title} className="flex items-center justify-between gap-2 rounded-xl border border-primary/15 bg-primary/[0.05] px-3 py-2.5">
                    <p className="text-sm font-semibold text-ink">{h.title}</p>
                    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE_CHIP[h.tone]}`}>{h.result}</span>
                  </div>
                ))}
              </div>
            </Card>

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
