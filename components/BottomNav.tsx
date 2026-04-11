"use client";

import { useEffect, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { useTrialStatus } from "../hooks/useTrialStatus";
import { useAppData } from "./AppDataProvider";
import { hasEnoughDataForPatterns } from "../lib/trial";

function checkUnseen() {
  const nudgeTs = parseInt(localStorage.getItem("wya_nudge_ts") ?? "0");
  const seenTs = parseInt(localStorage.getItem("wya_nudge_seen_ts") ?? "0");
  return nudgeTs > seenTs;
}

function checkPatternsDot(isPro: boolean, isFree: boolean, hasData: boolean): boolean {
  if (isPro || !hasData) return false;

  // Bell state 2: trial expired — show until they visit, stored separately
  if (isFree) {
    const seen = localStorage.getItem("wya_patterns_expired_seen") === "1";
    return !seen;
  }

  // Bell state 1: data just became available — show until they visit
  const visited = localStorage.getItem("wya_patterns_visited") === "1";
  return !visited;
}

export default function BottomNav({ current }: { current: "home" | "summary" | "patterns" | "none" }) {
  const [hasUnseenNudge, setHasUnseenNudge] = useState(false);
  const [showPatternsDot, setShowPatternsDot] = useState(false);
  const router = useRouter();
  const trial = useTrialStatus();
  const { meals } = useAppData();

  const hasData = hasEnoughDataForPatterns(meals);

  useEffect(() => {
    setShowPatternsDot(checkPatternsDot(trial.isPro, trial.isFree, hasData));
  }, [trial.isPro, trial.isFree, hasData]);

  // Clear the dot when user is on the Patterns page
  useEffect(() => {
    if (current !== "patterns") return;
    if (trial.isFree) {
      localStorage.setItem("wya_patterns_expired_seen", "1");
    } else {
      localStorage.setItem("wya_patterns_visited", "1");
    }
    setShowPatternsDot(false);
  }, [current, trial.isFree]);

  useEffect(() => {
    setHasUnseenNudge(checkUnseen());
    const handler = () => setHasUnseenNudge(checkUnseen());
    window.addEventListener("wya_nudge_update", handler);
    return () => window.removeEventListener("wya_nudge_update", handler);
  }, []);

  const icons: Record<string, JSX.Element> = {
    home: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5z" />
        <path d="M9 21V12h6v9" />
      </svg>
    ),
    summary: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="12" width="4" height="9" rx="1" />
        <rect x="10" y="7" width="4" height="14" rx="1" />
        <rect x="17" y="3" width="4" height="18" rx="1" />
      </svg>
    ),
    patterns: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l4-8 4 5 3-3 4 6" />
        <circle cx="20" cy="5" r="2" />
      </svg>
    ),
  };

  const item = (href: string, label: string, key: string) => {
    const showBell = key === "summary" && hasUnseenNudge;
    const showPulse = key === "patterns" && showPatternsDot;
    const isActive = current === key;
    return (
      <button
        data-tour={key === "summary" ? "nav-summary" : undefined}
        className={`relative flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-2 transition-colors ${
          isActive
            ? "bg-white text-primary shadow-[0_4px_16px_rgba(111,168,255,0.18)]"
            : "text-muted/65"
        }`}
        onPointerDown={() => router.push(href)}
      >
        {icons[key]}
        <span className={`text-[10px] font-semibold leading-none ${isActive ? "text-primary" : "text-muted/65"}`}>
          {label}
        </span>
        {showBell && (
          <span className="absolute right-3 top-1.5 h-2 w-2 rounded-full bg-primary" />
        )}
        {showPulse && (
          <span className="absolute right-3 top-1.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
        )}
      </button>
    );
  };

  return (
    <nav className="sticky bottom-0 left-0 right-0 bg-surface/95 backdrop-blur safe-bottom">
      <div className="mx-auto flex max-w-md gap-1 border-t border-ink/8 px-4 py-2">
        {item("/", "Home", "home")}
        {item("/summary", "Insights", "summary")}
        {item("/summary/insights", "Patterns", "patterns")}
      </div>
    </nav>
  );
}
