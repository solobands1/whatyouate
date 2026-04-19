"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Joyride, { CallBackProps, STATUS, type Step } from "react-joyride";
import { useRouter } from "next/navigation";
import { dayKeyFromTs, formatDateShort, todayKey } from "../lib/utils";
import BottomNav from "./BottomNav";
import Card from "./Card";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import { addNudge, pruneNudges, type FeelLog } from "../lib/supabaseDb";
import { notifyNudgesUpdated } from "../lib/dataEvents";
import { buildSmartNudgeContext, computeNudges, computeSummaryMarkers, type ComputedNudge, type NudgeType } from "../lib/digestEngine";
import { useTrialStatus } from "../hooks/useTrialStatus";
import { openUpgradeModal } from "./UpgradeModal";
import WyaaAvatar from "./WyaaAvatar";


type MilestoneItem = { label: string; sub: string; desc: string; unlocked: boolean };

function UnlockTimeline({ milestones }: { milestones: MilestoneItem[] }) {
  const [activeTip, setActiveTip] = useState<string | null>(null);
  const colWidth = `${(100 / milestones.length).toFixed(4)}%`;

  const activeMilestone = milestones.find((m) => m.label === activeTip);

  return (
    <div className="mb-5">
      {/* Header row with "i" button */}
      <div className="mb-1 flex items-center justify-end">
        <button
          className="flex h-4 w-4 items-center justify-center rounded-full border border-ink/20 transition hover:border-ink/40 active:opacity-60 focus:outline-none"
          onClick={() => setActiveTip(activeTip === "__info" ? null : "__info")}
        >
          <span className="text-[9px] leading-none text-muted/50">i</span>
        </button>
      </div>
      {/* Info tooltip */}
      {activeTip === "__info" && (
        <p className="mb-3 text-center text-[11px] leading-snug text-muted/55">
          The more you log, the better WhatYouAte understands your habits. Tap any dot to see what each step means.
        </p>
      )}
      {/* Dot row */}
      <div className="relative flex items-start justify-between">
        <div className="absolute inset-x-0 top-[6px] h-px bg-ink/10" />
        {milestones.map((m) => (
          <button
            key={m.label}
            className={`relative z-10 flex flex-col items-center transition active:opacity-60 focus:outline-none ${m.unlocked ? "mt-3" : "mt-0"}`}
            style={{ width: colWidth }}
            onClick={() => setActiveTip(activeTip === m.label ? null : m.label)}
          >
            <div className={`h-3 w-3 rounded-full transition-colors ${m.unlocked ? "bg-primary/80" : activeTip === m.label ? "bg-ink/35" : "bg-ink/20"}`} />
            <p className={`mt-1.5 text-center text-[10px] leading-tight ${m.unlocked ? "text-primary/70" : "text-muted/45"}`}>{m.label}</p>
            {m.sub && <p className="mt-0.5 text-center text-[10px] leading-tight text-primary/60">{m.sub}</p>}
          </button>
        ))}
      </div>
      {/* Dot tooltip */}
      {activeMilestone && (
        <p className="mt-3 text-center text-[11px] leading-snug text-muted/60">
          {activeMilestone.unlocked ? "✓ " : ""}{activeMilestone.desc}
        </p>
      )}
    </div>
  );
}

function MacroRing({
  label,
  value,
  unit,
  target,
  animate,
}: {
  label: string;
  value: number;
  unit: string;
  target: number | null;
  animate: boolean;
}) {
  // 3/4 arc (270°) — gap at bottom, speedometer style
  const SIZE = 72;
  const R = 28;
  const STROKE = 7;
  const C = 2 * Math.PI * R;
  const ARC = 0.75 * C; // 270° worth of circumference
  const progress = target && value > 0 ? Math.min(1, value / target) : 0;
  const offset = ARC * (1 - (animate ? progress : 0));
  const displayVal = value > 0 ? `${value}${unit}` : "—";
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        {/* rotate(135deg) places the arc start at bottom-left, gap at bottom */}
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ transform: "rotate(135deg)" }}>
          {/* Grey track */}
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            fill="none" stroke="currentColor" strokeWidth={STROKE}
            strokeDasharray={`${ARC} ${C}`}
            className="text-ink/10"
            strokeLinecap="butt"
          />
          {/* Primary progress — same color as home screen bars */}
          <circle
            cx={SIZE / 2} cy={SIZE / 2} r={R}
            fill="none" stroke="currentColor" strokeWidth={STROKE}
            strokeDasharray={`${ARC} ${C}`}
            strokeDashoffset={offset}
            className="text-primary"
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 700ms cubic-bezier(0.22,1,0.36,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[15px] font-semibold leading-none text-ink">{displayVal}</p>
        </div>
      </div>
      <p className="text-[10px] uppercase tracking-wide text-muted/65">{label}</p>
      <p className="text-[9px] text-muted/60">approx.</p>
    </div>
  );
}

const DEMO_NUDGE = "Your protein has been strong this week, but your last two days have been lighter on calories overall. If you're training today, consider a bigger lunch or an extra snack before your session — your body will make better use of what you eat around activity.";

