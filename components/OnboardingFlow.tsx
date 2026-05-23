"use client";

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { clearProfileCache } from "../lib/supabaseDb";
import { notifyProfileUpdated } from "../lib/dataEvents";
import type { ActivityLevel, GoalDirection } from "../lib/types";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const DIETARY_OPTIONS = [
  "Vegetarian","Vegan","No dairy","No gluten","No nuts","No shellfish","No pork","Halal","Kosher",
];

const GOALS: { value: GoalDirection; label: string; sub: string }[] = [
  { value: "lose",     label: "Lose Weight",  sub: "We'll focus on calorie awareness and building a healthy deficit." },
  { value: "maintain", label: "Stay Steady",  sub: "We'll help you stay balanced and spot patterns over time." },
  { value: "gain",     label: "Gain Weight",  sub: "We'll focus on fueling your growth and performance." },
];

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
  onComplete: () => void;
}

export default function OnboardingFlow({ userId, firstName, onComplete }: Props) {
  const [showIntro, setShowIntro] = useState(true);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [animStep, setAnimStep] = useState(0);
  const [introAnimStep, setIntroAnimStep] = useState(0);
  const [dobMonth, setDobMonth] = useState("");
  const [dobDay, setDobDay] = useState("");
  const [dobYear, setDobYear] = useState("");
  const [sex, setSex] = useState<"male" | "female" | "prefer_not" | "">();
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [weight, setWeight] = useState("");
  const [goalDirection, setGoalDirection] = useState<GoalDirection | "">("");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | "">("");
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);

  useEffect(() => {
    const t1 = setTimeout(() => setIntroAnimStep(1), 80);
    const t2 = setTimeout(() => setIntroAnimStep(2), 380);
    const t3 = setTimeout(() => setIntroAnimStep(3), 660);
    const t4 = setTimeout(() => setIntroAnimStep(4), 900);
    const t5 = setTimeout(() => setIntroAnimStep(5), 1100);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5); };
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
    try {
      const dobString = dobYear && dobMonth && dobDay
        ? `${dobYear}-${dobMonth.padStart(2, "0")}-${dobDay.padStart(2, "0")}`
        : "";
      if (dobString) localStorage.setItem(`wya_dob_${userId}`, dobString);

      const ft = parseInt(heightFt || "0", 10);
      const inch = parseInt(heightIn || "0", 10);
      const totalIn = ft * 12 + inch;
      const heightCm = totalIn > 0 ? Math.round(totalIn * 2.54) : null;
      const lb = parseFloat(weight || "0");
      const weightKg = lb > 0 ? Math.round((lb / 2.20462) * 10) / 10 : null;

      await supabase.from("profiles").upsert({
        user_id: userId,
        age: calculateAgeFromDob(dobString) ?? null,
        date_of_birth: dobString || null,
        sex: sex || "prefer_not",
        height: heightCm,
        weight: weightKg,
        goal_direction: goalDirection || "maintain",
        activity_level: activityLevel || null,
        dietary_restrictions: dietaryRestrictions,
        units: "imperial",
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

      clearProfileCache(userId);
      localStorage.setItem(`wya_profile_updated_${userId}`, String(Date.now()));
      notifyProfileUpdated();
    } catch { /* proceed regardless */ } finally {
      setSaving(false);
      setShowWelcome(true);
    }
  };

  const next = () => setStep((s) => s + 1);
  const canContinueDob = dobMonth && dobDay && dobYear;
  const canContinueHeight = (heightFt || heightIn) && weight;
  const progress = (step / 6) * 100;

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
          <div style={animStyle(introAnimStep >= 1)} className="mb-6 h-24 w-24 overflow-hidden rounded-[22px] border border-ink/10 shadow-[0_8px_28px_rgba(111,168,255,0.28)]">
            <img src="/icon-512.png" alt="WhatYouAte" className="h-full w-full object-cover" />
          </div>
          <div style={animStyle(introAnimStep >= 2)}>
            <h1 className="text-xl font-semibold text-ink">Welcome to WhatYouAte!</h1>
          </div>
          <div style={animStyle(introAnimStep >= 3)}>
            <p className="mt-4 text-sm leading-relaxed text-muted/65">
              Before we dive in, let's get you set up. Everything you fill out helps us personalize your experience and make sure your Coach is tailored to you.
            </p>
          </div>
          <div style={animStyle(introAnimStep >= 4)}>
            <p className="mt-3 text-sm leading-relaxed text-muted/65">
              You can update any of this anytime from your profile.
            </p>
          </div>
          <div style={animStyle(introAnimStep >= 5)} className="w-1/2 mt-20">
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
  if (showWelcome) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center bg-white px-8 pt-[28vh]">
        <div className="flex flex-col items-center gap-5 text-center">
          <div style={animStyle(animStep >= 1)}>
            <div className="h-16 w-16 overflow-hidden rounded-[18px] border border-ink/10 shadow-md">
              <img src="/icon-512.png" alt="WhatYouAte" className="h-full w-full object-cover" />
            </div>
          </div>
          <div style={animStyle(animStep >= 2)}>
            <p className="text-2xl font-semibold text-ink">You're All Set!</p>
          </div>
          <div style={animStyle(animStep >= 3)}>
            <p className="text-sm text-muted/65">Let's take a look around</p>
          </div>
        </div>
        <div style={animStyle(animStep >= 4)} className="w-full mt-16">
          <button
            type="button"
            className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80"
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
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 1 of 6</p>
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
              <p className="mt-2 text-sm text-muted/70 text-center">We use this to calibrate your calorie and nutrition targets</p>
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
                <button type="button" className={skipCls} onClick={next}>Skip</button>
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
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 2 of 6</p>
            </div>
            <div className="mt-[8vh]">
              <div className="flex justify-center mb-5">
                <svg className="h-10 w-10 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2"/>
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-ink text-center">What's Your Biological Sex?</h1>
              <p className="mt-2 text-sm text-muted/70 text-center">We use this to calibrate your nutritional targets accurately</p>
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
                  className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80"
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
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 3 of 6</p>
            </div>
            <div className="mt-[8vh]">
              <div className="flex justify-center mb-5">
                <svg className="h-10 w-10 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.3 8.7 8.7 21.3c-1 1-2.5 1-3.4 0l-2.6-2.6c-1-1-1-2.5 0-3.4L15.3 2.7c1-1 2.5-1 3.4 0l2.6 2.6c1 1 1 2.5 0 3.4z"/>
                  <path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-ink text-center">Height & Weight</h1>
              <p className="mt-2 text-sm text-muted/70 text-center">We use this to calculate your personal calorie targets</p>
              <div className="mt-8 space-y-6">
                <div>
                  <p className="mb-2 text-xs font-medium text-muted/60">Height</p>
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <input
                        inputMode="numeric"
                        className="w-full rounded-xl border border-ink/10 bg-surface px-3 py-3 pr-9 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="0"
                        value={heightFt}
                        onChange={(e) => setHeightFt(e.target.value.replace(/[^0-9]/g, "").slice(0, 1))}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted/50">ft</span>
                    </div>
                    <div className="relative flex-1">
                      <input
                        inputMode="numeric"
                        className="w-full rounded-xl border border-ink/10 bg-surface px-3 py-3 pr-9 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="0"
                        value={heightIn}
                        onChange={(e) => {
                          const v = parseInt(e.target.value.replace(/[^0-9]/g, "") || "0", 10);
                          setHeightIn(String(Math.min(11, v)));
                        }}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted/50">in</span>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-muted/60">Weight</p>
                  <div className="relative">
                    <input
                      inputMode="numeric"
                      className="w-full rounded-xl border border-ink/10 bg-surface px-3 py-3 pr-12 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="0"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value.replace(/[^0-9]/g, ""))}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted/50">lbs</span>
                  </div>
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
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 4 of 6</p>
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

        {/* Step 4: Activity level */}
        {step === 4 && (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between pt-5">
              <button type="button" className="p-1 active:opacity-50" onClick={() => setStep(3)}>
                <svg className="h-5 w-5 text-ink/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 5 of 6</p>
            </div>
            <div className="mt-[8vh]">
              <div className="flex justify-center mb-5">
                <svg className="h-10 w-10 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinejoin="round"/>
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-ink text-center">How Active Are You?</h1>
              <p className="mt-2 text-sm text-muted/70 text-center">We use this to estimate how many calories you need each day</p>
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

        {/* Step 5: Dietary restrictions */}
        {step === 5 && (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between pt-5">
              <button type="button" className="p-1 active:opacity-50" onClick={() => setStep(4)}>
                <svg className="h-5 w-5 text-ink/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <p className="text-[11px] uppercase tracking-widest text-muted/50">Step 6 of 6</p>
            </div>
            <div className="mt-[8vh]">
              <div className="flex justify-center mb-5">
                <svg className="h-10 w-10 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
                  <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
                </svg>
              </div>
              <h1 className="text-2xl font-semibold text-ink text-center">Any Foods You Avoid?</h1>
              <p className="mt-2 text-sm text-muted/70 text-center">We'll make sure your coach never suggests these — tap all that apply</p>
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
                  className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-50"
                  disabled={saving}
                  onClick={handleSaveAndFinish}
                >
                  {saving ? "Saving…" : "Done"}
                </button>
                <button
                  type="button"
                  className={`${skipCls} disabled:opacity-50`}
                  disabled={saving}
                  onClick={handleSaveAndFinish}
                >
                  Skip
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
