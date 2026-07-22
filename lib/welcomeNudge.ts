// One-time "welcome" nudge shown in the coach-nudge spot on the day nudges unlock, so the slot
// isn't a bare "Monitoring Your Patterns" the moment they open up. It behaves like a regular nudge
// (on the home hero when no habit builder occupies it, pushed to Insights when one does), but it's
// synthetic: it lives ONLY on the unlock day and never lights the nav bell. Injected as a fallback
// in the currentWindowNudge memos in HomeScreen + SummaryScreen; the bell is guarded against it.

const UNLOCK_DATE_KEY = "wya_nudges_unlocked_date";

export const WELCOME_NUDGE_TYPE = "welcome" as const;
export const WELCOME_NUDGE_MESSAGE =
  "You've unlocked your nudges! I'll keep following your patterns, and when something useful comes up, I'll let you know. Excited to help you through this journey!";

export type WelcomeNudge = {
  id: string;
  type: typeof WELCOME_NUDGE_TYPE;
  message: string;
  created_at: string;
  why: null;
  action: null;
  suggestions: never[];
};

// Record the unlock day the first time nudges become available (>=5 logged meals). Idempotent —
// it keeps the FIRST day it was called with unlocked=true, so the welcome only appears that day.
export function recordNudgeUnlockDate(unlocked: boolean, todayKey: string): void {
  if (typeof window === "undefined" || !unlocked) return;
  try {
    if (!localStorage.getItem(UNLOCK_DATE_KEY)) localStorage.setItem(UNLOCK_DATE_KEY, todayKey);
  } catch { /* ignore */ }
}

// The welcome nudge — but only on the unlock day itself. Null on every other day (so it's gone by
// the next day) and before nudges have unlocked.
export function getWelcomeNudge(todayKey: string): WelcomeNudge | null {
  if (typeof window === "undefined") return null;
  let unlockDate: string | null = null;
  try { unlockDate = localStorage.getItem(UNLOCK_DATE_KEY); } catch { /* ignore */ }
  if (!unlockDate || unlockDate !== todayKey) return null;
  return {
    id: `welcome-${unlockDate}`,
    type: WELCOME_NUDGE_TYPE,
    message: WELCOME_NUDGE_MESSAGE,
    created_at: `${unlockDate}T12:00:00`,
    why: null,
    action: null,
    suggestions: [],
  };
}
