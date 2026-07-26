"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { clearProfileCache } from "../lib/supabaseDb";
import { notifyProfileUpdated } from "../lib/dataEvents";
import { requestHealthKitPermissions, checkHealthKitAuthorization, syncHealthKitActivity } from "../lib/healthKit";
import { Capacitor } from "@capacitor/core";
import { initPush, PUSH_ASKED_KEY, PUSH_DECLINED_AT_KEY } from "../lib/push";
import WyaaAvatar from "./WyaaAvatar";
import WheelPicker from "./WheelPicker";
import type { ActivityLevel, FeelingGoal, GoalDirection } from "../lib/types";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const DIETARY_OPTIONS = [
  "Vegetarian","Vegan","No dairy","No gluten","No nuts","No shellfish","No pork","Halal","Kosher",
];

const GOALS: { value: GoalDirection; label: string; sub: string }[] = [
  { value: "gain",     label: "Gain Weight",  sub: "We'll focus on fueling your growth and performance" },
  { value: "maintain", label: "Stay Steady",  sub: "We'll help you stay balanced and spot patterns over time" },
  { value: "lose",     label: "Lose Weight",  sub: "We'll help you do it steadily and keep your energy up" },
];

const FEELING_GOALS: { value: FeelingGoal; label: string }[] = [
  { value: "energy", label: "More Energy" },
  { value: "sleep", label: "Better Sleep" },
  { value: "mood", label: "Better Mood" },
  { value: "focus", label: "Sharper Focus" },
  { value: "digestion", label: "Better Digestion" },
  { value: "cravings", label: "Fewer Cravings" },
];

// Sample morning push shown on the notifications screen, tailored to the chosen goal. Every one
// is a tiny, effortless action (a glass of water, a few minutes of daylight) so notifications
// read as easy wins, not homework. Illustrative — not a claim about data the user hasn't logged.
const SAMPLE_NUDGES: Record<FeelingGoal, string> = {
  energy:    "Drink a glass of water when you wake up. One of the easiest ways to shake off morning grogginess",
  sleep:     "Catch a few minutes of morning daylight. It quietly sets you up for better sleep tonight",
  mood:      "Step outside for two minutes of daylight. A quick, easy mood lift",
  focus:     "Have a glass of water now. Even mild thirst can quietly fog up your focus",
  digestion: "Sip some water between meals today. An easy way to keep things moving",
  cravings:  "Drink a glass of water before your next snack. Cravings often fade on their own",
};

const ACTIVITY_LEVELS: { value: ActivityLevel; label: string; sub: string }[] = [
  { value: "very_active",       label: "Very Active",        sub: "Training most days or physical job" },
  { value: "moderately_active", label: "Moderately Active",  sub: "Exercise 3–4x/week" },
  { value: "lightly_active",    label: "Lightly Active",     sub: "Daily walks, errands, housework" },
  { value: "sedentary",         label: "Not Very Active",    sub: "Desk job, minimal movement" },
];

