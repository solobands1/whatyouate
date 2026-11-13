"use client";

// The Patterns tab (/summary/insights). This file wires data, the walkthrough and the paywall;
// lib/patterns.ts computes everything shown and components/PatternsView.tsx draws it.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Joyride, { CallBackProps, STATUS, type Step } from "react-joyride";
import BottomNav from "./BottomNav";
import PatternsView from "./PatternsView";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import { computePatternsModel, type PatternsModel } from "../lib/patterns";
import { isFirstPatternMoment, newsSince, parseSnapshot, snapshotOf, type PatternsNews, type PatternsSnapshot } from "../lib/patternsNews";
import { buildPatternsSample } from "../lib/patternsSample";
import { computeActiveChanges } from "../lib/changes";
import { getChangeStatuses } from "../lib/changeStatus";
import { markWalkthroughDone } from "../lib/supabaseDb";
import { useTrialStatus } from "../hooks/useTrialStatus";

export default function PatternsScreen() {
  const { user } = useAuth();
  const trial = useTrialStatus();
  const { reflections, habitHistory, meals, workouts, waterLogs, profile, loading: loadingData } = useAppData();

  const [isDemoMode, setIsDemoMode] = useState(false);
  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    // Only enter demo mode when the walkthrough is genuinely running on THIS screen (stage
    // "insights"). Reading the raw wya_demo_mode flag alone leaked fabricated demo data as the
    // user's real data if a tour was abandoned and the flag never got cleared. Matches
    // HomeScreen's active+stage gate.
    const tourHere = () =>
      localStorage.getItem(`wya_walkthrough_active_${user.id}`) === "true" &&
      localStorage.getItem(`wya_walkthrough_stage_${user.id}`) === "insights";
    if (localStorage.getItem(`wya_demo_mode_${user.id}`) === "true" && tourHere()) setIsDemoMode(true);
    const handler = () => {
      if (user && localStorage.getItem(`wya_demo_mode_${user.id}`) === "true" && tourHere()) setIsDemoMode(true);
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
          <p>What lines up with how you feel, counted from your own logs.</p>
          <p style={{ marginTop: 10 }}>The more nights you reflect, the more there is to compare, so this page fills in as you go.</p>
        </div>
      ),
    },
    {
      target: String.raw`[data-tour="patterns-coach"]`,
      placement: "auto" as const,
      disableBeacon: true,
      content: (
        <div>
          <p style={{ fontWeight: 600, marginBottom: 10 }}>Your Clearest Pattern</p>
          <p>The strongest thing your logs show, with the days behind it, so you can see exactly where it comes from.</p>
        </div>
      ),
    },
    {
      target: String.raw`[data-tour="patterns-days"]`,
      placement: "auto" as const,
      disableBeacon: true,
      content: (
        <div>
          <p style={{ fontWeight: 600, marginBottom: 10 }}>Better Days Vs Slower Days</p>
          <p>What was different on your better days, side by side, with the count behind each line.</p>
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
      void markWalkthroughDone(user.id); // persist server-side so a skip survives reinstall / new device
      localStorage.removeItem(`wya_walkthrough_active_${user.id}`);
      localStorage.removeItem(`wya_walkthrough_stage_${user.id}`);
      setRunPatternsTour(false);
    };
    if (data.status === STATUS.SKIPPED) { end(); return; }
    if (data.type === "step:after" && data.index === patternsTourSteps.length - 1) {
      // Hand off to Home and prompt the user to tap their profile avatar (interactive), instead of
      // auto-jumping to Profile. Keep the tour + demo alive; arm the profile-handoff stage and the
      // profile-resume flag so tapping the avatar picks the tour back up on Profile.
      localStorage.setItem(`wya_walkthrough_active_${user.id}`, "true");
      localStorage.setItem(`wya_walkthrough_stage_${user.id}`, "profile-handoff");
      localStorage.setItem(`wya_demo_mode_${user.id}`, "true");
      localStorage.setItem(`wya_walkthrough_profile_${user.id}`, "true");
      setRunPatternsTour(false);
      router.push("/");
    }
  };

  // Demo (walkthrough only) renders the seeded six-week sample through the same engine, so the
  // tour shows the real page, never fabricated numbers presented as the user's own.
  const sample = useMemo(() => (isDemoMode ? buildPatternsSample("sixWeeks") : null), [isDemoMode]);
  const model = useMemo(
    () =>
      computePatternsModel(
        sample
          ? { ...sample }
          : { reflections, meals, workouts, waterLogs, feelingGoals: profile?.feelingGoals, waterUnit: profile?.waterUnit },
      ),
    [sample, reflections, meals, workouts, waterLogs, profile?.feelingGoals, profile?.waterUnit],
  );

  // Changes you're making: kept habits, each with a before/after read on the metric it targets.
  // (Restarting a paused habit lives in the Home habit builder, not here.)
  const ledger = useMemo(
    () => (sample ? computeActiveChanges(sample.habitHistory, sample.reflections, {}) : computeActiveChanges(habitHistory, reflections, user ? getChangeStatuses(user.id) : {})),
    [sample, habitHistory, reflections, user],
  );

  // New Since You Last Looked + the one-time first-pattern moment. The previous visit's snapshot
  // is read once, when the real data is ready; today's snapshot is written when the user leaves
  // (unmount, app backgrounded), so the news stays put for the whole visit. Never in demo mode.
  const [visit, setVisit] = useState<{ news: PatternsNews; firstMoment: boolean } | null>(null);
  const latest = useRef<{ model: PatternsModel; firstMoment: boolean } | null>(null);
  const live = !!user && !loadingData && !isDemoMode;
  useEffect(() => {
    if (!live || !user || visit) return;
    const seenKey = `wya_patterns_seen_${user.id}`, firstKey = `wya_patterns_first_${user.id}`;
    let prev: PatternsSnapshot | null = null;
    let shownBefore = false;
    try { prev = parseSnapshot(localStorage.getItem(seenKey)); shownBefore = !!localStorage.getItem(firstKey); } catch {}
    const firstMoment = isFirstPatternMoment(prev, model, shownBefore);
    setVisit({ news: newsSince(prev, model, { firstMoment }), firstMoment });
  }, [live, user, model, visit]);
  useEffect(() => { if (live && visit) latest.current = { model, firstMoment: visit.firstMoment }; }, [live, model, visit]);
  useEffect(() => {
    if (!user) return;
    const seenKey = `wya_patterns_seen_${user.id}`, firstKey = `wya_patterns_first_${user.id}`;
    const save = () => {
      const l = latest.current;
      if (!l) return;
      try {
        localStorage.setItem(seenKey, JSON.stringify(snapshotOf(l.model)));
        if (l.firstMoment) localStorage.setItem(firstKey, new Date().toISOString());
      } catch {}
    };
    const onHide = () => { if (document.visibilityState === "hidden") save(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => { save(); document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", save); };
  }, [user]);

  if (!user) return null;

  // Post-trial (walled) users keep their own timeline and dips, but the comparisons are the paid
  // layer: locked cards with the live pattern count.
  const locked = !isDemoMode && trial.isFree;

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
    <>
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
      <PatternsView key={isDemoMode ? "demo" : "real"} model={model} ledger={ledger} locked={locked} news={isDemoMode ? null : visit?.news} firstMoment={!isDemoMode && !!visit?.firstMoment} />
    </>
  );
}
