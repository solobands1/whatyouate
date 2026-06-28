// Persisted shapes for the habit builder + nightly reflections, plus the pure
// cadence logic that decides what the home hero shows. Kept separate from the
// catalog (habits.ts) and the DB layer (supabaseDb.ts) so the rules are testable
// and the UI stays thin.

export type HabitBuilderStatus =
  | "suggested" | "accepting" | "committed" | "active"
  | "dayComplete" | "done" | "missed" | "hidden";

// The single in-progress (or freshly suggested) builder.
export interface ActiveBuilder {
  templateId: string;
  status: HabitBuilderStatus;
  days: boolean[][];          // [day][checkpoint] completion grid
  startedAt: string | null;   // ISO date the tracker went active; drives midnight rollover
  holdDay?: number | null;    // post-completion pause: keep this day on screen
  finishedAt?: string;        // ISO when the builder completed (status "done")
  keptAnswer?: "yes" | "maybe" | "no" | null; // the "keep this up?" answer, once given
}

// Per-template cadence memory. snoozeCount tracks "Maybe Later" taps (2 = treat as
// No Thanks). shelvedUntil is an ISO date before which the template won't resurface.
export interface TemplateCadence {
  snoozeCount: number;
  shelvedUntil: string | null;
}

export interface HabitCadence {
  lastEndedAt: string | null;          // when the last builder finished/declined (2-day breather)
  suggestionId: string | null;         // template to (re)offer when a suggestion is due
  suggestionHoldUntil: string | null;  // don't show a suggestion before this (Maybe Later → tomorrow)
  templates: Record<string, TemplateCadence>;
}

export interface HabitState {
  builder: ActiveBuilder | null;
  cadence: HabitCadence;
}

export interface HabitHistoryEntry {
  templateId: string;
  title: string;
  days: number;                        // durationDays
  finishedAt: string;                  // ISO
  keep: "yes" | "maybe" | "no" | null; // the post-habit "keep this up?" answer
}

export interface ReflectionEntry {
  date: string;                        // YYYY-MM-DD (one per day)
  answers: Record<string, number | number[]>;
  note: string;
  ts: number;
}

export const EMPTY_HABIT_STATE: HabitState = {
  builder: null,
  cadence: { lastEndedAt: null, suggestionId: null, suggestionHoldUntil: null, templates: {} },
};

// Days to wait after a builder ends before the next one is suggested (the "breather").
export const HABIT_BREATHER_DAYS = 2;

// ── Cadence logic ──────────────────────────────────────────────────────────
// Pure functions that decide which habit (if any) to surface and how the snooze /
// decline rules age out. Time is injected so they're testable.

const DAY_MS = 86_400_000;

function isPast(iso: string | null, now: Date): boolean {
  return !iso || new Date(iso).getTime() <= now.getTime();
}
function startOfTomorrowISO(now: Date): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}
function addDaysISO(days: number, now: Date): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

// Which template to suggest right now, or null if we're mid-breather, holding after a
// snooze, or nothing eligible is off cooldown. `eligibleIds` should already be the
// goal-matched standard templates, in priority order.
export function pickSuggestionId(state: HabitState, eligibleIds: string[], now: Date = new Date()): string | null {
  const { cadence } = state;
  if (cadence.lastEndedAt && now.getTime() - new Date(cadence.lastEndedAt).getTime() < HABIT_BREATHER_DAYS * DAY_MS) {
    return null; // still in the post-habit breather
  }
  if (!isPast(cadence.suggestionHoldUntil, now)) return null; // soft-snoozed until tomorrow
  const notShelved = (id: string) => isPast(cadence.templates[id]?.shelvedUntil ?? null, now);
  // Re-offer the previously held one first (e.g. after a Maybe Later), else next eligible.
  if (cadence.suggestionId && eligibleIds.includes(cadence.suggestionId) && notShelved(cadence.suggestionId)) {
    return cadence.suggestionId;
  }
  return eligibleIds.find(notShelved) ?? null;
}

// "Maybe Later": re-offer the same habit tomorrow. The second snooze on a habit is
// treated as a "No Thanks" (shelve it for its cooldown, start the breather).
export function snoozeSuggestion(state: HabitState, templateId: string, cooldownDays: number, now: Date = new Date()): HabitState {
  const prev = state.cadence.templates[templateId] ?? { snoozeCount: 0, shelvedUntil: null };
  const snoozeCount = prev.snoozeCount + 1;
  if (snoozeCount >= 2) return declineSuggestion(state, templateId, cooldownDays, now);
  return {
    ...state,
    builder: null,
    cadence: {
      ...state.cadence,
      suggestionId: templateId,
      suggestionHoldUntil: startOfTomorrowISO(now),
      templates: { ...state.cadence.templates, [templateId]: { ...prev, snoozeCount } },
    },
  };
}

// "No Thanks" (or a second Maybe Later): shelve the habit for its cooldown, offer
// something different next time, and start the breather.
export function declineSuggestion(state: HabitState, templateId: string, cooldownDays: number, now: Date = new Date()): HabitState {
  return {
    ...state,
    builder: null,
    cadence: {
      ...state.cadence,
      lastEndedAt: now.toISOString(),
      suggestionId: null,
      suggestionHoldUntil: null,
      templates: { ...state.cadence.templates, [templateId]: { snoozeCount: 0, shelvedUntil: addDaysISO(cooldownDays, now) } },
    },
  };
}

// A habit ended: shelve that template for its cooldown and start the breather. The
// builder is left untouched so a finished "done" confirmation can stay on screen until
// the day rolls over.
export function markHabitEnded(state: HabitState, templateId: string, cooldownDays: number, now: Date = new Date()): HabitState {
  return {
    ...state,
    cadence: {
      ...state.cadence,
      lastEndedAt: now.toISOString(),
      suggestionId: null,
      suggestionHoldUntil: null,
      templates: { ...state.cadence.templates, [templateId]: { snoozeCount: 0, shelvedUntil: addDaysISO(cooldownDays, now) } },
    },
  };
}

// As above, but also clears the builder (used when the confirmation should go away,
// e.g. the day after completion).
export function endBuilderCompleted(state: HabitState, templateId: string, cooldownDays: number, now: Date = new Date()): HabitState {
  return { ...markHabitEnded(state, templateId, cooldownDays, now), builder: null };
}
