"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  type ReminderKind,
  anHourAgoTs,
  breakfastReminderTime,
  firstMealPeriod,
  lastNightDinnerTs,
  mealTimeLabel,
  resolvePickedTime,
  shortClockLabel,
  toTimeInputValue,
} from "../lib/firstMeal";

// The last step of onboarding: get one real meal logged before the app opens up. It asks a question
// that fits the time of day, then hands off to the app's own loggers (photo, type it, barcode, quick
// add) through onLog, so there is no second logger to maintain. HomeScreen owns the wiring: it opens
// the chosen logger with the picked meal time, watches for the saved meal, and starts the habit.
// Styled to match OnboardingFlow (white screen, centred icon, heading, one line of body text).

export type FirstMealLogMethod = "photo" | "manual" | "barcode" | "quick";
type LogContext = "breakfast" | "dinner" | "later";
type View =
  | { name: "morning" }
  | { name: "notYet" }
  | { name: "log"; context: LogContext; from: "morning" | "notYet" | null }
  | { name: "reminderSet"; at: number; push: boolean };

interface Props {
  // Quick Add lists foods already logged, so a brand-new account has nothing in it. Only offered
  // when there's something to pick.
  quickAddAvailable: boolean;
  // A meal from this step is on its way to the database (optimistic pill showing).
  saving: boolean;
  // The last attempt didn't save.
  saveFailed: boolean;
  onLog: (method: FirstMealLogMethod, ts: number) => void;
  // Saves "Remind Me After Breakfast". Never rejects: resolves with the time and whether a push
  // notification will carry it (otherwise it shows in the app on the next open).
  onRemind: () => Promise<{ at: number; push: boolean }>;
  // "Not Now" (HomeScreen also books the one follow-up reminder for the next mealtime).
  onSkip: () => void;
  // Continue after "Remind Me After Breakfast" is set: finishes without a second reminder.
  onDone: () => void;
}

function defaultTs(context: LogContext): number {
  if (context === "dinner") return lastNightDinnerTs();
  if (context === "later") return anHourAgoTs();
  return Date.now();
}

const primaryBtn = "w-full rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-50";
const secondaryBtn = "w-full rounded-xl border border-ink/10 py-4 text-sm font-semibold text-ink/70 transition active:opacity-80";
const skipBtn = "w-full py-2 text-sm font-medium text-ink/40";

// The photo option leaves Home for /capture, which unmounts this step. If they cancel there, put
// them back where they were (e.g. "Log Last Night's Dinner" at 7 PM) rather than at the first
// question. Per tab, and only for half an hour.
const VIEW_KEY = "wya_first_meal_view";
type SavedView = { view: View; mealTs: number; savedAt: number };
function readSavedView(): SavedView | null {
  try {
    const raw = sessionStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedView;
    if (!v?.view?.name || typeof v.mealTs !== "number" || Date.now() - v.savedAt > 30 * 60_000) return null;
    return v;
  } catch {
    return null;
  }
}
export function clearFirstMealView(): void {
  try { sessionStorage.removeItem(VIEW_KEY); } catch { /* ignore */ }
}

