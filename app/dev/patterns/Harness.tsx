"use client";

import { useEffect, useMemo, useState } from "react";
import PatternsView from "../../../components/PatternsView";
import { computePatternsModel } from "../../../lib/patterns";
import { isFirstPatternMoment, newsSince, snapshotOf } from "../../../lib/patternsNews";
import { buildPatternsSample, type PatternsSample, type SampleUserId } from "../../../lib/patternsSample";
import { computeActiveChanges } from "../../../lib/changes";

// The same logs as they stood `days` ago, so a past visit can be simulated honestly.
function asOf(s: PatternsSample, days: number, now: number) {
  const then = new Date(now - days * 86_400_000);
  const cut = new Date(then); cut.setHours(0, 0, 0, 0);
  const key = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, "0")}-${String(cut.getDate()).padStart(2, "0")}`;
  return {
    ...s,
    reflections: s.reflections.filter((r) => r.date < key),
    meals: s.meals.filter((m) => m.ts < cut.getTime()),
    workouts: s.workouts.filter((w) => w.startTs < cut.getTime()),
    waterLogs: Object.fromEntries(Object.entries(s.waterLogs).filter(([k]) => k < key)),
    now: then.getTime(),
  };
}

// ?user=night1 | new | night5 | twoWeeks | sixWeeks | mealsOnly   ?since=N (last looked N days ago)   ?locked=1
export default function Harness() {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  useEffect(() => setParams(new URLSearchParams(window.location.search)), []);
  const user = (params?.get("user") ?? "sixWeeks") as SampleUserId;
  const view = useMemo(() => {
    if (!params) return null;
    const now = Date.now();
    const sample = buildPatternsSample(user, now);
    const model = computePatternsModel({ ...sample, now });
    const since = Number(params.get("since") ?? 0);
    const prev = since > 0 ? snapshotOf(computePatternsModel(asOf(sample, since, now)), now - since * 86_400_000) : null;
    const firstMoment = isFirstPatternMoment(prev, model, false);
    return { model, news: newsSince(prev, model, { firstMoment }), firstMoment, ledger: computeActiveChanges(sample.habitHistory, sample.reflections, {}) };
  }, [params, user]);
  if (!params || !view) return <div className="min-h-screen bg-surface" />;
  return <PatternsView model={view.model} ledger={view.ledger} locked={params.get("locked") === "1"} news={view.news} firstMoment={view.firstMoment} />;
}
