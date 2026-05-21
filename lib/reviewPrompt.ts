import type { MealLog } from "./types";
import { hasEnoughDataForPatterns } from "./trial";

const DAY = 24 * 60 * 60 * 1000;

export type PromptKey = "p1" | "p2" | "p3" | "p4" | "p5";
export type FlagType = "upgrade" | "milestone";

const K = {
  lastShown: "wya_review_last_shown",
  yesTs:     "wya_review_yes_ts",
  noTs:      "wya_review_no_ts",
  flagType:  "wya_review_flag_type",
  flagKey:   "wya_review_flag_key",
  flagSetTs: "wya_review_flag_set_ts",
};

function ls(key: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(key);
}
function lsSet(key: string, val: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, val);
}
function lsDel(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(key);
}

export function canShowReviewPrompt(isUpgrade = false): boolean {
  const now = Date.now();
  const yesTs = parseInt(ls(K.yesTs) ?? "0");
  const noTs  = parseInt(ls(K.noTs)  ?? "0");
  const last  = parseInt(ls(K.lastShown) ?? "0");
  if (yesTs && now - yesTs < 90 * DAY) return false;
  if (noTs  && now - noTs  < 30 * DAY) return false;
  const minGap = isUpgrade ? 3 * DAY : 21 * DAY;
  if (last && now - last < minGap) return false;
  return true;
}

export function recordReviewShown(): void {
  lsSet(K.lastShown, Date.now().toString());
}

export function recordReviewResponse(response: "yes" | "no"): void {
  lsSet(response === "yes" ? K.yesTs : K.noTs, Date.now().toString());
}

export function setPendingReviewFlag(type: FlagType, key: PromptKey): void {
  lsSet(K.flagType,  type);
  lsSet(K.flagKey,   key);
  lsSet(K.flagSetTs, Date.now().toString());
}

export function getPendingReviewFlag(): { type: FlagType; key: PromptKey; setTs: number } | null {
  const type  = ls(K.flagType)  as FlagType | null;
  const key   = ls(K.flagKey)   as PromptKey | null;
  const setTs = parseInt(ls(K.flagSetTs) ?? "0");
  if (!type || !key || !setTs) return null;
  return { type, key, setTs };
}

export function clearPendingReviewFlag(): void {
  lsDel(K.flagType);
  lsDel(K.flagKey);
  lsDel(K.flagSetTs);
}

export function isPromptDone(key: PromptKey): boolean {
  return ls(`wya_review_${key}`) === "true";
}

export function markPromptDone(key: PromptKey): void {
  lsSet(`wya_review_${key}`, "true");
  clearPendingReviewFlag();
}

// Check milestone conditions (P1, P3, P4, P5) and set flag if any are met.
// Does not overwrite an existing pending flag.
export function checkAndSetMilestoneFlag(meals: MealLog[]): void {
  if (getPendingReviewFlag()) return;

  const now = Date.now();
  const real = meals.filter(
    (m) => m.analysisJson?.source !== "supplement" && m.status !== "failed"
  );
  if (!real.length) return;

  const firstTs = Math.min(...real.map((m) => m.ts));
  const days = Math.floor((now - firstTs) / DAY);
  const recent = real.filter((m) => now - m.ts < 30 * DAY).length;

  if (!isPromptDone("p1") && hasEnoughDataForPatterns(meals) && canShowReviewPrompt()) {
    setPendingReviewFlag("milestone", "p1"); return;
  }
  if (!isPromptDone("p3") && days >= 60  && recent >= 15 && canShowReviewPrompt()) {
    setPendingReviewFlag("milestone", "p3"); return;
  }
  if (!isPromptDone("p4") && days >= 180 && recent >= 15 && canShowReviewPrompt()) {
    setPendingReviewFlag("milestone", "p4"); return;
  }
  if (!isPromptDone("p5") && days >= 365 && recent >= 15 && canShowReviewPrompt()) {
    setPendingReviewFlag("milestone", "p5"); return;
  }
}