function calculateAgeFromDob(dobStr: string): number | null {
  if (!dobStr) return null;
  const birth = new Date(dobStr + "T00:00:00");
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

interface Props {
  userId: string;
  firstName: string;
  lastName?: string;
  onComplete: () => void;
}

export default function OnboardingFlow({ userId, firstName, lastName, onComplete }: Props) {
  const [showIntro, setShowIntro] = useState(true);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showNotifPrompt, setShowNotifPrompt] = useState(false);
  const [animStep, setAnimStep] = useState(0);
  const [introAnimStep, setIntroAnimStep] = useState(0);
  const [dobMonth, setDobMonth] = useState("");
  const [dobDay, setDobDay] = useState("");
  const [dobYear, setDobYear] = useState("");
  const [sex, setSex] = useState<"male" | "female" | "prefer_not" | "">();
  const [units, setUnits] = useState<"imperial" | "metric">("imperial");
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weight, setWeight] = useState("");
  const [goalDirection, setGoalDirection] = useState<GoalDirection | "">("");
  const [feelingGoals, setFeelingGoals] = useState<FeelingGoal[]>([]);
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | "">("");
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [healthChoice, setHealthChoice] = useState<"yes" | "no" | null>(null);
  const [healthKitConnecting, setHealthKitConnecting] = useState(false);
  const [healthKitGranted, setHealthKitGranted] = useState<boolean | null>(null);

  useEffect(() => {
    const t1 = setTimeout(() => setIntroAnimStep(1), 80);
    const t2 = setTimeout(() => setIntroAnimStep(2), 380);
    const t3 = setTimeout(() => setIntroAnimStep(3), 660);
    const t4 = setTimeout(() => setIntroAnimStep(4), 950);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, []);

  useEffect(() => {
    if (!showWelcome) return;
    const t1 = setTimeout(() => setAnimStep(1), 80);
    const t2 = setTimeout(() => setAnimStep(2), 450);
    const t3 = setTimeout(() => setAnimStep(3), 820);
    const t4 = setTimeout(() => setAnimStep(4), 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [showWelcome]);

  const handleSaveAndFinish = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      const dobString = dobYear && dobMonth && dobDay
        ? `${dobYear}-${dobMonth.padStart(2, "0")}-${dobDay.padStart(2, "0")}`
        : "";
      if (dobString) localStorage.setItem(`wya_dob_${userId}`, dobString);

      let heightCmVal: number | null = null;
      let weightKgVal: number | null = null;
      if (units === "metric") {
        const cm = parseInt(heightCm || "0", 10);
        heightCmVal = cm > 0 ? cm : null;
        const kg = parseFloat(weight || "0");
        weightKgVal = kg > 0 ? Math.round(kg * 10) / 10 : null;
      } else {
        const ft = parseInt(heightFt || "0", 10);
        const inch = parseInt(heightIn || "0", 10);
        const totalIn = ft * 12 + inch;
        heightCmVal = totalIn > 0 ? Math.round(totalIn * 2.54) : null;
        const lb = parseFloat(weight || "0");
        weightKgVal = lb > 0 ? Math.round((lb / 2.20462) * 10) / 10 : null;
      }

      const { error } = await supabase.from("profiles").upsert({
        user_id: userId,
        first_name: firstName || null,
        last_name: lastName || null,
        age: calculateAgeFromDob(dobString) ?? null,
        date_of_birth: dobString || null,
        sex: sex || "prefer_not",
        height: heightCmVal,
        weight: weightKgVal,
        goal_direction: goalDirection || "maintain",
        feeling_goals: feelingGoals,
        activity_level: activityLevel || null,
        dietary_restrictions: dietaryRestrictions,
        units,
        track_water: true,
        onboarding_done: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;

      clearProfileCache(userId);
      localStorage.setItem(`wya_profile_updated_${userId}`, String(Date.now()));
      notifyProfileUpdated();
      setSaving(false);
      setShowNotifPrompt(true);
    } catch {
      // Don't advance (which marks onboarding done) on a failed write — a user flagged onboarded
      // with no saved profile gets a broken first session (no targets) and never re-prompts. Keep
      // them here with a retry; their entries are preserved in component state.
      setSaving(false);
      setSaveError(true);
    }
  };

  // Notifications ask — the soft pre-prompt lives here in onboarding (peak intent). "Turn On"
  // fires the real iOS dialog; "Maybe Later" defers. Both set the shared wya_push_permission_asked
  // flag so the fallback banner (PushNotificationSetup) won't double-ask.
  const handleEnableNotifs = async () => {
    localStorage.setItem(PUSH_ASKED_KEY, "1");
    localStorage.removeItem(PUSH_DECLINED_AT_KEY);
    if (Capacitor.isNativePlatform()) { try { await initPush(userId); } catch { /* proceed regardless */ } }
    setShowNotifPrompt(false);
    setShowWelcome(true);
  };
  const handleSkipNotifs = () => {
    localStorage.setItem(PUSH_ASKED_KEY, "declined");
    localStorage.setItem(PUSH_DECLINED_AT_KEY, String(Date.now()));
    setShowNotifPrompt(false);
    setShowWelcome(true);
  };

  const next = () => setStep((s) => s + 1);
  const canContinueDob = dobMonth && dobDay && dobYear;
  const canContinueHeight = units === "metric"
    ? heightCm && weight
    : (heightFt || heightIn) && weight;
  const progress = (step / 8) * 100;

  const animStyle = (show: boolean) => ({
    opacity: show ? 1 : 0,
    transform: show ? "translateY(0)" : "translateY(-14px)",
    transition: "opacity 0.45s ease, transform 0.45s ease",
  });

  const selectCls = "rounded-xl border border-ink/10 bg-surface px-2 py-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30";
  const skipCls = "w-full py-2 text-sm font-medium text-ink/40";

  // Intro screen
  if (showIntro) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white safe-top px-6">
        <div className="flex flex-1 flex-col items-center text-center pt-[18vh]">
          <div style={animStyle(introAnimStep >= 1)} className="mb-6 h-[88px] w-[88px]">
            <img src="/icon.svg" alt="WhatYouAte" className="h-full w-full object-cover" />
          </div>
          <div style={animStyle(introAnimStep >= 2)}>
            <h1 className="text-xl font-semibold text-ink">Welcome to WhatYouAte!</h1>
          </div>
          <div style={animStyle(introAnimStep >= 3)}>
            <p className="mt-5 text-sm leading-[1.7] text-muted/70 max-w-[260px] mx-auto">
              Let's get started with a few questions to personalize your experience!
            </p>
            <p className="mt-2 text-sm leading-[1.7] text-muted/60 max-w-[260px] mx-auto">
              You can update everything anytime from your profile.
            </p>
          </div>
          <div style={animStyle(introAnimStep >= 4)} className="w-1/2 mt-10">
            <button
              type="button"
              className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80"
              onClick={() => setShowIntro(false)}
            >
              Get Started!
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Welcome animation
  if (showNotifPrompt) {
    const sampleBody = SAMPLE_NUDGES[feelingGoals[0] ?? "energy"] ?? SAMPLE_NUDGES.energy;
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-8"
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "calc(env(safe-area-inset-bottom) + 40px)" }}
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

        {/* Two mock iOS pushes cascade in beneath the title, over a soft glow — the daily rhythm */}
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
            {/* Evening: the reflection reminder — softer shadow so it recedes a touch */}
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
                <p className="text-[13px] leading-snug text-ink/70">It only takes a minute, and it'll help a lot</p>
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
            className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80"
            onClick={handleEnableNotifs}
          >
            Turn On Notifications
          </button>
          <button type="button" className={skipCls} onClick={handleSkipNotifs}>
            Maybe Later
          </button>
        </div>
      </div>
    );
  }

  if (showWelcome) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center bg-white px-8 pt-[28vh]">
        <style>{`
          @keyframes draw-circle { from { stroke-dashoffset: 63; } to { stroke-dashoffset: 0; } }
          @keyframes draw-check { from { stroke-dashoffset: 12; } to { stroke-dashoffset: 0; } }
          @keyframes confetti-fall {
            0%   { transform: translateY(-8vh) translateX(0) rotate(0deg); }
            25%  { transform: translateY(26vh) translateX(-16px) rotate(70deg); }
            50%  { transform: translateY(54vh) translateX(14px) rotate(150deg); }
            75%  { transform: translateY(82vh) translateX(-12px) rotate(240deg); }
            100% { transform: translateY(112vh) translateX(8px) rotate(320deg); }
          }
          @keyframes confetti-fall-alt {
            0%   { transform: translateY(-8vh) translateX(0) rotate(0deg); }
            25%  { transform: translateY(24vh) translateX(15px) rotate(-60deg); }
            50%  { transform: translateY(52vh) translateX(-14px) rotate(-140deg); }
            75%  { transform: translateY(80vh) translateX(12px) rotate(-230deg); }
            100% { transform: translateY(112vh) translateX(-8px) rotate(-310deg); }
          }
          @keyframes confetti-fall-c {
            0%   { transform: translateY(-8vh) translateX(0) rotate(0deg); }
            30%  { transform: translateY(32vh) translateX(-10px) rotate(100deg); }
            60%  { transform: translateY(62vh) translateX(16px) rotate(190deg); }
            100% { transform: translateY(112vh) translateX(-6px) rotate(280deg); }
          }
          .confetti-piece { position: absolute; top: 0; animation-timing-function: linear; animation-iteration-count: 1; animation-fill-mode: both; will-change: transform, opacity; }
          @media (prefers-reduced-motion: reduce) { .confetti-piece { animation: none !important; opacity: 0 !important; } }
        `}</style>
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          {Array.from({ length: 20 }).map((_, i) => {
            const palette = ["#82B8FF", "#A9CCFF", "#BBD4FF", "#6FA8FF"];
            const opacities = [0.3, 0.5, 0.7];
            const anims = ["confetti-fall", "confetti-fall-alt", "confetti-fall-c"];
            const w = 6 + (i % 3) * 1.5;     // 6-9px
            const h = 12 + (i % 4) * 2;      // 12-18px (taller than wide)
            return (
              <span
                key={i}
                className="confetti-piece"
                style={{
                  left: `${(i * 37 + 6) % 100}%`,
                  width: w,
                  height: h,
                  background: palette[i % palette.length],
                  opacity: opacities[i % 3],            // 3 transparency levels
                  borderRadius: "2px",                  // slight corner, mostly rectangular
                  animationName: anims[i % 3],          // 3 fluttering paths
                  animationDelay: `${(i % 6) * 0.14}s`,         // quick burst at the start
                  animationDuration: `${5.5 + (i % 5) * 1.1}s`, // varied fall speeds
                }}
              />
            );
          })}
        </div>
        <div className="relative z-10 flex flex-col items-center gap-5 text-center">
          <div style={animStyle(animStep >= 1)}>
            <svg className="h-28 w-28 text-primary/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" style={{ strokeDasharray: 63, strokeDashoffset: 63, animation: "draw-circle 0.55s ease-out 0.5s forwards" }} />
              <path d="M8 12l3 3 5-5" style={{ strokeDasharray: 12, strokeDashoffset: 12, animation: "draw-check 0.35s ease-out 1.0s forwards" }} />
            </svg>
          </div>
          <div style={animStyle(animStep >= 2)}>
            <p className="text-2xl font-semibold text-ink">You're All Set</p>
          </div>
          <div style={animStyle(animStep >= 3)}>
            <p className="text-sm text-muted/65">Let's take a look around!</p>
          </div>
        </div>
        <div style={animStyle(animStep >= 4)} className="relative z-10 flex justify-center w-full mt-16">
          <button
            type="button"
            className="w-2/3 rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80"
            onClick={onComplete}
          >
            Let's Go!
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white safe-top">
      {/* Progress bar */}
      <div className="h-1 w-full bg-ink/8">
        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex flex-1 flex-col px-6 overflow-y-auto">

        {/* Step 0: Date of birth */}
        {step === 0 && (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between pt-5">
              <button type="button" className="p-1 active:opacity-50" onClick={() => setShowIntro(true)}>
                <svg className="h-5 w-5 text-ink/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 1 of 8</p>
            </div>
            <div className="mt-[10vh]">
              <div className="flex justify-center mb-5">
                <svg className="h-10 w-10 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2"/>
                  <path d="M16 2v4M8 2v4M3 10h18"/>
                  <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-ink text-center">When Were You Born?</h1>
              <p className="mt-2 text-sm text-muted/70 text-center">This helps us personalize your energy and nutrition targets</p>
              <div className="mt-8 flex justify-center gap-2">
                <select
                  className={`w-[120px] ${selectCls}`}
                  value={dobMonth}
                  onChange={(e) => { setDobMonth(e.target.value); setDobDay(""); }}
                >
                  <option value="">Month</option>
                  {MONTHS.map((m, i) => <option key={i} value={String(i + 1)}>{m}</option>)}
                </select>
                <select
                  className={`w-[72px] ${selectCls}`}
                  value={dobDay}
                  onChange={(e) => setDobDay(e.target.value)}
                >
                  <option value="">Day</option>
                  {Array.from(
                    { length: dobYear && dobMonth ? new Date(Number(dobYear), Number(dobMonth), 0).getDate() : 31 },
                    (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>
                  )}
                </select>
                <select
                  className={`w-[90px] ${selectCls}`}
                  value={dobYear}
                  onChange={(e) => {
                    const newYear = e.target.value;
                    setDobYear(newYear);
                    if (dobMonth && dobDay && newYear) {
                      const maxDays = new Date(Number(newYear), Number(dobMonth), 0).getDate();
                      if (Number(dobDay) > maxDays) setDobDay("");
                    }
                  }}
                >
                  <option value="">Year</option>
                  {Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - 13 - i).map((y) => (
                    <option key={y} value={String(y)}>{y}</option>
                  ))}
                </select>
              </div>
              <div className="mt-28 space-y-3">
                <button
                  type="button"
                  className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-40"
                  disabled={!canContinueDob}
                  onClick={next}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Sex */}
        {step === 1 && (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between pt-5">
              <button type="button" className="p-1 active:opacity-50" onClick={() => setStep(0)}>
                <svg className="h-5 w-5 text-ink/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 2 of 8</p>
            </div>
            <div className="mt-[8vh]">
              <div className="flex justify-center mb-5">
                <svg className="h-10 w-10 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2"/>
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-ink text-center">What's Your Biological Sex?</h1>
              <p className="mt-2 text-sm text-muted/70 text-center">This helps us personalize your targets</p>
              <div className="mt-8 flex flex-col gap-3">
                {(["male","female","prefer_not"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`w-full rounded-xl border py-4 text-sm font-medium transition active:opacity-80 ${
                      sex === v ? "border-primary bg-primary/10 text-primary" : "border-ink/10 text-ink/70"
                    }`}
                    onClick={() => setSex(v)}
                  >
                    {v === "male" ? "Male" : v === "female" ? "Female" : "Prefer Not To Say"}
                  </button>
                ))}
              </div>
              <div className="mt-10">
                <button
                  type="button"
                  className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-40"
                  disabled={!sex}
                  onClick={next}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Height + Weight */}
        {step === 2 && (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between pt-5">
              <button type="button" className="p-1 active:opacity-50" onClick={() => setStep(1)}>
                <svg className="h-5 w-5 text-ink/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 3 of 8</p>
            </div>
            <div className="mt-[8vh]">
              <div className="flex justify-center mb-5">
                <svg className="h-10 w-10 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.3 8.7 8.7 21.3c-1 1-2.5 1-3.4 0l-2.6-2.6c-1-1-1-2.5 0-3.4L15.3 2.7c1-1 2.5-1 3.4 0l2.6 2.6c1 1 1 2.5 0 3.4z"/>
                  <path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-ink text-center">Height & Weight</h1>
              <div className="mt-2 flex items-center justify-center gap-3">
                <p className="text-sm text-muted/70">This helps set your personal energy and nutrition baseline</p>
              </div>
              <div className="mt-3 flex justify-center">
                <div className="inline-flex rounded-full border border-ink/10 bg-ink/5 p-0.5 text-[10px]">
                  {(["imperial", "metric"] as const).map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      className={`rounded-full px-2.5 py-0.5 font-medium capitalize ${units === unit ? "bg-white text-ink" : "text-muted/60"}`}
                      onClick={() => {
                        if (unit === units) return;
                        if (unit === "imperial") {
                          const cm = parseInt(heightCm || "0", 10);
                          if (cm > 0) {
                            const totalIn = cm / 2.54;
                            setHeightFt(String(Math.floor(totalIn / 12)));
                            setHeightIn(String(Math.round(totalIn % 12)));
                          }
                          const kg = parseFloat(weight || "0");
                          if (kg > 0) setWeight(String(Math.round(kg * 2.20462)));
                        } else {
                          const ft = parseInt(heightFt || "0", 10);
                          const inch = parseInt(heightIn || "0", 10);
                          const totalIn = ft * 12 + inch;
                          if (totalIn > 0) setHeightCm(String(Math.round(totalIn * 2.54)));
                          const lb = parseFloat(weight || "0");
                          if (lb > 0) setWeight(String(Math.round(lb / 2.20462)));
                        }
                        setUnits(unit);
                      }}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-8 space-y-6">
                <div>
                  <p className="mb-2 text-xs font-medium text-muted/60">Height {units === "metric" ? "(cm)" : "(ft + in)"}</p>
                  {units === "metric" ? (
                    <WheelPicker
                      value={heightCm}
                      onChange={setHeightCm}
                      placeholder="Select"
                      title="Height"
                      defaultValue="170"
                      options={Array.from({ length: 101 }, (_, i) => 120 + i).map((cm) => ({ value: String(cm), label: `${cm} cm` }))}
                    />
                  ) : (
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <WheelPicker
                          value={heightFt}
                          onChange={setHeightFt}
                          placeholder="ft"
                          title="Feet"
                          defaultValue="5"
                          options={Array.from({ length: 6 }, (_, i) => 3 + i).map((ft) => ({ value: String(ft), label: `${ft} ft` }))}
                        />
                      </div>
                      <div className="flex-1">
                        <WheelPicker
                          value={heightIn}
                          onChange={setHeightIn}
                          placeholder="in"
                          title="Inches"
                          defaultValue="8"
                          options={Array.from({ length: 12 }, (_, i) => i).map((inch) => ({ value: String(inch), label: `${inch} in` }))}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-muted/60">Weight ({units === "metric" ? "kg" : "lbs"})</p>
                  <WheelPicker
                    value={weight}
                    onChange={setWeight}
                    placeholder="Select"
                    title="Weight"
                    defaultValue={units === "metric" ? "55" : "120"}
                    options={units === "metric"
                      ? Array.from({ length: 171 }, (_, i) => 30 + i).map((kg) => ({ value: String(kg), label: `${kg} kg` }))
                      : Array.from({ length: 391 }, (_, i) => 60 + i).map((lb) => ({ value: String(lb), label: `${lb} lbs` }))}
                  />
                </div>
              </div>
              <div className="mt-10 space-y-3">
                <button
                  type="button"
                  className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-40"
                  disabled={!canContinueHeight}
                  onClick={next}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Goal */}
        {step === 3 && (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between pt-5">
              <button type="button" className="p-1 active:opacity-50" onClick={() => setStep(2)}>
                <svg className="h-5 w-5 text-ink/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 4 of 8</p>
            </div>
            <div className="mt-[8vh]">
              <div className="flex justify-center mb-5">
                <svg className="h-10 w-10 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <circle cx="12" cy="12" r="6"/>
                  <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-ink text-center">What's Your Goal?</h1>
              <p className="mt-2 text-sm text-muted/70 text-center">This helps us understand what you're working toward</p>
              <div className="mt-8 flex flex-col gap-3">
                {GOALS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    className={`w-full rounded-xl border px-4 py-4 text-left transition active:opacity-80 ${
                      goalDirection === g.value ? "border-primary bg-primary/10" : "border-ink/10"
                    }`}
                    onClick={() => setGoalDirection(g.value)}
                  >
                    <p className={`text-sm font-medium ${goalDirection === g.value ? "text-primary" : "text-ink/80"}`}>
                      {g.label}
                    </p>
                    <p className="mt-0.5 text-xs text-muted/65">{g.sub}</p>
                  </button>
                ))}
              </div>
              <div className="mt-10">
                <button
                  type="button"
                  className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-40"
                  disabled={!goalDirection}
                  onClick={next}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Feeling goal */}
        {step === 4 && (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between pt-5">
              <button type="button" className="p-1 active:opacity-50" onClick={() => setStep(3)}>
                <svg className="h-5 w-5 text-ink/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 5 of 8</p>
            </div>
            <div className="mt-[8vh]">
              <div className="flex justify-center mb-5">
                <svg className="h-10 w-10 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-ink text-center">What Do You Want To Feel Better About?</h1>
              <p className="mt-2 text-sm text-muted/70 text-center">This shapes the habits we suggest and how your coach talks to you. <span className="font-semibold text-ink">Select up to 2 options</span>.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {FEELING_GOALS.map(({ value, label }) => {
                  const active = feelingGoals.includes(value);
                  const atCap = !active && feelingGoals.length >= 2;
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={atCap}
                      onClick={() => setFeelingGoals((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : prev.length >= 2 ? prev : [...prev, value])}
                      className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition ${active ? "border-primary bg-primary/10 text-primary" : atCap ? "border-ink/10 text-muted/35" : "border-ink/10 text-ink/80"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-10">
                <button
                  type="button"
                  className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80"
                  onClick={next}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Activity level */}
        {step === 5 && (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between pt-5">
              <button type="button" className="p-1 active:opacity-50" onClick={() => setStep(4)}>
                <svg className="h-5 w-5 text-ink/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 6 of 8</p>
            </div>
            <div className="mt-[4vh]">
              <div className="flex justify-center mb-5">
                <svg className="h-12 w-8 text-primary/40" viewBox="0 0 16 28" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 1L2 15h6l-2 12 10-16h-6l2-11z"/>
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-ink text-center">How Active Are You?</h1>
              <p className="mt-2 text-sm text-muted/70 text-center">This helps us gauge your daily energy needs</p>
              <div className="mt-8 flex flex-col gap-3">
                {ACTIVITY_LEVELS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    className={`w-full rounded-xl border px-4 py-4 text-left transition active:opacity-80 ${
                      activityLevel === a.value ? "border-primary bg-primary/10" : "border-ink/10"
                    }`}
                    onClick={() => setActivityLevel(a.value)}
                  >
                    <p className={`text-sm font-medium ${activityLevel === a.value ? "text-primary" : "text-ink/80"}`}>
                      {a.label}
                    </p>
                    <p className="mt-0.5 text-xs text-muted/65">{a.sub}</p>
                  </button>
                ))}
              </div>
              <div className="mt-10">
                <button
                  type="button"
                  className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-40"
                  disabled={!activityLevel}
                  onClick={next}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 6: Dietary restrictions */}
        {step === 6 && (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between pt-5">
              <button type="button" className="p-1 active:opacity-50" onClick={() => setStep(5)}>
                <svg className="h-5 w-5 text-ink/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 7 of 8</p>
            </div>
            <div className="mt-[8vh]">
              <div className="flex justify-center mb-5">
                <svg className="h-10 w-10 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
                  <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-ink text-center">Any Foods You Avoid?</h1>
              <p className="mt-2 text-sm text-muted/70 text-center">We'll make sure your coach never suggests these. Tap all that apply.</p>
              <div className="mt-12 flex flex-wrap justify-center gap-2">
                {DIETARY_OPTIONS.map((d) => {
                  const active = dietaryRestrictions.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition active:opacity-80 ${
                        active ? "border-primary/60 bg-primary/10 text-primary" : "border-ink/10 text-ink/60"
                      }`}
                      onClick={() =>
                        setDietaryRestrictions((prev) =>
                          active ? prev.filter((r) => r !== d) : [...prev, d]
                        )
                      }
                    >
                      {d}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition active:opacity-80 ${
                    dietaryRestrictions.length === 0 ? "border-primary/60 bg-primary/10 text-primary" : "border-ink/10 text-ink/60"
                  }`}
                  onClick={() => setDietaryRestrictions([])}
                >
                  Anything works for me!
                </button>
              </div>
              <div className="mt-16 space-y-3">
                <button
                  type="button"
                  className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80"
                  onClick={next}
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 7: Apple Health */}
        {step === 7 && (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between pt-5">
              <button type="button" className="p-1 active:opacity-50" onClick={() => { setStep(6); setHealthChoice(null); setHealthKitGranted(null); setHealthKitConnecting(false); }}>
                <svg className="h-5 w-5 text-ink/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 8 of 8</p>
            </div>
            <div className="mt-[14vh]">
              <div className="flex justify-center mb-5">
                {/* Apple Health app icon — white tile with the red/pink heart toward the upper-right, per the real app */}
                <svg viewBox="0 0 48 48" className="h-[72px] w-[72px]" role="img" aria-label="Apple Health">
                  <defs>
                    <linearGradient id="ah-heart" x1="0" y1="1" x2="0" y2="0">
                      <stop offset="0" stopColor="#F41F3F" />
                      <stop offset="1" stopColor="#FF5488" />
                    </linearGradient>
                  </defs>
                  <rect x="0.75" y="0.75" width="46.5" height="46.5" rx="11" fill="#fff" stroke="rgba(0,0,0,0.1)" strokeWidth="1.2" />
                  <path fill="url(#ah-heart)" transform="translate(16.7 5.65) scale(0.95)" d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-ink text-center">Connect Apple Health</h1>
              <p className="mt-2 text-sm text-muted/70 text-center">Sync steps, sleep, and workouts to make your AI Coach smarter.</p>

              {healthChoice === null && (
                <div className="mt-16 space-y-3">
                  <button
                    type="button"
                    className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-50"
                    disabled={healthKitConnecting}
                    onClick={async () => {
                      setHealthKitConnecting(true);
                      setHealthChoice("yes");
                      await requestHealthKitPermissions();
                      const granted = await checkHealthKitAuthorization();
                      if (granted) {
                        localStorage.setItem(`wya_healthkit_connected_${userId}`, "true");
                        syncHealthKitActivity(userId).catch(() => {});
                      }
                      setHealthKitGranted(granted);
                      setHealthKitConnecting(false);
                    }}
                  >
                    Yes, Connect
                  </button>
                  <button
                    type="button"
                    className={skipCls}
                    onClick={() => setHealthChoice("no")}
                  >
                    No Thanks
                  </button>
                </div>
              )}

              {healthChoice === "yes" && healthKitConnecting && (
                <div className="mt-10 flex justify-center">
                  <p className="text-sm text-muted/60">Connecting…</p>
                </div>
              )}

              {healthChoice === "yes" && !healthKitConnecting && (
                <div className="mt-10 space-y-3">
                  {healthKitGranted ? (
                    <div className="flex items-center justify-center gap-2 py-3">
                      <div className="h-2 w-2 rounded-full bg-emerald-400" />
                      <p className="text-sm font-semibold text-emerald-600">Connected to Apple Health</p>
                    </div>
                  ) : (
                    <p className="text-center text-sm text-muted/60">You can change this anytime from your profile settings</p>
                  )}
                  <button
                    type="button"
                    className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-50"
                    disabled={saving}
                    onClick={handleSaveAndFinish}
                  >
                    {saving ? "Saving…" : "Next"}
                  </button>
                </div>
              )}

              {healthChoice === "no" && (
                <div className="mt-10 space-y-3">
                  <p className="text-center text-sm text-muted/60">No problem, you can connect anytime from your profile settings.</p>
                  <button
                    type="button"
                    className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-50"
                    disabled={saving}
                    onClick={handleSaveAndFinish}
                  >
                    {saving ? "Saving…" : "Next"}
                  </button>
                </div>
              )}
              {saveError && (
                <p className="mt-4 text-center text-sm text-rose-500">Couldn&apos;t save your profile. Check your connection and tap Next to try again.</p>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
