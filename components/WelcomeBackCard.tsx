"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import { HABIT_TEMPLATES, type HabitTemplate } from "../lib/habits";
import { buildActivity, isRealMeal, quietState, COMEBACK_HABIT_ID } from "../lib/comeback";
import { dayKeyFromTs } from "../lib/utils";

// Welcome Back: the card Home shows when someone opens the app after 3+ quiet days (lib/comeback,
// the same rule that stops the daily pushes). One tap starts "Pick Back Up" through the normal habit
// builder (HomeScreen runs its usual accept flow); the X closes it. Shown once per comeback: the
// quiet stretch's first day is remembered on the device when the card first appears, and it stays up
// across tab switches that session until it's used or closed. Never for someone active, never for
// someone who has logged nothing yet (the first-meal step is theirs), and only while no habit is in
// progress, so it can't replace one.

const TEMPLATE = HABIT_TEMPLATES.find((t) => t.id === COMEBACK_HABIT_ID) ?? null;
const NUMBER_WORDS: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five" };
const seenKey = (userId: string) => `wya_welcome_back_${userId}`;
// The comeback this session is showing (`${userId}|${since}`), so remounting Home keeps it up.
let showingThisSession: string | null = null;

export default function WelcomeBackCard({ ready, canStart, onStart }: {
  ready: boolean;     // Home has loaded and nothing else owns the screen (walkthrough, onboarding, first-meal step)
  canStart: boolean;  // the habit hero is free: a suggestion or nothing, not a habit in progress
  onStart: (template: HabitTemplate) => void;
}) {
  const { user } = useAuth();
  const { meals, feelLogs, reflections, waterLogs } = useAppData();
  const quiet = useMemo(() => {
    if (!user) return null;
    const created = user.created_at ? Date.parse(user.created_at) : NaN;
    return quietState({
      activity: buildActivity({
        meals: meals.map((m) => ({ createdAt: m.createdAt ?? m.ts, status: m.status, source: m.analysisJson?.source })),
        feelTs: feelLogs.map((f) => f.ts),
        reflections,
        waterLogs,
      }),
      hasRealMeal: meals.some((m) => isRealMeal({ status: m.status, source: m.analysisJson?.source })),
      createdAtMs: Number.isFinite(created) ? created : null,
      nowMs: Date.now(),
      dayOf: dayKeyFromTs,
    });
  }, [user, meals, feelLogs, reflections, waterLogs]);
  const since = quiet?.quiet && !quiet.neverActive ? quiet.since : null;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open || !ready || !canStart || !user || !since || !TEMPLATE) return;
    const id = `${user.id}|${since}`;
    if (showingThisSession !== id) {
      try { if (localStorage.getItem(seenKey(user.id)) === since) return; } catch {}
      try { localStorage.setItem(seenKey(user.id), since); } catch {}
      showingThisSession = id;
    }
    setOpen(true);
  }, [open, ready, canStart, user, since]);

  if (!open || !ready || !canStart || !since || !TEMPLATE) return null;
  const template = TEMPLATE;
  const close = () => { showingThisSession = null; setOpen(false); };
  const days = NUMBER_WORDS[template.durationDays] ?? String(template.durationDays);

  return (
    <div data-welcome-back className="relative mt-3 rounded-2xl border border-primary/25 bg-primary/[0.06] p-4 shadow-[0_4px_16px_rgba(111,168,255,0.10)]">
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full text-ink/35 transition active:opacity-60"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <div className="flex items-center gap-3 pr-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-[0_2px_8px_rgba(111,168,255,0.28)]">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 18a5 5 0 0 0-10 0" />
            <path d="M12 2v7" />
            <path d="M8 6l4-4 4 4" />
            <path d="M4.22 10.22l1.42 1.42M1 18h2M21 18h2M18.36 11.64l1.42-1.42M23 22H1" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-ink">Welcome Back</p>
          <p className="text-[12.5px] leading-snug text-ink/60">{template.title} is {days} easy days, one log a day. Anything counts.</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => { close(); onStart(template); }}
        className="mt-3.5 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] [touch-action:manipulation]"
      >
        Start {template.title}
      </button>
    </div>
  );
}
