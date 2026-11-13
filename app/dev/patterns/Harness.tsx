"use client";

import { useEffect, useMemo, useState } from "react";
import PatternsView from "../../../components/PatternsView";
import LegacyPatterns from "./LegacyPatterns";
import { computePatternsModel } from "../../../lib/patterns";
import { buildPatternsSample, type SampleUserId } from "../../../lib/patternsSample";
import { computeActiveChanges } from "../../../lib/changes";

// ?user=new | twoWeeks | sixWeeks   ?view=legacy for the page as it is on main   ?locked=1
export default function Harness() {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  useEffect(() => setParams(new URLSearchParams(window.location.search)), []);
  const user = (params?.get("user") ?? "sixWeeks") as SampleUserId;
  const sample = useMemo(() => (params ? buildPatternsSample(user) : null), [params, user]);
  if (!params || !sample) return <div className="min-h-screen bg-surface" />;

  if (params.get("view") === "legacy") return <LegacyPatterns data={sample} />;
  const model = computePatternsModel({ ...sample });
  const ledger = computeActiveChanges(sample.habitHistory, sample.reflections, {});
  return <PatternsView model={model} ledger={ledger} locked={params.get("locked") === "1"} />;
}