export default function SummaryScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { profile, meals, workouts, nudges, nudgesLoaded, feelLogs: recentFeelLogs, loading: loadingData } = useAppData();
  const trial = useTrialStatus();
  const [hydrated, setHydrated] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (localStorage.getItem(`wya_demo_mode_${user.id}`) === "true") {
      setIsDemoMode(true);
    }
    const handler = () => {
      if (localStorage.getItem(`wya_demo_mode_${user.id}`) === "true") setIsDemoMode(true);
    };
    window.addEventListener("wya_demo_mode_on", handler);
    return () => window.removeEventListener("wya_demo_mode_on", handler);
  }, [user]);

  const mountedRef = useRef(true);
  const [runSummaryTour, setRunSummaryTour] = useState(false);
  const [visibleNudgeGroupCount, setVisibleNudgeGroupCount] = useState(3);
  const [nudgeExpanded, setNudgeExpanded] = useState<Record<string, "why" | "what" | null>>({});
  const smartNudgeFetchedRef = useRef<Set<string>>(new Set());
  // { message, type, suggestions } from smart AI call, or null if AI said nothing, or undefined while loading
  const [smartNudge, setSmartNudge] = useState<{ message: string; type: NudgeType; action?: string; suggestions?: string[]; generatedAt?: string } | null | undefined>(undefined);
  const [expandedHistoryNudge, setExpandedHistoryNudge] = useState<string | null>(null);
  const getAiSuggestions = (nudgeType: string): string[] | null => {
    if (typeof window === "undefined") return null;
    const hour = new Date().getHours();
    const win = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    const raw = localStorage.getItem(`wya_ai_nudge_${todayKey()}_${win}_${nudgeType}_suggestions`)
      ?? localStorage.getItem(`wya_ai_nudge_${todayKey()}_${nudgeType}_suggestions`); // legacy fallback
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  };
  // Show "New" if this nudge hasn't been seen yet — cleared on mount
  const [nudgeCardIsNew] = useState(() => {
    try {
      const nudgeTs = parseInt(localStorage.getItem("wya_nudge_ts") ?? "0");
      const seenTs = parseInt(localStorage.getItem("wya_nudge_seen_ts") ?? "0");
      return nudgeTs > seenTs;
    } catch { return false; }
  });
  const [showWyaaSheet, setShowWyaaSheet] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    localStorage.setItem("wya_nudge_seen_ts", Date.now().toString());
    window.dispatchEvent(new Event("wya_nudge_update"));
    return () => {
      mountedRef.current = false;
    };
  }, []);


  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);


  useEffect(() => {
    if (!user) return;
    const active = localStorage.getItem(`wya_walkthrough_active_${user.id}`) === "true";
    const stage = localStorage.getItem(`wya_walkthrough_stage_${user.id}`);
    if (active && stage === "summary") {
      setIsDemoMode(true);
      const timer = window.setTimeout(() => setRunSummaryTour(true), 400);
      return () => window.clearTimeout(timer);
    }
  }, [user]);

  useEffect(() => {
    setHydrated(true);
  }, []);


  const summaryMarkers = useMemo(
    () => computeSummaryMarkers(meals, workouts, profile ?? undefined),
    [meals, workouts, profile]
  );
  const visibleNotes = useMemo(
    () => computeNudges(meals, workouts, profile ?? undefined),
    [meals, workouts, profile]
  );
  const dayCount = summaryMarkers.dayCount;
  const mealCount = summaryMarkers.mealCount;
  const gentleTargetsDisplay = summaryMarkers.gentleTargets ?? { calories: 2300, protein: 125 };
  const workoutSummary = summaryMarkers.workoutSummary;
  const avgWeekCalories = summaryMarkers.avgWeekCalories;
  const avgWeekProtein = summaryMarkers.avgWeekProtein;
  const nutrientTrends = summaryMarkers.nutrientTrends;
  const nutrientNotes = summaryMarkers.nutrientNotes;
  const suggestions = summaryMarkers.suggestions;

  const last7Days = useMemo(() => {
    const loggedKeys = new Set(
      meals
        .filter((m) => m.analysisJson?.source !== "supplement" && m.status !== "failed")
        .map((m) => dayKeyFromTs(m.ts))
    );
    const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = dayKeyFromTs(d.getTime());
      return { key, label: dayLabels[d.getDay()], logged: loggedKeys.has(key), isToday: i === 6 };
    });
  }, [meals]);

  const weeklyVariant = (variants: string[]): string => {
    const week = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
    return variants[week % variants.length];
  };

  const weekHeadline = useMemo(() => {
    if (mealCount === 0) return null;
    const loggedThisWeek = last7Days.filter((d) => d.logged).length;
    const calTarget = summaryMarkers.gentleTargets?.calories;
    const proTarget = summaryMarkers.gentleTargets?.protein;
    const calOk = !calTarget || !avgWeekCalories || (avgWeekCalories >= calTarget * 0.9 && avgWeekCalories <= calTarget * 1.1);
    const proOk = !proTarget || !avgWeekProtein || avgWeekProtein >= proTarget * 0.85;
    if (loggedThisWeek >= 6 && calOk && proOk) return weeklyVariant([
      "Strong Week Across The Board",
      "Everything Is Lining Up This Week",
      "Consistent And On Target",
      "This Week Is Looking Exactly How It Should",
      "Clean Numbers All Week",
      "Hitting The Marks That Matter",
      "One Of The Better Weeks In The Data",
    ]);
    if (loggedThisWeek >= 5 && (calOk || proOk)) return weeklyVariant([
      "Solid Week Overall",
      "Good Consistency This Week",
      "More Right Than Wrong This Week",
      "A Productive Week",
      "The Numbers Are Working",
      "Trending In The Right Direction",
      "Good Fundamentals This Week",
    ]);
    if (loggedThisWeek >= 5) return weeklyVariant([
      "Good Effort This Week",
      "Showing Up Consistently",
      "Logging Regularly Is The Hardest Part",
      "Five Days Of Data",
      "Consistent Logging, Plenty To Build On",
      "The Habit Is There",
    ]);
    if (loggedThisWeek >= 3) return weeklyVariant([
      "Building The Habit",
      "A Few Good Days This Week",
      "Every Logged Day Adds To The Picture",
      "Momentum Is Building",
      "The Pattern Is Starting To Show",
      "More Data, Better Picture",
    ]);
    return weeklyVariant([
      "Getting Started",
      "The First Few Logs Are The Hardest",
      "Early Days",
      "A Few Logs In",
    ]);
  }, [last7Days, mealCount, avgWeekCalories, avgWeekProtein, summaryMarkers.gentleTargets, weeklyVariant]);

  const weekObservations = useMemo(() => {
    const lines: string[] = [];
    const loggedDays = last7Days.filter((d) => d.logged);
    const loggedThisWeek = loggedDays.length;

    // Streak: count consecutive logged days ending today
    let streak = 0;
    for (let i = last7Days.length - 1; i >= 0; i--) {
      if (last7Days[i].logged) streak++;
      else break;
    }

    if (loggedThisWeek === 7) {
      lines.push("Logged every day this week.");
    } else if (streak >= 3) {
      lines.push(`${streak}-day streak and counting.`);
    } else if (loggedThisWeek > 0) {
      lines.push(`${loggedThisWeek} of 7 days logged.`);
    }

    if (mealCount >= 5 && avgWeekCalories > 0) {
      const calTarget = summaryMarkers.gentleTargets?.calories;
      if (calTarget) {
        const ratio = avgWeekCalories / calTarget;
        if (ratio >= 0.9 && ratio <= 1.1) {
          lines.push(`Averaging ${avgWeekCalories} kcal, right in range!`);
        } else if (ratio < 0.9) {
          lines.push(`Averaging ${avgWeekCalories} kcal, a bit under target.`);
        } else {
          lines.push(`Averaging ${avgWeekCalories} kcal, slightly over target.`);
        }
      } else {
        lines.push(`Averaging ${avgWeekCalories} kcal this week.`);
      }

      const proTarget = summaryMarkers.gentleTargets?.protein;
      if (avgWeekProtein > 0) {
        if (proTarget) {
          const gap = proTarget - avgWeekProtein;
          if (gap <= 0) {
            lines.push(`Averaging ${avgWeekProtein}g protein, hitting the goal!`);
          } else if (gap <= 15) {
            lines.push(`Averaging ${avgWeekProtein}g protein, close to the ${proTarget}g goal.`);
          } else {
            lines.push(`Averaging ${avgWeekProtein}g protein, ${gap}g short of the ${proTarget}g goal.`);
          }
        } else {
          lines.push(`Averaging ${avgWeekProtein}g protein.`);
        }
      }
    }

    if (workoutSummary.count > 0) {
      const mins = workoutSummary.totalMinutes > 0 ? ` · ${workoutSummary.totalMinutes} min` : "";
      lines.push(`${workoutSummary.count} activit${workoutSummary.count !== 1 ? "ies" : "y"}${mins}.`);
    }

    // Energy observations — only when there are feel logs this week
    const ENERGY_SCORE: Record<string, number> = { good_energy: 3, low_energy: 1 };
    const weekStartMs = (() => { const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d.getTime(); })();
    const weekFeelLogs = recentFeelLogs.filter((l) => l.ts >= weekStartMs);

    if (weekFeelLogs.length >= 2) {
      // Per-day feel scores
      const byDay: Record<string, number[]> = {};
      for (const log of weekFeelLogs) {
        const key = dayKeyFromTs(log.ts);
        if (!byDay[key]) byDay[key] = [];
        const score = ENERGY_SCORE[log.tag];
        if (score !== undefined) byDay[key].push(score);
      }
      const dayAvgs = Object.entries(byDay).map(([key, scores]) => ({
        key,
        avg: scores.reduce((s, v) => s + v, 0) / scores.length,
      }));
      const overallAvg = dayAvgs.reduce((s, d) => s + d.avg, 0) / dayAvgs.length;

      // Per-day calories from meals for correlation
      const calByDay: Record<string, number> = {};
      for (const meal of meals) {
        if (meal.analysisJson?.source === "supplement" || meal.status === "failed") continue;
        const key = dayKeyFromTs(meal.ts);
        const cal = meal.calories ?? Math.round(((meal.analysisJson?.estimated_ranges?.calories_min ?? 0) + (meal.analysisJson?.estimated_ranges?.calories_max ?? 0)) / 2);
        calByDay[key] = (calByDay[key] ?? 0) + cal;
      }

      // Correlation: low energy days that also had below-average calories
      const lowEnergyCorrelated = dayAvgs.filter((d) => {
        const cal = calByDay[d.key] ?? 0;
        return d.avg <= 1.5 && cal > 0 && avgWeekCalories > 0 && cal < avgWeekCalories * 0.85;
      });

      if (lowEnergyCorrelated.length >= 1) {
        lines.push(`Low energy logged on ${lowEnergyCorrelated.length === 1 ? "a day" : `${lowEnergyCorrelated.length} days`} where calories were notably lower than your average.`);
      } else if (overallAvg >= 3.5) {
        lines.push(`Energy has been high this week.`);
      } else if (overallAvg >= 2.5) {
        lines.push(`Energy trending positive this week.`);
      } else if (overallAvg <= 1.5) {
        // Only show count of low-energy logs — don't frame absence of check-ins as a problem
        const lowCount = weekFeelLogs.filter((l) => l.tag === "low_energy").length;
        if (lowCount >= 2) lines.push(`Low energy logged on ${lowCount} days this week.`);
      } else {
        // Mixed — only surface if high energy is dominant (positive signal worth noting)
        const tagCounts: Record<string, number> = {};
        for (const log of weekFeelLogs) tagCounts[log.tag] = (tagCounts[log.tag] ?? 0) + 1;
        const dominant = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0][0];
        if (dominant === "good_energy") {
          lines.push(`Mostly high energy across ${weekFeelLogs.length} check-in${weekFeelLogs.length !== 1 ? "s" : ""} this week.`);
        }
      }
    }

    return lines;
  }, [last7Days, mealCount, avgWeekCalories, avgWeekProtein, summaryMarkers.gentleTargets, workoutSummary, recentFeelLogs, meals]);

  const [nudgeViewCount, setNudgeViewCount] = useState(0);
  const [showTargetInfo, setShowTargetInfo] = useState(false);
  const [showTodayInfo, setShowTodayInfo] = useState(false);

  useEffect(() => {
    if (!user) return;
    const key = `wya_nudge_view_count_${user.id}`;
    const current = Number(localStorage.getItem(key) ?? 0) + 1;
    localStorage.setItem(key, String(current));
    setNudgeViewCount(current);
  }, [user]);

  const uniqueNudges = useMemo(() => {
    // Dedup by day+window+message. Today's current-window nudge is shown in the card above,
    // so skip it here. Earlier windows from today still appear in history.
    const seenKeys = new Set<string>();
    const items: Array<{ id?: string; message: string; created_at?: string; isNew?: boolean }> = [];
    const todayDateKey = todayKey();
    const currentHour = new Date().getHours();
    const currentWindowStr = currentHour < 12 ? "morning" : currentHour < 17 ? "afternoon" : "evening";
    nudges
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .forEach((nudge) => {
        const nudgeDayKey = todayKey(new Date(nudge.created_at));
        if (nudgeDayKey === todayDateKey) {
          // Skip only the current time window — earlier windows show in history
          const nudgeHour = new Date(nudge.created_at).getHours();
          const nudgeWindow = nudgeHour < 12 ? "morning" : nudgeHour < 17 ? "afternoon" : "evening";
          if (nudgeWindow === currentWindowStr) return;
        }
        // Filter out retired nudge types that may still exist in DB history
        if (nudge.message.includes("you're just") && nudge.message.includes("away from your")) return;
        const nudgeHour = new Date(nudge.created_at).getHours();
        const nudgeWindow = nudgeHour < 12 ? "morning" : nudgeHour < 17 ? "afternoon" : "evening";
        // One nudge per window per day — most recent wins (sorted desc above)
        const key = `${nudgeDayKey}:${nudgeWindow}`;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        items.push({
          id: nudge.id,
          message: nudge.message,
          created_at: nudge.created_at,
          isNew:
            nudgeViewCount < 2 &&
            Date.now() - new Date(nudge.created_at).getTime() < 24 * 60 * 60 * 1000
        });
      });
    nutrientNotes.forEach((note) => {
      if (seenKeys.has(note)) return;
      seenKeys.add(note);
      items.push({ message: note });
    });
    return items;
  }, [nudges, nutrientNotes, nudgeViewCount]);

  const groupedNudges = useMemo(() => {
    const groups: Array<{ label: string; items: typeof uniqueNudges }> = [];
    uniqueNudges.forEach((nudge) => {
      const ts = nudge.created_at ? new Date(nudge.created_at).getTime() : Date.now();
      const today = todayKey();
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterday = todayKey(yesterdayDate);
      const key = todayKey(new Date(ts));
      let label: string;
      if (key === today) {
        const hr = new Date(ts).getHours();
        label = hr < 12 ? "Morning" : hr < 17 ? "Afternoon" : "Evening";
      } else if (key === yesterday) {
        label = "Yesterday";
      } else {
        label = formatDateShort(ts);
      }
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.items.push(nudge);
      } else {
        groups.push({ label, items: [nudge] });
      }
    });
    return groups;
  }, [uniqueNudges]);

  const currentWindowLabel = (() => {
    const hr = new Date().getHours();
    return hr < 12 ? "Morning" : hr < 17 ? "Afternoon" : "Evening";
  })();

  const historyGroups = useMemo(
    () => groupedNudges.filter((g) => g.label !== currentWindowLabel),
    [groupedNudges, currentWindowLabel]
  );

  const summaryTourSteps: Step[] = [
    {
      target: String.raw`[data-tour="summary-today"]`,
      placement: "auto" as const,
      disableBeacon: true,
      content: (
        <div>
          <p style={{ fontWeight: 600, marginBottom: 10 }}>Your Daily Intake Card</p>
          <p>This shows your calories, protein, carbs, and fat for today compared to your personal targets.</p>
          <p style={{ marginTop: 10 }}>The rings fill up as you log, so the more accurate your logging, the more useful this gets.</p>
        </div>
      ),
    },
    {
      target: String.raw`[data-tour="summary-week"]`,
      placement: "auto" as const,
      disableBeacon: true,
      content: (
        <div>
          <p style={{ fontWeight: 600, marginBottom: 10 }}>Here Is A Quick Read On How Your Week Is Going</p>
          <p>This shows you which days you logged, your averages, streaks, and any energy patterns that stand out.</p>
          <p style={{ marginTop: 10 }}>The more you log, the more insight this gives you.</p>
        </div>
      ),
    },
    {
      target: String.raw`[data-tour="nudges-card"]`,
      placement: "top" as const,
      disableBeacon: true,
      content: (
        <div>
          <p style={{ fontWeight: 600, marginBottom: 10 }}>Meet Your AI Coach</p>
          <p>Coach keeps an eye on your meals, workouts, and how you're feeling, to send you honest observations. No generic tips. Just something relevant to what you've actually been doing.</p>
        </div>
      ),
    },
  ];

  const handleSummaryTour = (data: CallBackProps) => {
    if (!user) return;
    if (data.status === STATUS.SKIPPED) {
      localStorage.removeItem(`wya_demo_mode_${user.id}`);
      setIsDemoMode(false);
      localStorage.setItem(`wya_walkthrough_${user.id}`, "true");
      localStorage.removeItem(`wya_walkthrough_active_${user.id}`);
      localStorage.removeItem(`wya_walkthrough_stage_${user.id}`);
      setRunSummaryTour(false);
      return;
    }
    if (data.type === "step:after" && data.index === summaryTourSteps.length - 1) {
      localStorage.setItem(`wya_walkthrough_active_${user.id}`, "true");
      localStorage.setItem(`wya_walkthrough_stage_${user.id}`, "insights");
      setRunSummaryTour(false);
      router.push("/summary/insights");
    }
  };

  const recentFoods = useMemo(() => {
    const seen = new Set<string>();
    const foods: string[] = [];
    const threeDaysAgo = Date.now() - 4 * 24 * 60 * 60 * 1000;
    const todayStr = todayKey();
    meals
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .filter((m) => m.ts >= threeDaysAgo && todayKey(new Date(m.ts)) !== todayStr && m.analysisJson?.source !== "supplement" && m.status !== "failed")
      .forEach((meal) => {
        const items = [
          meal.analysisJson?.name,
          ...(meal.analysisJson?.detected_items ?? []).map((i) => i.name),
        ].filter(Boolean) as string[];
        items.forEach((name) => {
          const key = name.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            foods.push(name);
          }
        });
      });
    return foods.slice(0, 20);
  }, [meals]);




  // Smart nudge — DB-first, one per time window per day
  // If today's window already has a saved nudge, use it. Otherwise call AI and save the result.
  useEffect(() => {
    if (!profile || !nudgesLoaded) return;
    if (meals.length < 5) { setSmartNudge(null); return; }
    // Don't make new AI calls for expired free users — use last saved nudge or null
    if (trial.isFree) {
      const last = nudges[0];
      if (last) setSmartNudge({ message: last.message, type: last.type as NudgeType, generatedAt: last.created_at });
      else setSmartNudge(null);
      return;
    }

    const hour = new Date().getHours();
    const win = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    const todayStr = todayKey();
    const windowKey = `${todayStr}_${win}`;

    if (smartNudgeFetchedRef.current.has(windowKey)) return;

    // Staleness check: if macros have drifted >15% since last nudge generation, refetch
    const snapshotKey = `wya_nudge_snapshot_${windowKey}`;
    const currentCals = Math.round((summaryMarkers.todayTotals.calories_min + summaryMarkers.todayTotals.calories_max) / 2);
    const currentProt = Math.round((summaryMarkers.todayTotals.protein_g_min + summaryMarkers.todayTotals.protein_g_max) / 2);
    const savedSnapshot = typeof window !== "undefined" ? localStorage.getItem(snapshotKey) : null;
    let isStale = false;
    if (savedSnapshot) {
      try {
        const { cal, prot } = JSON.parse(savedSnapshot);
        const calDrift = cal > 0 ? Math.abs(currentCals - cal) / cal : 0;
        const protDrift = prot > 0 ? Math.abs(currentProt - prot) / prot : 0;
        isStale = calDrift > 0.15 || protDrift > 0.15;
      } catch { /* ignore */ }
    }

    // Use saved DB nudge if one exists for this window and data isn't stale — no API call needed
    const existing = nudges.find((n) => {
      if (!n.created_at) return false;
      const d = new Date(n.created_at);
      if (todayKey(d) !== todayStr) return false;
      const h = d.getHours();
      return (h < 12 ? "morning" : h < 17 ? "afternoon" : "evening") === win;
    });
    if (existing && !isStale) {
      smartNudgeFetchedRef.current.add(windowKey);
      setSmartNudge({ message: existing.message, type: existing.type as NudgeType, generatedAt: existing.created_at ?? new Date().toISOString() });
      return;
    }

    // Mark as fetched immediately so concurrent re-renders don't fire duplicate requests
    smartNudgeFetchedRef.current.add(windowKey);

    // No saved nudge yet — fetch from AI
    const recentNudgeMessages = nudges.slice(0, 7).map((n) => n.type ? `${n.type}: ${n.message}` : n.message);
    const ctx = buildSmartNudgeContext(meals, workouts, profile, recentFoods, recentNudgeMessages, recentFeelLogs);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      setSmartNudge(visibleNotes.length > 0 ? { message: visibleNotes[0].message, type: visibleNotes[0].type } : null);
    }, 12000);

    fetch("/api/nudge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "smart", ...ctx }),
      signal: controller.signal,
    })
      .then(async (res) => {
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error("nudge failed");
        const { nudge } = await res.json();
        if (nudge?.message) {
          if (nudge.suggestions?.length) {
            localStorage.setItem(`wya_ai_nudge_${windowKey}_${nudge.type}_suggestions`, JSON.stringify(nudge.suggestions.slice(0, 3)));
          }
          // Save macro snapshot so staleness can be detected on next render
          localStorage.setItem(snapshotKey, JSON.stringify({ cal: currentCals, prot: currentProt }));
          smartNudgeFetchedRef.current.add(windowKey);
          setSmartNudge({ message: nudge.message, type: nudge.type, action: nudge.action, suggestions: nudge.suggestions, generatedAt: new Date().toISOString() });
          if (user) {
            addNudge(user.id, nudge.type, nudge.message)
              .then(() => notifyNudgesUpdated())
              .catch(() => {});
            pruneNudges(user.id).catch(() => {});
          }
        } else {
          setSmartNudge(null);
        }
      })
      .catch(() => {
        clearTimeout(timeoutId);
        setSmartNudge(visibleNotes.length > 0 ? { message: visibleNotes[0].message, type: visibleNotes[0].type } : null);
      });
  }, [profile, nudgesLoaded, meals, workouts, recentFoods, nudges, user, recentFeelLogs]);

  const getHistoryNudgeType = (message: string): NudgeType | null => {
    const found = nudges.find((n) => n.message === message && n.type);
    if (found?.type) return found.type as NudgeType;
    // fallback: localStorage meta for nudges saved before type was stored in DB
    if (typeof window === "undefined" || !user) return null;
    try {
      const meta: Record<string, string> = JSON.parse(localStorage.getItem(`wya_nudge_type_meta_${user.id}`) ?? "{}");
      return (meta[message] as NudgeType) ?? null;
    } catch { return null; }
  };


  const isVegan = profile?.dietaryRestrictions?.includes("Vegan") ?? false;
  const isVegetarian = isVegan || (profile?.dietaryRestrictions?.includes("Vegetarian") ?? false);
  const focusLongevity = (profile?.freeformFocus ?? "").toLowerCase().includes("longevity");

  const getNudgeWhy = (type: ComputedNudge["type"], goal: string): string => {
    switch (type) {
      case "protein_low_critical":
        if (isVegan) return weeklyVariant([
          "Plant-based protein needs a bit more planning to hit higher targets • combining sources matters more than each food individually.",
          "Getting enough protein on a vegan diet is doable but takes consistency • variety across legumes, tofu, tempeh, and seeds helps a lot.",
        ]);
        if (isVegetarian) return weeklyVariant([
          "Vegetarian protein sources are reliable but often need a bit more volume to hit higher targets.",
          "Eggs, dairy, and legumes are your strongest protein levers • getting all three working consistently makes a big difference.",
        ]);
        if (goal === "gain") return weeklyVariant([
          "When protein is this low, your muscles can't fully recover and grow between sessions.",
          "Consistently short on protein means your training effort isn't fully converting to results.",
        ]);
        if (goal === "lose") return weeklyVariant([
          "Low protein in a deficit means more weight loss comes from muscle rather than fat.",
          "Protein preserves muscle and keeps hunger manageable • both matter a lot when cutting.",
        ]);
        return weeklyVariant([
          "Protein supports muscle maintenance, immune health, and steady energy throughout the day.",
          "Consistently low protein affects energy, mood, and how your body functions day to day.",
        ]);
      case "protein_low":
        if (isVegan) return weeklyVariant([
          "A small consistent protein gap on a plant-based diet is common • it usually comes down to volume and variety.",
          "Most vegan protein sources are lower per serving • stacking two or three sources at each meal closes the gap quickly.",
        ]);
        if (goal === "gain") return weeklyVariant([
          "A consistent protein shortfall limits recovery and slows progress more than most people realise.",
          "Even a small regular gap in protein compounds over time • your muscles need it to repair properly.",
        ]);
        if (goal === "lose") return weeklyVariant([
          "Keeping protein up while cutting helps preserve muscle and makes the deficit easier to sustain.",
          "Protein keeps you fuller and protects muscle • both matter a lot when you're trying to lose.",
        ]);
        return weeklyVariant([
          "Getting protein consistently right is one of the simplest ways to feel more energised through the week.",
          "Protein does a lot beyond muscle • energy, mood, and immune health all benefit from getting it right.",
        ]);
      case "calorie_low":
        if (goal === "gain") return weeklyVariant([
          "Your body needs a consistent surplus to build • running light on calories works directly against that.",
          "When intake stays below target, your body goes into maintenance mode and building slows or stalls.",
        ]);
        if (goal === "lose") return weeklyVariant([
          "Too far under your target for too long tends to backfire • metabolism adapts and energy crashes.",
          "A slightly higher intake often leads to better results than going too deep • your body responds better.",
        ]);
        return weeklyVariant([
          "Running consistently light affects energy, concentration, and how well you handle your week.",
          "Low intake has a bigger impact on mood and energy than most people expect.",
        ]);
      case "calorie_high":
        if (goal === "lose") return weeklyVariant([
          "Small consistent surpluses add up fast. Even 150 kcal over target daily is over 1000 kcal across a week.",
          "The pattern across the week matters more than any single day. Small adjustments make the difference.",
        ]);
        if (goal === "gain") return weeklyVariant([
          "Being above target is fine for a gain goal, but too large a surplus can mean more fat gain than intended.",
          "A moderate surplus is more effective than a big one when building. It's worth keeping an eye on the weekly trend.",
        ]);
        return weeklyVariant([
          "It's the consistent weekly pattern that shapes results. Day to day variation is normal.",
          "Keeping an eye on the weekly trend is worth the habit. No single day matters that much.",
        ]);
      case "workout_fuel_low":
      case "training_fuel_low":
        return weeklyVariant([
          "Your body's energy demands go up more than most people account for on active days • under-fuelling slows recovery.",
          "Training on low fuel affects sleep, mood, and how you feel for days after • not just the session itself.",
        ]);
      case "workout_missing":
        return weeklyVariant([
          "Without logged sessions, your intake targets may be calibrated too low for what your body is actually doing.",
          "An active person who doesn't log workouts can end up with goals set for a sedentary lifestyle.",
        ]);
      case "micronutrient":
        if (focusLongevity) return weeklyVariant([
          "Micronutrients are especially relevant for long-term health outcomes • consistently low levels compound over years, not just days.",
          "For longevity goals, micronutrient adequacy matters as much as macros • the research on consistent variety is strong.",
        ]);
        if (goal === "gain") return weeklyVariant([
          "Micronutrients affect digestion, absorption, and recovery. All three matter when you're trying to build.",
          "Consistent gaps here can limit how well your body uses the protein and calories you're already eating.",
        ]);
        if (goal === "lose") return weeklyVariant([
          "Micronutrients help regulate energy and appetite. Gaps make a deficit harder to sustain than it needs to be.",
          "Getting variety while cutting is harder but worth it. Micronutrient gaps often show up as low energy and cravings.",
        ]);
        return weeklyVariant([
          "Micronutrients quietly shape energy, mood, and recovery • easy to overlook but worth addressing.",
          "When a nutrient shows up low consistently, it's usually a variety gap • easy to fix with a few regular additions.",
        ]);
      case "fat_low":
        if (goal === "gain") return weeklyVariant([
          "Fat supports hormone production and vitamin absorption, both of which matter when you're trying to build.",
          "Healthy fats help your body use the protein and calories you're eating more effectively.",
        ]);
        if (goal === "lose") return weeklyVariant([
          "Fat keeps you fuller and helps absorb fat-soluble vitamins. Even a small amount at each meal makes a difference.",
          "Low fat isn't always better for a deficit. It can affect hormones, mood, and energy over time.",
        ]);
        return weeklyVariant([
          "Dietary fat supports hormone production, brain health, and vitamin absorption. It's not just about calories.",
          "Healthy fats are essential for absorbing fat-soluble vitamins and keeping hormones balanced.",
        ]);
      case "on_track":
        if (goal === "gain") return weeklyVariant([
          "Consistent fueling is one of the less obvious parts of building. You're doing it right.",
          "Staying in range week over week is what compounds into real progress when you're building.",
        ]);
        if (goal === "lose") return weeklyVariant([
          "A sustainable deficit held consistently is more effective than aggressive cuts. You're doing that.",
          "This kind of steady intake is what makes a deficit work over time without burnout.",
        ]);
        return weeklyVariant([
          "Consistent logging is how patterns become clear. You're building real data here.",
          "Staying in range consistently is how real progress happens.",
          "Your numbers are looking balanced, and that's genuinely good work.",
          "This kind of consistency is what makes the nudges and patterns more accurate over time.",
        ]);
      case "win":
        return weeklyVariant([
          "Small wins compound. A single good day can set the tone for the rest of the week.",
          "Noticing what's working helps reinforce the habit. Consistency builds on moments like this.",
        ]);
      case "momentum":
        return weeklyVariant([
          "Consistency is what separates short-term results from lasting change. You're building the harder thing.",
          "Streaks matter because they reflect real daily decisions — not just intention but follow-through.",
        ]);
      case "pattern":
        return weeklyVariant([
          "Patterns show up slowly but shape results steadily. Catching one early is usually the cheapest time to adjust.",
          "Most nutrition outcomes aren't caused by one bad day — they're caused by patterns that went unnoticed.",
        ]);
      case "meal_timing":
        return weeklyVariant([
          "When you eat affects energy and hunger throughout the day, not just what you eat.",
          "Eating timing influences how your body uses nutrients and how steady your energy is.",
        ]);
      case "food_insight":
        return weeklyVariant([
          "Small shifts in what you eat regularly tend to have more impact than occasional big changes.",
          "Food choices accumulate over time — a small recurring addition or swap can shift your weekly averages noticeably.",
        ]);
      case "variety":
        return weeklyVariant([
          "Eating a wide range of foods is one of the most consistent predictors of better micronutrient coverage.",
          "Variety reduces the risk of consistent gaps — no single food or food group covers everything.",
        ]);
      case "rest_day_fuel":
        return weeklyVariant([
          "Rest days are when your body actually repairs. Underfuelling them can slow recovery between sessions.",
          "Recovery nutrition matters as much as workout nutrition — the repair happens on the days in between.",
        ]);
      case "workout_recovery":
        return weeklyVariant([
          "What you eat after training directly affects how well you recover and how you feel next session.",
          "Post-workout nutrition sets up your next training day. It's one of the highest-return habits to get right.",
        ]);
      case "check_in":
        return weeklyVariant([
          "Periodic check-ins help you stay aware of patterns before they drift too far.",
          "Awareness is the first step. Catching a drift early keeps small adjustments small.",
        ]);
      default:
        return "";
    }
  };

  const getNudgeBehavioralChips = (type: ComputedNudge["type"], goal: string): string[] => {
    switch (type) {
      case "protein_low_critical":
        return goal === "gain" ? ["+ protein at every meal", "+ protein snack"] : ["+ protein per meal", "+ protein snack"];
      case "protein_low":
        return ["+ protein at each meal", "+ protein snack"];
      case "calorie_low":
        return goal === "gain" ? ["+ larger portions", "+ side dish"] : ["+ small snack", "+ side dish"];
      case "calorie_high":
        return goal === "lose" ? ["smaller portions", "skip a side"] : ["watch portions"];
      case "workout_fuel_low":
      case "training_fuel_low":
        return ["+ pre-workout snack", "+ post-workout meal"];
      case "workout_missing":
      case "micronutrient":
        return [];
      case "fat_low":
        return ["+ healthy fats"];
      case "on_track":
        return [];
      default:
        return [];
    }
  };

  const getNudgeAction = (type: ComputedNudge["type"], goal: string): string => {
    switch (type) {
      case "protein_low_critical":
        if (isVegan) return weeklyVariant([
          "Try stacking two plant-based protein sources at each meal • legumes + tofu, or edamame + tempeh.",
          "Adding a high-protein snack like edamame, roasted chickpeas, or a protein-fortified food between meals makes a real difference.",
        ]);
        if (isVegetarian) return weeklyVariant([
          "Focus on eggs, Greek yogurt, or cottage cheese at breakfast and lunch • those two meals are usually where vegetarian protein slips.",
          "Try adding a dairy or egg-based protein hit to at least two meals a day • it's the most reliable way to close the gap.",
        ]);
        if (goal === "gain") return weeklyVariant([
          "Add a protein source to every meal • breakfast and lunch are where most people fall short.",
          "Spreading protein across all three meals beats saving it for dinner • try adding it earlier in the day.",
        ]);
        return weeklyVariant([
          "Adding a protein-focused snack between two main meals is usually the change that sticks best.",
          "Focus on a protein hit at each meal rather than one big serving • more effective and keeps hunger down.",
        ]);
      case "protein_low":
        if (isVegan) return weeklyVariant([
          "A consistent plant-based protein add at each meal tends to compound quickly • tofu, tempeh, and lentils all work well.",
          "Try pairing a grain with a legume or soy source at your main meals • that combination reliably closes small gaps.",
        ]);
        return weeklyVariant([
          "Pairing each meal with a quality protein source is usually enough to close a gap like this.",
          "A small protein add at each meal tends to compound quickly • it doesn't need to be a big change.",
        ]);
      case "calorie_low":
        if (goal === "gain") return weeklyVariant([
          "Try bumping up two or three existing meals slightly rather than adding a whole new one.",
          "A bit more at each sitting tends to be easier to sustain than trying to squeeze in extra meals.",
        ]);
        return weeklyVariant([
          "A small balanced snack between two of your regular meals usually closes the gap without disrupting your routine.",
          "Adding something small and filling between meals tends to be the most sustainable fix.",
        ]);
      case "calorie_high":
        if (goal === "gain") return weeklyVariant([
          "Being above target occasionally is fine when building. Consider whether it's consistent enough to affect your goal.",
          "A surplus is good for building, but a large or inconsistent one can make it harder to track progress. Keeping it steady matters.",
        ]);
        if (goal === "lose") return weeklyVariant([
          "Shaving slightly off portions across a couple of meals tends to be more sustainable than cutting foods out.",
          "Small consistent adjustments beat big restrictions • slightly less at two or three meals a day adds up.",
        ]);
        return weeklyVariant([
          "Keep an eye on portions over the next few days and see if things balance out naturally.",
          "Nothing urgent • just stay aware of portions and let the weekly pattern even out.",
        ]);
      case "workout_fuel_low":
      case "training_fuel_low":
        return weeklyVariant([
          "Try eating a bit more on the days you train • even a moderate add around your session makes a real difference.",
          "Adding a small calorie-dense snack around your workout tends to be the highest-return adjustment you can make.",
        ]);
      case "workout_missing":
        return weeklyVariant([
          "Log your next session right after it finishes • it takes 20 seconds and immediately improves your targets.",
          "Try logging sessions as you go • it shifts your intake targets to match what your body is actually doing.",
        ]);
      case "micronutrient":
        if (goal === "gain") return weeklyVariant([
          "Try adding a food rich in this nutrient to a couple of your main meals. It fits naturally alongside higher-protein eating.",
          "Work it into meals you're already eating rather than adding something new. Easier to sustain when building.",
        ]);
        if (goal === "lose") return weeklyVariant([
          "Look for low-calorie foods that are dense in this nutrient. Leafy greens, legumes, and seeds tend to do a lot here.",
          "A few targeted additions a couple of times this week is usually enough to close the gap without disrupting your deficit.",
        ]);
        return weeklyVariant([
          "Try adding a food rich in this nutrient a few times this week • small consistent additions tend to stick best.",
          "Work it in a couple of times this week • gradual variety builds more naturally than big diet changes.",
        ]);
      case "fat_low":
        if (goal === "gain") return weeklyVariant([
          "Avocado, nuts, or olive oil added to a couple of meals each day is usually enough to close the gap.",
          "Pairing fat with your protein meals makes both more effective. Easy to add without changing much.",
        ]);
        if (goal === "lose") return weeklyVariant([
          "Small amounts of fat at meals help with satiety. A drizzle of olive oil or a handful of nuts goes a long way.",
          "Try adding a modest fat source to one or two meals this week. It doesn't take much to make a difference.",
        ]);
        return weeklyVariant([
          "Try adding a source of healthy fat to a couple of meals. It doesn't need to be much to make a difference.",
          "Adding a small amount of healthy fat to meals helps absorb nutrients and keeps energy more stable.",
        ]);
      case "on_track":
        return "";
      case "win":
        return weeklyVariant([
          "Keep the same approach tomorrow. The goal is to make today's choices feel ordinary.",
          "Note what made today easier — whether it was prep, timing, or just circumstance. It's worth repeating.",
        ]);
      case "momentum":
        return weeklyVariant([
          "Focus on keeping the streak intact today rather than doing anything perfect.",
          "Log what you eat even on harder days. The habit of logging is more valuable than any single perfect day.",
        ]);
      case "pattern":
        return weeklyVariant([
          "Pick one small adjustment and try it consistently for a few days. One change at a time tends to stick.",
          "Identify which meal or time of day the pattern tends to show up. That's usually the highest-leverage place to act.",
        ]);
      case "meal_timing":
        return weeklyVariant([
          "Try shifting one meal slightly earlier or later and see how it affects energy and hunger later in the day.",
          "Experimenting with meal spacing tends to reveal what works for your routine — start with one change.",
        ]);
      case "food_insight":
        return weeklyVariant([
          "Try swapping or adding one food this week and see what it does to your daily numbers.",
          "Small recurring additions are usually easier to maintain than full meal changes — start with one.",
        ]);
      case "variety":
        return weeklyVariant([
          "Try adding one food this week you haven't eaten recently. It doesn't have to be a big change.",
          "Pick one meal where variety is lowest and see what one new ingredient would add.",
        ]);
      case "rest_day_fuel":
        return weeklyVariant([
          "On rest days, try keeping protein intake close to your training-day levels even if total calories are slightly lower.",
          "A protein-focused snack on rest days is usually the simplest way to keep recovery on track.",
        ]);
      case "workout_recovery":
        return weeklyVariant([
          "Aim for a meal with protein and carbs within a couple of hours after training — that window matters.",
          "A small protein-and-carb snack right after a session is usually enough to support recovery even if a full meal isn't ready.",
        ]);
      case "check_in":
        return weeklyVariant([
          "Take a quick look at your weekly averages and see if anything has drifted from where you want to be.",
          "Pick one thing that's slightly off and make one small change. You don't need to fix everything at once.",
        ]);
      default:
        return "";
    }
  };

  if (!user) return null;

  if (loadingData) {
    return (
      <div className="min-h-screen bg-surface">
        <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 safe-top">
          <div className="mb-6 h-8 w-28 animate-pulse rounded-lg bg-ink/10" />
          <div className="mb-4 animate-pulse rounded-2xl bg-ink/10 p-5" style={{ height: 180 }} />
          <div className="animate-pulse rounded-2xl bg-ink/10 p-5" style={{ height: 140 }} />
        </div>
        <BottomNav current="summary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <Joyride
        steps={summaryTourSteps}
        run={runSummaryTour && !loadingData}
        continuous
        showSkipButton
        hideCloseButton
        disableOverlayClose
        scrollToFirstStep
        scrollOffset={80}
        callback={handleSummaryTour}
        locale={{
          skip: "Skip",
          back: "Back",
          last: "Next",
          close: "Skip"
        }}
        styles={{
          options: {
            primaryColor: "#6FA8FF",
            textColor: "#1F2937",
            backgroundColor: "#FFFFFF",
            arrowColor: "#FFFFFF"
          },
          buttonClose: {
            display: "none"
          },
          buttonSkip: {
            display: "block"
          }
        }}
      />
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 safe-top">
        <header className="mb-6" data-tour="summary-header">
          <h1 className="text-2xl font-semibold text-ink">Insights</h1>
          <p className="mt-1 text-sm text-muted/70">Daily snapshot and weekly insights at a glance</p>
        </header>

        {/* Unlock progress timeline — only shown until all milestones are reached (14 logged days) */}
        {!isDemoMode && dayCount < 14 && (() => {
          const nudgesUnlocked = mealCount >= 5;
          const patternsUnlocked = dayCount >= 5 && mealCount >= 5;
          const smartTargetsUnlocked = dayCount >= 7;
          const weeklyComparisonUnlocked = dayCount >= 10;
          const fullTrendsUnlocked = dayCount >= 14;
          const allMilestones = [
            { label: "First Meal", sub: "", desc: "Log your first meal to get started.", unlocked: mealCount >= 1 },
            { label: "Nudges", sub: nudgesUnlocked ? "" : `${5 - mealCount} more meal${5 - mealCount !== 1 ? "s" : ""}`, desc: "Personalized suggestions based on what you've been eating.", unlocked: nudgesUnlocked },
            { label: "Patterns", sub: patternsUnlocked ? "" : `${Math.max(0, 5 - dayCount)} more day${Math.max(0, 5 - dayCount) !== 1 ? "s" : ""}`, desc: "See recurring habits and timing patterns across your week.", unlocked: patternsUnlocked },
            { label: "Smart Targets", sub: smartTargetsUnlocked ? "" : `${7 - dayCount} more day${7 - dayCount !== 1 ? "s" : ""}`, desc: "Personalized calorie and protein goals based on your profile and history.", unlocked: smartTargetsUnlocked },
            { label: "Weekly Compare", sub: weeklyComparisonUnlocked ? "" : `${10 - dayCount} more day${10 - dayCount !== 1 ? "s" : ""}`, desc: "Compare this week to last week to see how you're trending.", unlocked: weeklyComparisonUnlocked },
            { label: "Full Trends", sub: fullTrendsUnlocked ? "" : `${14 - dayCount} more day${14 - dayCount !== 1 ? "s" : ""}`, desc: "Two weeks of data unlocks full macro and habit trend charts.", unlocked: fullTrendsUnlocked },
          ];
          // Only show the countdown on the next locked milestone, not all future ones
          let nextUnlockFound = false;
          const milestones = allMilestones.map((m) => {
            if (m.unlocked || !m.sub) return m;
            if (!nextUnlockFound) { nextUnlockFound = true; return m; }
            return { ...m, sub: "" };
          });
          return (
            <UnlockTimeline milestones={milestones} />
          );
        })()}

        <Card data-tour="summary-today">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">
                Today
              </p>
              <button
                type="button"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-ink/10 text-[10px] font-semibold text-ink/60"
                onClick={() => setShowTodayInfo(true)}
                aria-label="About daily intake"
              >
                i
              </button>
            </div>
          </div>
          <div className="mt-4 flex justify-between">
            <MacroRing
              label="Calories"
              value={isDemoMode ? 1840 : Math.round((summaryMarkers.todayTotals.calories_min + summaryMarkers.todayTotals.calories_max) / 2)}
              unit=""
              target={isDemoMode ? 2300 : (summaryMarkers.gentleTargets?.calories ?? null)}
              animate={hydrated}
            />
            {/* Carbs + Fats locked for expired users */}
            {!isDemoMode && trial.isFree ? (
              <button
                type="button"
                onClick={openUpgradeModal}
                className="relative flex gap-3"
              >
                <div className="blur-sm pointer-events-none select-none flex gap-3">
                  <MacroRing label="Carbs" value={0} unit="g" target={null} animate={false} />
                  <MacroRing label="Fats" value={0} unit="g" target={null} animate={false} />
                </div>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-ink/30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span className="text-[10px] font-medium text-ink/50">Upgrade To Unlock</span>
                </div>
              </button>
            ) : (
              <>
                <MacroRing
                  label="Carbs"
                  value={isDemoMode ? 180 : Math.round((summaryMarkers.todayTotals.carbs_g_min + summaryMarkers.todayTotals.carbs_g_max) / 2)}
                  unit="g"
                  target={isDemoMode ? 288 : (summaryMarkers.gentleTargets?.calories ? Math.round(summaryMarkers.gentleTargets.calories * 0.50 / 4) : null)}
                  animate={hydrated}
                />
                <MacroRing
                  label="Fats"
                  value={isDemoMode ? 62 : Math.round((summaryMarkers.todayTotals.fat_g_min + summaryMarkers.todayTotals.fat_g_max) / 2)}
                  unit="g"
                  target={isDemoMode ? 77 : (summaryMarkers.gentleTargets?.calories ? Math.round(summaryMarkers.gentleTargets.calories * 0.30 / 9) : null)}
                  animate={hydrated}
                />
              </>
            )}
            <MacroRing
              label="Protein"
              value={isDemoMode ? 148 : Math.round((summaryMarkers.todayTotals.protein_g_min + summaryMarkers.todayTotals.protein_g_max) / 2)}
              unit="g"
              target={isDemoMode ? 125 : (summaryMarkers.gentleTargets?.protein ?? null)}
              animate={hydrated}
            />
          </div>
          {summaryMarkers.gentleTargets ? (
            <button
              type="button"
              className="mt-4 flex items-center gap-1 text-left text-xs text-muted/70"
              onClick={() => setShowTargetInfo((v) => !v)}
            >
              <span>Suggested range: {gentleTargetsDisplay.calories} kcal · {Math.round(gentleTargetsDisplay.calories * 0.50 / 4)}g carbs · {Math.round(gentleTargetsDisplay.calories * 0.30 / 9)}g fat · {gentleTargetsDisplay.protein}g protein</span>
            </button>
          ) : (
            <p className="mt-2 text-xs text-muted/70">Complete your profile for a personalized range</p>
          )}
          {showTargetInfo && (
            <p className="mt-1 text-[10px] text-muted/65">
              {mealCount >= 10 && profile?.weight
                ? "Based on your recent intake pattern, adjusted for your goal."
                : profile?.weight && profile?.activityLevel
                ? "Based on your weight, activity level, and goal."
                : "Standard estimate. Complete your profile to personalize."}
            </p>
          )}
          <div className="mt-3 h-px w-full bg-ink/5" />
        </Card>

        <Card className="mt-6" data-tour="summary-week">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">This week</p>

          {/* 7-day dot strip */}
          <div className="mt-3 flex items-start justify-between">
            {last7Days.map((day, i) => (
              <div key={day.key} className="flex flex-col items-center gap-1.5">
                <div className={`h-2.5 w-2.5 rounded-full ${(isDemoMode ? [true,true,false,true,true,true,false][i] : day.logged) ? "bg-primary/70" : "bg-ink/10"}`} />
                <p className={`text-[10px] ${day.isToday ? "font-bold text-ink/80" : "text-muted/60"}`}>{day.label}</p>
              </div>
            ))}
          </div>

          {isDemoMode ? (
            <>
              <p className="mt-3 text-sm font-semibold text-ink/80">Strong week overall</p>
              <div className="mt-1.5 space-y-1">
                <p className="text-sm text-muted/60">5 of 7 days logged. Protein consistent across all logged days.</p>
                <p className="text-sm text-muted/60">Averaging 1,840 kcal — slightly under your suggested range on lighter days.</p>
              </div>
            </>
          ) : dayCount === 0 ? (
            <p className="mt-3 text-sm text-muted/60">Log your first meal and I'll start building your picture.</p>
          ) : trial.isFree && !isDemoMode ? (
            <button
              type="button"
              onClick={openUpgradeModal}
              className="relative mt-3 w-full overflow-hidden rounded-lg text-left"
            >
              <div className="blur-sm pointer-events-none select-none space-y-1">
                <p className="text-sm font-semibold text-ink/80">Your week at a glance</p>
                <p className="text-sm text-muted/60">Patterns and observations from your recent meals appear here.</p>
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-ink/30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span className="text-[10px] font-medium text-ink/50">Upgrade To Unlock</span>
              </div>
            </button>
          ) : (
            <>
              {weekHeadline && (
                <p className="mt-3 text-sm font-semibold text-ink/80">{weekHeadline}</p>
              )}
              <div className="mt-1.5 space-y-1">
                {weekObservations.map((line) => (
                  <p key={line} className="text-sm text-muted/60">{line}</p>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card className={`relative mt-6${nudgeCardIsNew && smartNudge ? " ring-1 ring-primary/20" : ""}`} data-tour="nudges-card">
          {/* Wyaa floating on top-right corner */}
          <div className="absolute -top-5 -right-1 z-10">
            <WyaaAvatar
              isNew={nudgeCardIsNew && !!smartNudge}
              size={46}
              onClick={() => setShowWyaaSheet(true)}
            />
          </div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Nudges</p>
            {nudgeCardIsNew && smartNudge && (
              <span className="animate-card-fade inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">New</span>
            )}
          </div>
          {isDemoMode ? (
            <div className="mt-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/50">This Afternoon</p>
                <span className="text-[11px] text-ink/30">2:14 pm</span>
              </div>
              <div className="rounded-xl border border-primary/60 bg-primary/5 px-4 py-3 space-y-2.5">
                <p className="text-sm font-medium text-ink/90">{DEMO_NUDGE}</p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-ink/15 px-2.5 py-0.5 text-[11px] font-medium text-ink/55">Why?</span>
                  <span className="rounded-full border border-ink/15 px-2.5 py-0.5 text-[11px] font-medium text-ink/55">What to do?</span>
                </div>
              </div>
            </div>
          ) : mealCount === 0 ? (
            <div className="mt-3 space-y-1">
              <p className="text-sm text-ink/70">Log a few meals and I’ll start learning your patterns.</p>
              <p className="text-xs text-muted/65">Nudges appear after 5 meals.</p>
            </div>
          ) : mealCount < 5 ? (
            <div className="mt-3 space-y-1">
              <p className="text-sm text-ink/70">Getting started — log {5 - mealCount} more meal{5 - mealCount !== 1 ? "s" : ""} and I’ll have my first read on your patterns.</p>
              <div className="mt-2 flex gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full ${i < mealCount ? "bg-primary/60" : "bg-ink/10"}`} />
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {/* Today’s nudge — labeled by time window */}
              {(() => {
                const hr = new Date().getHours();
                const windowLabel = hr < 12 ? "This Morning" : hr < 17 ? "This Afternoon" : "This Evening";
                const nudgeTs = smartNudge && smartNudge !== undefined && (smartNudge as any).generatedAt ? new Date((smartNudge as any).generatedAt) : null;
                const nudgeTimeLabel = nudgeTs ? nudgeTs.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase() : null;
                return (
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/65">{windowLabel}</p>
                    {nudgeTimeLabel && <span className="text-[11px] text-ink/50">{nudgeTimeLabel}</span>}
                  </div>
                );
              })()}
              {smartNudge === undefined ? (
                /* Loading state — blue card matching nudge style */
                <div className="rounded-xl border border-primary/35 bg-primary/5 px-4 py-3 flex items-center gap-2.5">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary/80" />
                  </span>
                  <p className="text-sm text-primary/70 font-medium">Coach is thinking…</p>
                </div>
              ) : smartNudge && trial.isFree && !isDemoMode ? (
                /* Expired trial — show teaser with blur */
                <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
                  <p className="text-sm font-medium text-ink/90 line-clamp-1">
                    {smartNudge.message.slice(0, 48)}{smartNudge.message.length > 48 ? "..." : ""}
                  </p>
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/80 backdrop-blur-[3px]">
                    <button
                      type="button"
                      onClick={openUpgradeModal}
                      className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition active:opacity-80"
                    >
                      Unlock To Read
                    </button>
                  </div>
                </div>
              ) : smartNudge ? (
                (() => {
                  const nudge = smartNudge;
                  const goal = profile?.goalDirection ?? "maintain";
                  const why = getNudgeWhy(nudge.type, goal);
                  const action = nudge.action ?? getNudgeAction(nudge.type, goal);
                  const behavioralChips = getNudgeBehavioralChips(nudge.type, goal);
                  const showFoodChips = nudge.type !== "workout_missing" && nudge.type !== "calorie_high" && nudge.type !== "on_track" && suggestions.length > 0;
                  const showChips = behavioralChips.length > 0 || showFoodChips;
                  // Stale nudge check — show caught-up note if user has since hit target
                  const nudgeTs = nudge.generatedAt ? new Date(nudge.generatedAt) : null;
                  const nudgeTimeLabel = nudgeTs
                    ? nudgeTs.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase()
                    : null;
                  const todayCalAvg = (summaryMarkers.todayTotals.calories_min + summaryMarkers.todayTotals.calories_max) / 2;
                  const todayProAvg = (summaryMarkers.todayTotals.protein_g_min + summaryMarkers.todayTotals.protein_g_max) / 2;
                  const calTarget = summaryMarkers.gentleTargets?.calories ?? 0;
                  const proTarget = summaryMarkers.gentleTargets?.protein ?? 0;
                  const isCaughtUp =
                    (nudge.type === "calorie_low" && calTarget > 0 && todayCalAvg >= calTarget * 0.9) ||
                    ((nudge.type === "protein_low" || nudge.type === "protein_low_critical") && proTarget > 0 && todayProAvg >= proTarget * 0.85);
                  return (
                    <div className="rounded-xl border border-primary/60 bg-primary/5 px-4 py-3 space-y-2.5">
                      <p className="text-sm font-medium text-ink/90">{nudge.message.replace(/\n+/g, " ")}</p>
                      <p className="text-[11px] text-primary/70 font-medium">— Coach</p>
                      {isCaughtUp && (
                        <p className="text-[11px] text-primary/60 font-medium">Looks like you've caught up since then.</p>
                      )}
                      {(why || action || showChips) && (
                        <div className="flex flex-wrap gap-1.5">
                          {why && (
                            <button
                              type="button"
                              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition active:opacity-60 ${nudgeExpanded[nudge.type] === "why" ? "border-primary/40 bg-primary/10 text-primary/80" : "border-ink/15 text-ink/55"}`}
                              onClick={() => setNudgeExpanded((prev) => ({ ...prev, [nudge.type]: prev[nudge.type] === "why" ? null : "why" }))}
                            >
                              {nudge.type === "on_track" ? "Keep it up" : "Why?"}
                            </button>
                          )}
                          {(action || showChips) && (
                            <button
                              type="button"
                              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition active:opacity-60 ${nudgeExpanded[nudge.type] === "what" ? "border-primary/40 bg-primary/10 text-primary/80" : "border-ink/15 text-ink/55"}`}
                              onClick={() => setNudgeExpanded((prev) => ({ ...prev, [nudge.type]: prev[nudge.type] === "what" ? null : "what" }))}
                            >
                              What to do?
                            </button>
                          )}
                        </div>
                      )}
                      {nudgeExpanded[nudge.type] === "why" && why && (
                        <div className="space-y-1">
                          {why.split(" • ").map((part, i) => (
                            <p key={i} className="text-xs text-ink/70">{part.trim()}</p>
                          ))}
                        </div>
                      )}
                      {nudgeExpanded[nudge.type] === "what" && (action || showChips) && (
                        <div className="space-y-2">
                          {action && (
                            <div className="space-y-1">
                              {action.split(" • ").map((part, i) => (
                                <p key={i} className="text-xs text-ink/70">{part.trim()}</p>
                              ))}
                            </div>
                          )}
                          {showChips && (
                            <div className="space-y-1.5">
                              {behavioralChips.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {behavioralChips.map((chip) => (
                                    <span
                                      key={chip}
                                      className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary/80"
                                    >
                                      {chip}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {showFoodChips && (
                                <div className="flex flex-wrap gap-1.5">
                                  {(getAiSuggestions(nudge.type) ?? suggestions.slice(0, 3)).map((food) => (
                                    <span
                                      key={food}
                                      className="rounded-full border border-ink/10 bg-white px-2.5 py-0.5 text-[11px] text-ink/60"
                                    >
                                      {food}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <div className="rounded-xl border border-primary/60 bg-primary/5 px-4 py-3">
                  <p className="text-sm text-ink/50">Nothing to say yet. Keep logging and when something useful comes up, it'll appear here.</p>
                </div>
              )}
              {/* Past nudges — hidden for expired free users */}
              {trial.isFree && historyGroups.length > 0 && (
                <button
                  type="button"
                  onClick={openUpgradeModal}
                  className="mt-1 w-full rounded-lg bg-ink/5 px-3 py-2.5 text-left transition active:opacity-70"
                >
                  <p className="text-xs text-ink/50">
                    {historyGroups.reduce((n, g) => n + g.items.length, 0)} previous nudges are locked{" "}
                    <span className="font-semibold text-primary/70">Upgrade To Read</span>
                  </p>
                </button>
              )}
              {!trial.isFree && historyGroups.slice(0, visibleNudgeGroupCount).map((group) => (
                <div key={group.label} className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/65">{group.label}</p>
                  {group.items.map((nudge) => {
                    const histType = getHistoryNudgeType(nudge.message);
                    const histWhy = histType ? getNudgeWhy(histType, profile?.goalDirection ?? "maintain") : null;
                    const histAction = histType ? getNudgeAction(histType, profile?.goalDirection ?? "maintain") : null;
                    const histKey = nudge.id ?? nudge.message;
                    const isExpanded = expandedHistoryNudge === histKey;
                    return (
                      <div
                        key={histKey}
                        className={`rounded-lg px-3 py-2 text-xs transition-colors ${isExpanded ? "bg-ink/[0.07] border border-ink/15 text-ink/80" : "bg-ink/5 text-ink/60"} ${histWhy ? "cursor-pointer active:opacity-70" : ""}`}
                        onClick={histWhy ? () => setExpandedHistoryNudge(isExpanded ? null : histKey) : undefined}
                      >
                        <p>{nudge.message.replace(/ • /g, ". ").replace(/\.{2,}$/g, "")}</p>
                        {isExpanded && (histWhy || histAction) && (
                          <div className="mt-2 space-y-2 border-t border-ink/10 pt-2">
                            {histWhy && (
                              <div>
                                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted/60">Why?</p>
                                {histWhy.split(" • ").map((part, i) => (
                                  <p key={i} className="text-ink/55">{part.trim()}</p>
                                ))}
                              </div>
                            )}
                            {histAction && (
                              <div>
                                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted/60">What to do?</p>
                                <p className="text-ink/55">{histAction}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              {!trial.isFree && visibleNudgeGroupCount < historyGroups.length && (
                <button
                  type="button"
                  className="mt-1 text-[11px] font-semibold text-ink/50 underline transition active:opacity-50"
                  onClick={() => setVisibleNudgeGroupCount((prev) => prev + 3)}
                >
                  Show more
                </button>
              )}
            </div>
          )}
        </Card>


      </div>

      <BottomNav current="summary" />

      {/* About AI Coach sheet */}
      {showWyaaSheet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" onClick={() => setShowWyaaSheet(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="animate-scaleIn relative w-full max-w-xs"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Speech bubble */}
            <div className="relative rounded-2xl bg-white px-6 py-6 shadow-xl">
              <div className="flex flex-col items-center gap-4 text-center">
                <WyaaAvatar size={72} />
                <div>
                  <p className="text-base font-semibold text-ink">I&apos;m your AI Nutrition Coach</p>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted/80">
                    I read your logs and send you honest, specific nudges throughout the day based on what you&apos;ve actually eaten and what you&apos;re working toward.
                  </p>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted/80">
                    The more you log, the more useful I get!
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-1 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white active:opacity-70"
                  onClick={() => setShowWyaaSheet(false)}
                >
                  Got it
                </button>
              </div>
              {/* Tail pointing down-right toward Wyaa in the card header */}
              <div className="absolute -bottom-2.5 right-10 h-5 w-5 rotate-45 rounded-br-sm bg-white shadow-[2px_2px_4px_rgba(0,0,0,0.06)]" />
            </div>
          </div>
        </div>
      )}

      {showTodayInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-ink">Daily Intake</p>
                <p className="mt-2 text-sm text-muted/70">Your calories, protein, carbs, and fats logged today compared to your targets. The rings fill as you get closer to your goal. Log every meal to get an accurate picture of the day.</p>
              </div>
              <button
                type="button"
                className="text-sm font-semibold text-ink/60"
                onClick={() => setShowTodayInfo(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
