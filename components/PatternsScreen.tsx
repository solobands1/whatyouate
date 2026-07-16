"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Joyride, { CallBackProps, STATUS, type Step } from "react-joyride";
import BottomNav from "./BottomNav";
import Card from "./Card";
import WyaaAvatar from "./WyaaAvatar";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import { riseIn } from "../lib/motion";
import { computeReflectionFacts, REFLECTION_DOT, type ReflectionFacts, type Level, type MetricChange } from "../lib/reflectionFacts";
import { computeDiscoveryCandidates } from "../lib/discoveries";
import { computeDaysCompared } from "../lib/dayCompare";
import { computeFoodFeelingLinks, type FoodFeelingLink } from "../lib/foodFeeling";
import { computeActiveChanges, type ActiveChange } from "../lib/changes";
import { getChangeStatuses, setChangeStatus } from "../lib/changeStatus";
import { useTrialStatus } from "../hooks/useTrialStatus";
import { openUpgradeModal } from "./UpgradeModal";

const METRIC_LABEL: Record<string, string> = { energy: "energy", sleep: "sleep", mood: "mood", stress: "stress", digestion: "digestion" };
function changeEffectLine(c: Pick<ActiveChange, "targetKey" | "effect">): string | null {
  if (!c.effect) return null;
  const m = METRIC_LABEL[c.targetKey] ?? "how you feel";
  if (c.effect.direction === "better") return `Your ${m} looks better since, about ${c.effect.beforePerWeek} to ${c.effect.afterPerWeek} low days a week.`;
  if (c.effect.direction === "worse") return `Your ${m} hasn't picked up since this yet.`;
  return `No clear change in ${m} yet.`;
}
// Example ledger for Preview / demo.
const EX_LEDGER: Pick<ActiveChange, "id" | "templateId" | "label" | "targetKey" | "keep" | "effect" | "stopped" | "regressed">[] = [
  { id: "exl1", templateId: "exl1", label: "Walk After Lunch", targetKey: "energy", keep: "yes", effect: { direction: "better", beforePerWeek: 4, afterPerWeek: 1, n: 12 }, stopped: false, regressed: false },
  { id: "exl2", templateId: "exl2", label: "Wind Down", targetKey: "sleep", keep: "yes", effect: null, stopped: false, regressed: false },
];

type Discovery = { text: string; confidence: "Building" | "Moderate" };

