"use client";

import { useMemo } from "react";
import { useAppData } from "./AppDataProvider";
import { openUpgradeModal } from "./UpgradeModal";
import { freeAccessEndDay, type TrialStatus } from "../lib/trial";
import { foodFeelingDays, MIN_FOOD_FEELING_DAYS } from "../lib/foodFeeling";

// The Free Access banner on Home. While it's on: progress toward the first food and feeling
// connection (nights with an energy answer and tagged meals, out of the 8 the coach needs at
// minimum), then the end day once it's 2 days away or less. After it ends: one line, no countdown.
// "Free trial" is never used here: that's Apple's 7 days on the Monthly plan, in the paywall.
export default function FreeAccessBanner({ trial, showProgress }: { trial: TrialStatus; showProgress: boolean }) {
  const { meals, reflections } = useAppData();
  const days = useMemo(() => foodFeelingDays(meals, reflections), [meals, reflections]);

  if (trial.isFree) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={openUpgradeModal}
          className="w-full rounded-xl border border-primary/25 bg-primary/10 px-4 py-2.5 text-left transition active:opacity-70"
        >
          <div className="flex items-center justify-between">
            <span data-free-access-banner="ended" className="text-[12px] font-medium text-ink/60">Free Access Has Ended</span>
            <span className="text-[11px] text-primary font-semibold">Upgrade Now →</span>
          </div>
        </button>
      </div>
    );
  }

  if (!trial.isTrialActive || !showProgress) return null;

  const endDay = freeAccessEndDay(trial);
  const comparing = days >= MIN_FOOD_FEELING_DAYS;
  const label = endDay ? `Free Access Ends ${endDay}` : comparing ? "Free Access · Comparing Your Days" : "Free Access · Building Your Picture";
  const pct = endDay ? 100 : Math.max(6, Math.min(days / MIN_FOOD_FEELING_DAYS, 1) * 100);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={openUpgradeModal}
        className="w-full rounded-xl border border-primary/15 bg-primary/[0.08] px-4 py-2.5 text-left transition active:opacity-70"
      >
        <div className="flex items-center justify-between">
          <span data-free-access-banner={endDay ? "ends" : "building"} className={`text-[12px] font-medium ${endDay ? "text-ink/75" : "text-ink/60"}`}>
            {label}
          </span>
          <span className="text-[11px] text-primary/70 font-medium">See Plans</span>
        </div>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-ink/10">
          <div className="h-full rounded-full bg-primary/50 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </button>
    </div>
  );
}
