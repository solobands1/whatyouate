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
}

// Per-template cadence memory. snoozeCount tracks "Maybe Later" taps (2 = treat as
// No Thanks). shelvedUntil is an ISO date before which the template won't resurface.
export interface TemplateCadence {
  snoozeCount: number;
  shelvedUntil: string | null;
}

export interface HabitCadence {
  lastEndedAt: string | null;          // when the last builder finished/declined (2-day breather)
  suggestionId: string | null;         // template currently offered in the hero (if any)
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
  cadence: { lastEndedAt: null, suggestionId: null, templates: {} },
};

// Days to wait after a builder ends before the next one is suggested (the "breather").
export const HABIT_BREATHER_DAYS = 2;