export default function FirstMealStep({ quickAddAvailable, saving, saveFailed, onLog, onRemind, onSkip, onDone }: Props) {
  const [view, setView] = useState<View>(() =>
    readSavedView()?.view ?? (firstMealPeriod() === "morning" ? { name: "morning" } : { name: "log", context: "later", from: null })
  );
  const [mealTs, setMealTs] = useState<number>(() =>
    readSavedView()?.mealTs ?? (firstMealPeriod() === "morning" ? Date.now() : anHourAgoTs())
  );
  const [reminding, setReminding] = useState(false);
  useEffect(() => {
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ view, mealTs, savedAt: Date.now() })); } catch { /* ignore */ }
  }, [view, mealTs]);

  const openLog = (context: LogContext, from: "morning" | "notYet") => {
    setMealTs(defaultTs(context));
    setView({ name: "log", context, from });
  };

  const handleRemind = async () => {
    if (reminding) return;
    setReminding(true);
    const result = await onRemind();
    setReminding(false);
    setView({ name: "reminderSet", at: result.at, push: result.push });
  };

  const back =
    view.name === "notYet" ? () => setView({ name: "morning" })
    : view.name === "log" && view.from === "morning" ? () => setView({ name: "morning" })
    : view.name === "log" && view.from === "notYet" ? () => setView({ name: "notYet" })
    : null;

  return (
    <div
      className="fixed inset-0 z-[45] flex flex-col bg-white safe-top"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Log your first meal"
      data-first-meal-step
    >
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-8">
        <div className="flex h-11 shrink-0 items-end">
          {back && (
            <button type="button" className="p-1 active:opacity-50" onClick={back} aria-label="Back">
              <svg className="h-5 w-5 text-ink/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
          )}
        </div>

        {/* key restarts the entrance animation on each view */}
        <div key={view.name === "log" ? `log-${view.context}` : view.name} className="animate-fade-slide-up">
          {view.name === "morning" && (
            <div className="mt-[9vh]">
              <StepIcon><SunriseIcon /></StepIcon>
              <h1 className="text-center text-2xl font-semibold text-ink">Good Morning!<br />Have You Had Breakfast Yet?</h1>
              <p className="mt-2 text-center text-sm text-muted/70">Your first meal is where your coach starts learning what works for you.</p>
              <div className="mt-12 space-y-3">
                <button type="button" className={primaryBtn} onClick={() => openLog("breakfast", "morning")}>Yes, Log It</button>
                <button type="button" className={secondaryBtn} onClick={() => setView({ name: "notYet" })}>Not Yet</button>
              </div>
              <div className="mt-6"><button type="button" className={skipBtn} onClick={onSkip}>Not Now</button></div>
            </div>
          )}

          {view.name === "notYet" && (
            <div className="mt-[7vh]">
              <StepIcon><MoonIcon /></StepIcon>
              <h1 className="text-center text-2xl font-semibold text-ink">No Problem</h1>
              <p className="mt-2 text-center text-sm text-muted/70">Start with last night instead, or we can remind you later.</p>
              <div className="mt-8 flex flex-col gap-3">
                <ChoiceRow
                  icon={<MoonIcon small />}
                  label="Log Last Night's Dinner"
                  sub="Last night's dinner affects how you feel this morning."
                  onClick={() => openLog("dinner", "notYet")}
                />
                <ChoiceRow
                  icon={<BellIcon />}
                  label="Remind Me After Breakfast"
                  sub={reminding ? "Setting it up…" : `We'll check in around ${shortClockLabel(breakfastReminderTime())}.`}
                  onClick={handleRemind}
                  disabled={reminding}
                />
              </div>
              <div className="mt-6"><button type="button" className={skipBtn} onClick={onSkip}>Not Now</button></div>
            </div>
          )}

          {view.name === "log" && (
            <div className="mt-[4vh]">
              <StepIcon>{view.context === "dinner" ? <MoonIcon /> : view.context === "breakfast" ? <CupIcon /> : <PlateIcon />}</StepIcon>
              <h1 className="text-center text-2xl font-semibold text-ink">
                {view.context === "breakfast" ? "Log Your Breakfast" : view.context === "dinner" ? "Log Last Night's Dinner" : "What Did You Last Eat?"}
              </h1>
              <p className="mt-2 text-center text-sm text-muted/70">
                {view.context === "later"
                  ? "Any recent meal counts, even one from a few hours ago."
                  : view.context === "dinner"
                  ? "Roughly what you had is plenty."
                  : "A rough log is plenty. You can fix it later."}
              </p>

              {/* Meal time. The native time wheel opens on tap; resolvePickedTime keeps it in the past. */}
              <div className="mt-5 flex justify-center">
                <label className="relative inline-flex items-center gap-1.5 rounded-full border border-ink/10 px-3 py-1.5">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-ink/40" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                  <span className="text-xs text-ink/70" data-meal-time-label>{mealTimeLabel(mealTs)}</span>
                  <span className="text-xs font-semibold text-primary">Change</span>
                  <input
                    type="time"
                    aria-label="Meal time"
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    value={toTimeInputValue(mealTs)}
                    onChange={(e) => {
                      const ts = resolvePickedTime(e.target.value);
                      if (ts != null) setMealTs(ts);
                    }}
                  />
                </label>
              </div>

              {saving ? (
                <div className="mt-12 flex flex-col items-center gap-3" role="status">
                  <svg className="animate-spin text-primary/50" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="40 20" />
                  </svg>
                  <p className="text-sm text-muted/70">Saving Your Meal…</p>
                  {/* A stalled connection shouldn't trap them here. If the save lands later,
                      the habit still ticks it off on its own. */}
                  <button type="button" className={`mt-6 ${skipBtn}`} onClick={onSkip}>Not Now</button>
                </div>
              ) : (
                <>
                  <div className="mt-6 flex flex-col gap-3">
                    <ChoiceRow icon={<CameraIcon />} label="Take A Photo" sub="We'll estimate it from the picture." emphasis onClick={() => onLog("photo", mealTs)} />
                    <ChoiceRow icon={<PencilIcon />} label="Type It In" sub="A few words is enough." onClick={() => onLog("manual", mealTs)} />
                    <ChoiceRow icon={<BarcodeIcon />} label="Scan A Barcode" sub="For anything in a package." onClick={() => onLog("barcode", mealTs)} />
                    {quickAddAvailable && (
                      <ChoiceRow icon={<PlusIcon />} label="Quick Add" sub="Pick from foods you've logged." onClick={() => onLog("quick", mealTs)} />
                    )}
                  </div>
                  {saveFailed && (
                    <p className="mt-4 text-center text-sm text-rose-500" role="alert">That didn&apos;t save. Check your connection and try again.</p>
                  )}
                  <div className="mt-5"><button type="button" className={skipBtn} onClick={onSkip}>Not Now</button></div>
                </>
              )}
            </div>
          )}

          {view.name === "reminderSet" && (
            <div className="mt-[14vh]">
              <StepIcon><BellIcon large /></StepIcon>
              <h1 className="text-center text-2xl font-semibold text-ink">We&apos;ll Remind You Around {shortClockLabel(view.at).replace(/\s/g, "\u00a0")}</h1>
              <p className="mt-2 text-center text-sm text-muted/70">
                {view.push
                  ? "You'll get a notification then, unless you've already logged it."
                  : "Notifications are off, so we'll ask the next time you open the app after that."}
              </p>
              <div className="mt-12">
                <button type="button" className={primaryBtn} onClick={onDone}>Continue</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// "Nice Start! Your Coach Is Learning": the celebration that used to close onboarding ("You're All
// Set"), moved to after the first log. Same confetti and drawn check, plus the habit's first tick.
export function FirstMealCelebration({ habitTitle, daysDone, totalDays, onContinue }: { habitTitle: string; daysDone: number; totalDays: number; onContinue: () => void }) {
  const [animStep, setAnimStep] = useState(0);
  useEffect(() => {
    const ts = [80, 450, 820, 1200].map((ms, i) => setTimeout(() => setAnimStep(i + 1), ms));
    return () => ts.forEach(clearTimeout);
  }, []);
  const animStyle = (show: boolean) => ({
    opacity: show ? 1 : 0,
    transform: show ? "translateY(0)" : "translateY(-14px)",
    transition: "opacity 0.45s ease, transform 0.45s ease",
  });

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center bg-white px-8 pt-[20vh]" role="dialog" aria-modal="true" aria-label="Nice start" data-first-meal-celebration>
      <style>{`
        @keyframes fm-draw-circle { from { stroke-dashoffset: 63; } to { stroke-dashoffset: 0; } }
        @keyframes fm-draw-check { from { stroke-dashoffset: 12; } to { stroke-dashoffset: 0; } }
        @keyframes fm-confetti-fall {
          0%   { transform: translateY(-8vh) translateX(0) rotate(0deg); }
          25%  { transform: translateY(26vh) translateX(-16px) rotate(70deg); }
          50%  { transform: translateY(54vh) translateX(14px) rotate(150deg); }
          75%  { transform: translateY(82vh) translateX(-12px) rotate(240deg); }
          100% { transform: translateY(112vh) translateX(8px) rotate(320deg); }
        }
        @keyframes fm-confetti-fall-alt {
          0%   { transform: translateY(-8vh) translateX(0) rotate(0deg); }
          25%  { transform: translateY(24vh) translateX(15px) rotate(-60deg); }
          50%  { transform: translateY(52vh) translateX(-14px) rotate(-140deg); }
          75%  { transform: translateY(80vh) translateX(12px) rotate(-230deg); }
          100% { transform: translateY(112vh) translateX(-8px) rotate(-310deg); }
        }
        @keyframes fm-confetti-fall-c {
          0%   { transform: translateY(-8vh) translateX(0) rotate(0deg); }
          30%  { transform: translateY(32vh) translateX(-10px) rotate(100deg); }
          60%  { transform: translateY(62vh) translateX(16px) rotate(190deg); }
          100% { transform: translateY(112vh) translateX(-6px) rotate(280deg); }
        }
        .fm-confetti { position: absolute; top: 0; animation-timing-function: linear; animation-iteration-count: 1; animation-fill-mode: both; will-change: transform, opacity; }
        @media (prefers-reduced-motion: reduce) { .fm-confetti { animation: none !important; opacity: 0 !important; } }
      `}</style>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {Array.from({ length: 20 }).map((_, i) => {
          const palette = ["#82B8FF", "#A9CCFF", "#BBD4FF", "#6FA8FF"];
          const anims = ["fm-confetti-fall", "fm-confetti-fall-alt", "fm-confetti-fall-c"];
          return (
            <span
              key={i}
              className="fm-confetti"
              style={{
                left: `${(i * 37 + 6) % 100}%`,
                width: 6 + (i % 3) * 1.5,
                height: 12 + (i % 4) * 2,
                background: palette[i % palette.length],
                opacity: [0.3, 0.5, 0.7][i % 3],
                borderRadius: "2px",
                animationName: anims[i % 3],
                animationDelay: `${(i % 6) * 0.14}s`,
                animationDuration: `${5.5 + (i % 5) * 1.1}s`,
              }}
            />
          );
        })}
      </div>
      <div className="relative z-10 flex flex-col items-center gap-4 text-center">
        <div style={animStyle(animStep >= 1)}>
          <svg className="h-28 w-28 text-primary/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" style={{ strokeDasharray: 63, strokeDashoffset: 63, animation: "fm-draw-circle 0.55s ease-out 0.5s forwards" }} />
            <path d="M8 12l3 3 5-5" style={{ strokeDasharray: 12, strokeDashoffset: 12, animation: "fm-draw-check 0.35s ease-out 1.0s forwards" }} />
          </svg>
        </div>
        <div style={animStyle(animStep >= 2)}>
          <p className="text-2xl font-semibold text-ink">Nice Start!</p>
          <p className="mt-1.5 text-sm font-medium text-muted/70">Your Coach Is Learning</p>
        </div>
        <div style={animStyle(animStep >= 3)} className="mt-4 w-full max-w-[280px] rounded-2xl border-2 border-primary/25 bg-primary/[0.05] px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Habit Builder</p>
          <p className="mt-1 text-base font-semibold text-ink">{habitTitle}</p>
          <div className="mt-2.5 flex items-center justify-center gap-1.5" aria-hidden="true">
            {Array.from({ length: totalDays }).map((_, d) => (
              <span key={d} className={`h-2 w-2 rounded-full ${d < daysDone ? "bg-primary" : "bg-ink/15"}`} />
            ))}
          </div>
          <p className="mt-2 text-xs font-medium text-ink/60" data-celebration-progress>Day {daysDone} Of {totalDays}</p>
        </div>
      </div>
      <div style={animStyle(animStep >= 4)} className="relative z-10 mt-12 flex w-full justify-center">
        <button type="button" className="w-2/3 rounded-xl bg-primary py-4 text-sm font-semibold text-white transition active:opacity-80" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}

// The in-app half of the step's reminders ("Remind Me After Breakfast", and the one follow-up after
// "Not Now"): shown on the first open after the chosen time if nothing has been logged since. Also
// where a tapped reminder notification lands. The headline matches the push for that mealtime.
const PROMPT_TITLES: Record<ReminderKind, string> = {
  breakfast: "Had Breakfast Yet?",
  lunch: "What Did You Have For Lunch?",
  dinner: "What Did You Have For Dinner?",
};
export function FirstMealReminderPrompt({ kind, onLog, onDismiss }: { kind: ReminderKind; onLog: () => void; onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5" role="dialog" aria-modal="true" aria-label={PROMPT_TITLES[kind]} data-first-meal-reminder={kind}>
      <div className="w-full max-w-sm rounded-2xl bg-white px-6 pb-5 pt-7 text-center shadow-xl animate-fade-slide-up">
        <StepIcon>{kind === "breakfast" ? <CupIcon /> : <PlateIcon />}</StepIcon>
        <h2 className="text-xl font-semibold text-ink">{PROMPT_TITLES[kind]}</h2>
        <p className="mt-2 text-sm text-muted/70">Log it now and your coach can get started.</p>
        <button type="button" className={`mt-6 ${primaryBtn}`} onClick={onLog}>Log It</button>
        <button type="button" className={`mt-2 ${skipBtn}`} onClick={onDismiss}>Not Now</button>
      </div>
    </div>
  );
}

function ChoiceRow({ icon, label, sub, onClick, emphasis, disabled }: { icon: ReactNode; label: string; sub: string; onClick: () => void; emphasis?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition active:scale-[0.99] active:bg-primary/5 disabled:opacity-60 ${emphasis ? "border-primary/40 bg-primary/[0.04]" : "border-ink/10 bg-white"}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink/80">{label}</span>
        <span className="mt-0.5 block text-xs text-muted/65">{sub}</span>
      </span>
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink/25" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </button>
  );
}

function StepIcon({ children }: { children: ReactNode }) {
  return <div className="mb-5 flex justify-center text-primary/40">{children}</div>;
}

// Drawn icons, stroke style matching OnboardingFlow's step icons.
const iconProps = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

function SunriseIcon() {
  return (
    <svg className="h-10 w-10" viewBox="0 0 24 24" strokeWidth="1.5" {...iconProps}>
      <path d="M17 18a5 5 0 0 0-10 0" />
      <path d="M12 2v7M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M8 6l4-4 4 4" />
    </svg>
  );
}
function MoonIcon({ small }: { small?: boolean }) {
  return (
    <svg className={small ? "h-5 w-5" : "h-10 w-10"} viewBox="0 0 24 24" strokeWidth={small ? 1.8 : 1.5} {...iconProps}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </svg>
  );
}
function PlateIcon() {
  return (
    <svg className="h-10 w-10" viewBox="0 0 24 24" strokeWidth="1.5" {...iconProps}>
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20" />
      <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
    </svg>
  );
}
function CupIcon() {
  return (
    <svg className="h-10 w-10" viewBox="0 0 24 24" strokeWidth="1.5" {...iconProps}>
      <path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z" />
      <path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17M3 22h16M8 2.5c-.6.8-.6 1.7 0 2.5M12 2.5c-.6.8-.6 1.7 0 2.5" />
    </svg>
  );
}
function BellIcon({ large }: { large?: boolean }) {
  return (
    <svg className={large ? "h-10 w-10" : "h-5 w-5"} viewBox="0 0 24 24" strokeWidth={large ? 1.5 : 1.8} {...iconProps}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
function CameraIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" strokeWidth="1.8" {...iconProps}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" strokeWidth="1.8" {...iconProps}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
function BarcodeIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" strokeWidth="1.8" {...iconProps}>
      <path d="M3 5v14M7 5v14M11 5v14M16 5v14M20 5v14" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" strokeWidth="1.8" {...iconProps}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
