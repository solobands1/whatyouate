"use client";

import { useEffect, useState } from "react";
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

  const item = (href: string, label: string, key: string) => {
    const showBell = key === "summary" && hasUnseenNudge;
    const showPulse = key === "patterns" && showPatternsDot;
    const isActive = current === key;
    return (
      <button
        data-tour={key === "summary" ? "nav-summary" : undefined}
        className={`relative flex-1 rounded-xl px-3 py-2 text-center text-sm font-medium transition-colors ${
          isActive
            ? "bg-white text-ink shadow-[0_10px_20px_rgba(15,23,42,0.08)]"
            : "text-muted/70"
        }`}
        onPointerDown={() => router.push(href)}
      >
        {label}
        {showBell && (
          <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-primary" />
        )}
        {showPulse && (
          <span className="absolute right-2 top-1.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
        )}
      </button>
    );
  };

  return (
    <nav className="sticky bottom-0 left-0 right-0 border-t border-ink/5 bg-surface/95 backdrop-blur safe-bottom">
      <div className="mx-auto max-w-md px-4 py-3">
        <div className="flex gap-2 rounded-2xl bg-ink/5 p-1">
          {item("/", "Home", "home")}
          {item("/summary", "Insights", "summary")}
          {item("/summary/insights", "Patterns", "patterns")}
        </div>
      </div>
    </nav>
  );
}