// A real, deterministic one-line clue in the coach's voice — only ever states true counts.
function patternsHeadline(facts: ReflectionFacts): string {
  if (facts.watch) return `${facts.watch.label} has been your low point lately, low on ${facts.watch.low} of the last ${facts.watch.n} nights.`;
  if (facts.dip && !("none" in facts.dip)) return `Your energy dips most in the ${facts.dip.time.toLowerCase()}, ${facts.dip.count} of the last ${facts.dip.days} nights.`;
  if (facts.energyPhrase) return `Your ${facts.energyPhrase} this week.`;
  return "Your reflections are starting to build a picture. The clearer patterns will show up here.";
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
  { text: "Your lower-stress days have more often come with a better mood.", confidence: "Building" },
  { text: "Your higher-stress days have often lined up with poorer sleep.", confidence: "Building" },
];
const EX_HEADLINE = "Your best-energy days have tended to follow nights you slept well.";
const EX_FOOD_LINKS: FoodFeelingLink[] = [
  { tag: "fried_greasy", label: "fried or greasy food", lag: "next_day", lowWith: 0.6, lowWithout: 0.2, nWith: 6, confidence: "Building" },
  { tag: "heavy_large", label: "a large, heavy meal", lag: "same_day", lowWith: 0.55, lowWithout: 0.25, nWith: 7, confidence: "Building" },
];
function foodLinkSentence(l: Pick<FoodFeelingLink, "label" | "lag">): string {
  return l.lag === "next_day"
    ? `Your lower-energy days have more often followed ${l.label} the night before.`
    : `On days with ${l.label}, your energy has more often run low.`;
}
// Preview insights for the unified coach card (one food link + one reflection discovery).
const EX_INSIGHTS: Discovery[] = [
  { text: foodLinkSentence(EX_FOOD_LINKS[0]), confidence: "Building" },
  EX_DISCOVERIES[0],
];
function Eyebrow({ children }: { children: React.ReactNode; preview?: boolean }) {
  // The "Example" tag was retired in favour of descriptive empty states; callers may still
  // pass `preview` (used elsewhere to decide empty-vs-real), it's just no longer rendered.
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">{children}</p>;
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
  const trial = useTrialStatus();
  const { reflections, habitHistory, meals, workouts, loading: loadingData } = useAppData();
  const facts = useMemo(() => computeReflectionFacts(reflections), [reflections]);
  const daysCompared = useMemo(() => computeDaysCompared(reflections, meals, workouts), [reflections, meals, workouts]);
  const foodLinks = useMemo(() => computeFoodFeelingLinks(meals, reflections), [meals, reflections]);
  const headline = useMemo(() => patternsHeadline(facts), [facts]);

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

  // Walkthrough: this page is the "Patterns" tab (/summary/insights). The Insights-hub tour
  // hands off here with stage "insights"; we show one step on the coach card, then go to Profile.
  const router = useRouter();
  const [runPatternsTour, setRunPatternsTour] = useState(false);
  const patternsTourSteps: Step[] = [
    {
      target: String.raw`[data-tour="patterns-intro"]`,
      placement: "bottom" as const,
      disableBeacon: true,
      content: (
        <div>
          <p style={{ fontWeight: 600, marginBottom: 10 }}>Welcome To Patterns</p>
          <p>This is where you&apos;ll see your longer-term patterns to help you understand what&apos;s affecting how you feel.</p>
          <p style={{ marginTop: 10 }}>Your Coach will highlight a few insights based on what you&apos;ve logged on this page. Check back in on this page frequently to learn more about your patterns.</p>
        </div>
      ),
    },
  ];
  useEffect(() => {
    if (!user) return;
    const active = localStorage.getItem(`wya_walkthrough_active_${user.id}`) === "true";
    const stage = localStorage.getItem(`wya_walkthrough_stage_${user.id}`);
    if (active && stage === "insights") {
      setIsDemoMode(true);
      const t = window.setTimeout(() => setRunPatternsTour(true), 400);
      return () => window.clearTimeout(t);
    }
  }, [user]);
  const handlePatternsTour = (data: CallBackProps) => {
    if (!user) return;
    const end = () => {
      localStorage.removeItem(`wya_demo_mode_${user.id}`);
      setIsDemoMode(false);
      localStorage.setItem(`wya_walkthrough_${user.id}`, "true");
      localStorage.removeItem(`wya_walkthrough_active_${user.id}`);
      localStorage.removeItem(`wya_walkthrough_stage_${user.id}`);
      setRunPatternsTour(false);
    };
    if (data.status === STATUS.SKIPPED) { end(); return; }
    if (data.type === "step:after" && data.index === patternsTourSteps.length - 1) {
      end();
      localStorage.setItem(`wya_walkthrough_profile_${user.id}`, "true");
      router.push("/profile");
    }
  };

  if (!user) return null;

  // Each card decides real-vs-preview from ITS OWN data (reflection volume for the trend
  // cards, completed habits for the habits card, etc.), so no card ever just disappears.
  // Example data + a "Preview" label until that card has enough; demo shows it unlabeled.
  const demo = isDemoMode;
  // Post-trial (walled) users keep their own data (energy views) but the coach's
  // food->feeling analysis is the paid product — locked, with the live connection count.
  const locked = !demo && trial.isFree;
  const connectionCount = foodLinks.length + discoveries.length;

  // Trend cards (headline, energy) need a few reflections before there's anything real.
  const fewRefl = facts.total < 3;
  // Non-demo shows the user's REAL week (empty days render as outline dots — no fake data);
  // demo shows the curated example.
  const weekCells = demo ? facts.week.map((d, i) => ({ ...d, energy: EX_LEVELS.energy[i] ?? null, done: true })) : facts.week;

  // Your Days Compared — real behavioural difference between high/low energy days when we
  // have enough of both. Empty (non-demo) shows placeholder pills, never fake items.
  const daysReal = daysCompared.hasData;
  const daysPreview = !demo && !daysReal;
  const betterList = demo ? EX_BETTER : daysReal ? daysCompared.better : [];
  const lowList = demo ? EX_LOWER : daysReal ? daysCompared.low : [];

  // Coach card: the headline plus up to 2 observed associations (food->feeling links +
  // reflection discoveries). Empty state describes what will appear instead of faking it.
  const realInsights: Discovery[] = [
    ...foodLinks.map((l) => ({ text: foodLinkSentence(l), confidence: l.confidence })),
    ...discoveries,
  ].slice(0, 2);
  const coachEmpty = !demo && realInsights.length === 0;
  const coachInsights = demo ? EX_INSIGHTS : realInsights; // non-demo: only real, never fake
  const coachHeadline = demo ? EX_HEADLINE : fewRefl ? "Your clearest pattern will land here first" : headline;

  // Energy dips — need a few nights that actually logged dips. Empty shows blank bars (0 of 0).
  const realDips = facts.dipsDist && facts.dipsDist.morning + facts.dipsDist.afternoon + facts.dipsDist.evening > 0 ? facts.dipsDist : null;
  const dips = demo ? EX_DIPS : (realDips ?? { morning: 0, afternoon: 0, evening: 0, days: 0 });

  // Compared to last week — needs two weeks of data. Empty shows a descriptive line.
  const realChanges = facts.changes && facts.changes.length ? facts.changes : null;
  const changes = demo ? EX_CHANGES : (realChanges ?? []);

  // Changes you're making — kept habits, each with a before/after read on the metric it
  // targets. Independent of reflection volume; needs a completed, kept habit.
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const activeChanges = useMemo(() => computeActiveChanges(habitHistory, reflections, user ? getChangeStatuses(user.id) : {}), [habitHistory, reflections, user, ledgerVersion]);
  const restartChange = (templateId: string) => { if (user) { setChangeStatus(user.id, templateId, "active"); setLedgerVersion((v) => v + 1); } };
  const changesLedgerPreview = !demo && activeChanges.length === 0;
  const ledger = demo ? EX_LEDGER : activeChanges;

  // Skeleton fallback so a mid-load navigation never shows blank white (data is normally
  // preloaded behind the splash, so this is only for a background reload window).
  if (loadingData) {
    return (
      <div className="min-h-screen bg-surface">
        <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 safe-top">
          <div className="mb-6 h-8 w-28 animate-pulse rounded-lg bg-ink/10" />
          <div className="mb-4 animate-pulse rounded-2xl bg-ink/10 p-5" style={{ height: 150 }} />
          <div className="mb-4 animate-pulse rounded-2xl bg-ink/10 p-5" style={{ height: 120 }} />
          <div className="animate-pulse rounded-2xl bg-ink/10 p-5" style={{ height: 120 }} />
        </div>
        <BottomNav current="patterns" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      {typeof window !== "undefined" && (
        <Joyride
          steps={patternsTourSteps}
          run={runPatternsTour}
          continuous
          showSkipButton
          hideCloseButton
          disableOverlayClose
          scrollToFirstStep
          scrollOffset={80}
          callback={handlePatternsTour}
          locale={{ skip: "Skip", back: "Back", last: "Next", close: "Skip" }}
          styles={{
            tooltip: { borderRadius: 16 },
            spotlight: { borderRadius: 16 },
            options: { primaryColor: "#6FA8FF", textColor: "#1F2937", backgroundColor: "#FFFFFF", arrowColor: "#FFFFFF" },
            buttonClose: { display: "none" },
            buttonSkip: { display: "block" },
          }}
        />
      )}
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 safe-top">
        <div data-tour="patterns-intro">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">Patterns</h1>
          <p className="mt-1 text-sm text-muted/70">What seems to affect how you feel</p>
          {!demo && !locked && fewRefl && (
            <div className="mt-3 rounded-2xl border border-primary/20 bg-primary/[0.06] px-4 py-3">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-primary/80" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
                <p className="text-[13px] font-semibold text-primary/90">
                  {3 - facts.total} More Reflection{3 - facts.total !== 1 ? "s" : ""} to Unlock
                </p>
              </div>
              <p className="mt-1 text-[11.5px] leading-snug text-muted/75">
                Your energy trends and the patterns your coach spots appear once you&apos;ve logged 3 reflections.
              </p>
            </div>
          )}
        </header>

        {/* What the coach is noticing — the headline plus the strongest observed
            associations. Walled (post-trial) users get a lock with the live connection
            count instead: the coach's analysis is the paid product. */}
        {locked ? (
          <Card className="relative" style={riseIn(ready, 0)}>
            <Eyebrow>Food &amp; Feeling</Eyebrow>
            <div className="mt-3 flex items-start gap-3">
              <div className="-mt-1 shrink-0"><WyaaAvatar size={40} /></div>
              <p className="text-[15px] font-medium leading-relaxed text-ink/90">
                {connectionCount > 0
                  ? `Your coach has found ${connectionCount} connection${connectionCount !== 1 ? "s" : ""} between your food and how you feel.`
                  : "Your coach is connecting your food to how you feel."}
              </p>
            </div>
            <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <p className="text-sm leading-relaxed text-ink/80">
                  {connectionCount > 0
                    ? "Unlock Pro to see them, plus your weekly trends and what sets your best days apart. They keep sharpening the more you log."
                    : "Keep logging and reflecting, then unlock Pro to see the connections as your coach finds them."}
                </p>
              </div>
              <button
                type="button"
                onClick={openUpgradeModal}
                className="mt-3 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
              >
                Unlock Pro
              </button>
            </div>
          </Card>
        ) : (
        <Card className="relative" data-tour="patterns-coach" style={riseIn(ready, 0)}>
          <Eyebrow>What Your Coach Is Noticing</Eyebrow>
          <div className="mt-3 flex items-start gap-3">
            <div className="-mt-1 shrink-0"><WyaaAvatar size={40} /></div>
            <p className="text-[15px] font-medium leading-relaxed text-ink/90">{coachHeadline}</p>
          </div>
          {coachEmpty ? (
            <>
              <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.05] px-3 py-3">
                <p className="text-sm leading-relaxed text-ink/70">A couple more will follow as your coach gets to know your food and reflection patterns</p>
              </div>
              <div className="mt-2.5 rounded-xl border border-dashed border-ink/15 bg-ink/[0.02] px-3 py-3 opacity-70">
                <div className="h-2.5 w-2/3 rounded-full bg-ink/10" />
                <div className="mt-2 h-2 w-1/3 rounded-full bg-ink/[0.07]" />
              </div>
            </>
          ) : (
            <div className="mt-4 space-y-2.5">
              {coachInsights.map((d, i) => (
                <div key={i} className="rounded-xl border border-primary/15 bg-primary/[0.05] px-3 py-2.5">
                  <p className="text-sm text-ink/90">{d.text}</p>
                  <span className="mt-1.5 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary/70">Confidence: {d.confidence}</span>
                </div>
              ))}
            </div>
          )}
          {(demo || realInsights.length > 0) && (
            <p className="mt-3 text-[11px] leading-relaxed text-muted/50">Associations from your reflections and meals, not proven causes.</p>
          )}
        </Card>
        )}
        </div>

        {/* Energy trend */}
        <Card className="mt-6" style={riseIn(ready, 2)}>
          <Eyebrow>Your Energy Lately</Eyebrow>
          <p className="mt-2 text-sm text-ink/80">
            {demo ? (
              <>Your <span className="font-semibold text-ink">energy held up well</span> this week.</>
            ) : facts.energyPhrase ? (
              <>Your <span className="font-semibold text-ink">{facts.energyPhrase}</span> this week.</>
            ) : (
              "Your energy across the week will fill in here"
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

        {/* Compared to last week */}
        {!locked && (
          <Card className="mt-6" style={riseIn(ready, 3)}>
            <Eyebrow>Compared To Last Week</Eyebrow>
            <p className="mt-1 text-sm text-muted/65">How your energy, sleep, and mood compare to last week</p>
            {changes.length > 0 ? (
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
            ) : (
              <div className="mt-3 space-y-2">
                {[{ up: true, w: "w-24" }, { up: true, w: "w-20" }, { up: false, w: "w-16" }].map((r, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink/[0.04] ${r.up ? "text-primary-dark" : "text-muted/40"}`}>
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d={r.up ? "M5 15l7-7 7 7" : "M5 12h14"} /></svg>
                    </span>
                    <span className={`h-2.5 ${r.w} rounded-full ${r.up ? "bg-primary-dark/15" : "bg-ink/10"}`} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* What tends to help vs not — behavioral comparison (preview until we compute it) */}
        {!locked && (
        <Card className="mt-6" style={riseIn(ready, 3)}>
          <Eyebrow>Your Days Compared</Eyebrow>
          <p className="mt-1 text-sm text-muted/65">What tends to set your better days apart</p>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-dark/80">Better Days</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/70">Low-Energy Days</p>
            <ul className="space-y-1.5">
              {daysPreview
                ? ["w-24", "w-16", "w-20"].map((w, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary-dark/15 text-primary-dark">
                        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4L19 7" /></svg>
                      </span>
                      <span className={`h-2.5 ${w} rounded-full bg-primary-dark/10`} />
                    </li>
                  ))
                : betterList.map((d) => (
                    <li key={d} className="flex items-start gap-2 text-[13px] text-ink/80">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary-dark/15 text-primary-dark">
                        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4L19 7" /></svg>
                      </span>
                      {d}
                    </li>
                  ))}
            </ul>
            <ul className="space-y-1.5">
              {daysPreview
                ? ["w-20", "w-24", "w-16"].map((w, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink/[0.08] text-ink/45">
                        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v5M12 16.5v.5" /></svg>
                      </span>
                      <span className={`h-2.5 ${w} rounded-full bg-ink/10`} />
                    </li>
                  ))
                : lowList.map((d) => (
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
        )}

        {/* When energy dips */}
        {(
          <Card className="mt-6" style={riseIn(ready, 4)}>
            <Eyebrow>When Your Energy Dips</Eyebrow>
            <p className="mt-1 text-sm text-muted/65">{demo || realDips ? `Across your last ${dips.days} nights` : "Spot the times your energy tends to dip."}</p>
            <div className="mt-4 space-y-2.5">
              {(() => {
                // Scale bars to the number of nights (not the max) so the length reflects
                // true prevalence — "6 of 9 nights" reads as ~two-thirds, not a full bar.
                const nights = Math.max(dips.days, 1);
                const peak = Math.max(dips.morning, dips.afternoon, dips.evening);
                const rows: [string, number][] = [["Morning", dips.morning], ["Afternoon", dips.afternoon], ["Evening", dips.evening]];
                return rows.map(([label, count], i) => {
                  const isPeak = peak > 0 && count === peak;
                  return (
                    <div key={label} className="flex items-center gap-3">
                      <span className={`w-16 shrink-0 text-xs ${isPeak ? "font-semibold text-ink/80" : "text-muted/60"}`}>{label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/5">
                        <div className={`h-full rounded-full ${isPeak ? "bg-primary" : "bg-primary/35"}`} style={{ width: ready ? `${Math.round((count / nights) * 100)}%` : "0%", transition: `width 1400ms cubic-bezier(0.22,1,0.36,1) ${i * 200}ms` }} />
                      </div>
                      <span className={`w-14 shrink-0 text-right text-[11px] ${isPeak ? "font-semibold text-ink/80" : "font-medium text-ink/50"}`}>{count} of {dips.days}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </Card>
        )}

        {/* Changes you're making — kept habits + whether the metric they target improved */}
        {!locked && (
          <Card className="mt-6" style={riseIn(ready, 6)}>
            <Eyebrow>Changes You&apos;re Making</Eyebrow>
            <p className="mt-1 text-sm text-muted/65">Habits you kept, and whether they seem to be helping</p>
            {changesLedgerPreview ? (
              <div className="mt-3 space-y-2.5">
                <div className="rounded-xl border border-primary/15 bg-primary/[0.05] px-3 py-3">
                  <p className="text-[13px] font-semibold text-ink/80">Your Kept Habits Show Up Here</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted/70">Stick with a habit builder and I&apos;ll track whether it actually helps how you feel.</p>
                </div>
                <div className="rounded-xl border border-dashed border-ink/15 bg-ink/[0.02] px-3 py-3 opacity-70">
                  <div className="h-2.5 w-1/2 rounded-full bg-ink/10" />
                  <div className="mt-2 h-2 w-1/3 rounded-full bg-ink/[0.07]" />
                </div>
              </div>
            ) : (
            <div className="mt-3 space-y-2">
              {ledger.map((c) => {
                const line = changeEffectLine(c);
                return (
                  <div key={c.id} className={`rounded-xl border px-3 py-2.5 ${c.stopped ? "border-ink/10 bg-ink/[0.02] opacity-70" : "border-primary/15 bg-primary/[0.05]"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">{c.label}</p>
                      {c.stopped ? (
                        <span className="inline-flex shrink-0 items-center rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-semibold text-ink/50">Paused</span>
                      ) : (
                        <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${KEEP_CHIP[c.keep as "yes" | "maybe"].cls}`}>{KEEP_CHIP[c.keep as "yes" | "maybe"].label}</span>
                      )}
                    </div>
                    {c.stopped && c.regressed ? (
                      <div className="mt-1">
                        <p className="text-xs text-ink/80">Your {METRIC_LABEL[c.targetKey] ?? "energy"} slipped since you stopped this.</p>
                        <button type="button" onClick={() => restartChange(c.templateId)} className="mt-1.5 inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary transition active:opacity-60">
                          Pick it back up
                          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                        </button>
                      </div>
                    ) : (
                      <p className={`mt-1 text-xs ${!c.stopped && c.effect?.direction === "better" ? "text-primary-dark" : "text-muted/65"}`}>
                        {c.stopped ? "Paused. It'll come back around if you want to try it again." : (line ?? "Still gathering data on this one.")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </Card>
        )}

        <p className="mt-4 px-1 text-[11px] leading-relaxed text-muted/50">
          These are observations from your data, not medical advice. The more you log and check in, the sharper they get.
        </p>
      </div>
      <BottomNav current="patterns" />
    </div>
  );
}
