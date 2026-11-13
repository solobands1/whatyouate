"use client";

import { useState } from "react";
import WyaaAvatar from "./WyaaAvatar";
import type { FeelingGoal } from "../lib/types";

// The soft "turn on notifications" ask. It used to close onboarding, which put it within a minute
// of the Apple Health and camera prompts. It now shows once their first meal (or first glass of
// water) is logged, after "Nice Start!", when there's a real reminder worth sending. HomeScreen
// decides when (lib/push pushAskDue) and owns the handlers: "Turn On Notifications" fires the
// real iOS dialog, "Maybe Later" defers to the fallback banner (PushNotificationSetup).

// Sample morning push, tailored to their first feeling goal. Every one is a tiny, effortless action
// (a glass of water, a few minutes of daylight) so notifications read as easy wins, not homework.
// Illustrative, not a claim about data the user hasn't logged.
const SAMPLE_NUDGES: Record<FeelingGoal, string> = {
  energy:    "Drink a glass of water when you wake up. One of the easiest ways to shake off morning grogginess",
  sleep:     "Catch a few minutes of morning daylight. It quietly sets you up for better sleep tonight",
  mood:      "Step outside for two minutes of daylight. A quick, easy mood lift",
  focus:     "Have a glass of water now. Even mild thirst can quietly fog up your focus",
  digestion: "Sip some water between meals today. An easy way to keep things moving",
  triggers:  "Eat one meal a little slower today. It helps you notice how each food sits with you",
  cravings:  "Drink a glass of water before your next snack. Cravings often fade on their own",
};

interface Props {
  goal?: FeelingGoal;
  onEnable: () => Promise<void> | void;
  onSkip: () => void;
}

export default function NotificationAsk({ goal, onEnable, onSkip }: Props) {
  const [busy, setBusy] = useState(false);
  const sampleBody = (goal && SAMPLE_NUDGES[goal]) || SAMPLE_NUDGES.energy;
  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try { await onEnable(); } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-white px-8"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "calc(env(safe-area-inset-bottom) + 40px)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Turn on notifications"
      data-notification-ask
    >
      <style>{`
        @keyframes notif-drop {
          0%   { opacity: 0; transform: translateY(-150%) scale(0.94); }
          70%  { opacity: 1; transform: translateY(5px) scale(1); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes notif-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes notif-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes glow-pulse { 0%,100% { opacity: 0.5; transform: scale(1); } 50% { opacity: 0.85; transform: scale(1.1); } }
        .notif-icon  { animation: notif-rise 0.5s ease 0.05s both; }
        .notif-title { animation: notif-rise 0.5s ease 0.1s both; }
        .notif-card  { animation: notif-drop 0.7s cubic-bezier(0.22,1,0.36,1) 0.35s both; }
        .notif-card2 { animation: notif-drop 0.7s cubic-bezier(0.22,1,0.36,1) 0.52s both; }
        .notif-copy  { animation: notif-rise 0.5s ease 1s both; }
        .notif-cta   { animation: notif-rise 0.5s ease 1.15s both; }
        .notif-glow  { animation: glow-pulse 4.5s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .notif-icon, .notif-title, .notif-card, .notif-card2, .notif-copy, .notif-cta { animation: notif-fade 0.3s ease both; }
          .notif-glow { animation: none; opacity: 0.6; }
        }
      `}</style>

      {/* Coach orb floats above the title (absolute) so the title and everything below stay put */}
      <div className="relative w-full max-w-sm">
        <div className="notif-icon absolute inset-x-0 bottom-full mb-4 flex justify-center">
          <WyaaAvatar size={68} />
        </div>
        <p className="notif-title w-full text-center text-2xl font-semibold text-ink">Let Your Coach Reach You</p>
      </div>

      {/* Two mock iOS pushes cascade in beneath the title, over a soft glow: the daily rhythm */}
      <div className="relative mt-9 w-full max-w-sm">
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="notif-glow h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        </div>
        <div className="relative space-y-2.5">
          {/* Morning: a tiny, effortless win, tailored to their goal */}
          <div className="notif-card flex items-start gap-2.5 rounded-2xl bg-white p-3.5 shadow-[0_10px_34px_rgba(20,40,80,0.16)] ring-1 ring-black/5">
            <div className="h-9 w-9 shrink-0">
              <img src="/icon.svg" alt="" className="h-full w-full" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[13px] font-semibold text-ink">WhatYouAte</p>
                <span className="shrink-0 text-[11px] text-muted/50">9:00 AM</span>
              </div>
              <p className="mt-0.5 text-[13px] font-medium leading-snug text-ink">A Tiny Win For Today</p>
              <p className="text-[13px] leading-snug text-ink/70">{sampleBody}</p>
            </div>
          </div>
          {/* Evening: the reflection reminder, softer shadow so it recedes a touch */}
          <div className="notif-card2 flex items-start gap-2.5 rounded-2xl bg-white p-3.5 shadow-[0_5px_18px_rgba(20,40,80,0.09)] ring-1 ring-black/5">
            <div className="h-9 w-9 shrink-0">
              <img src="/icon.svg" alt="" className="h-full w-full" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[13px] font-semibold text-ink">WhatYouAte</p>
                <span className="shrink-0 text-[11px] text-muted/50">7:00 PM</span>
              </div>
              <p className="mt-0.5 text-[13px] font-medium leading-snug text-ink">Your Nightly Reflection Is Ready</p>
              <p className="text-[13px] leading-snug text-ink/70">Open the app to complete it</p>
            </div>
          </div>
        </div>
      </div>

      <p className="notif-copy mt-9 w-full max-w-sm text-center text-sm leading-relaxed text-muted/70">
        Small, timely nudges through the day and a reminder to reflect at night. Turn notifications on, so your coach can actually reach you.
      </p>

      <div className="notif-cta mt-[72px] w-full max-w-sm space-y-3">
        <button
          type="button"
          className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-60"
          onClick={enable}
          disabled={busy}
        >
          Turn On Notifications
        </button>
        <button type="button" className="w-full py-2 text-sm font-medium text-ink/40" onClick={onSkip} disabled={busy}>
          Maybe Later
        </button>
      </div>
    </div>
  );
}
