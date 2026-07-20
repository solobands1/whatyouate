"use client";

const Spinner = () => (
  <svg className="animate-spin text-primary/40" width="18" height="18" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="40 20" />
  </svg>
);

export default function SplashScreen({ variant = "launch" }: { variant?: "launch" | "login" }) {
  // Login variant: matches LoginClient's layout exactly (same bg, same branding block anchored
  // at the top, spinner where the form was) so the sign-in → splash transition is seamless —
  // the logo and background never move, only the form is replaced by the spinner.
  if (variant === "login") {
    return (
      <div className="fixed inset-0 min-h-screen bg-surface flex flex-col">
        <div className="mx-auto flex w-full max-w-sm flex-col px-6 flex-1 justify-start pt-28 pb-24">
          <div className="flex flex-col items-center mb-10">
            <div className="h-16 w-16 mb-4">
              <img src="/icon.svg" alt="WhatYouAte" className="h-full w-full object-cover" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              WhatYouAt<span className="relative inline-block">e
                <span className="absolute -top-1 right-0 translate-x-[10px] text-[9px] font-semibold text-ink/50">AI</span>
              </span>
            </h1>
            <p className="mt-1.5 text-sm text-muted/60">Eat Confidently | Feel Better</p>
          </div>
          <div className="flex justify-center pt-2">
            <Spinner />
          </div>
        </div>
      </div>
    );
  }

  // Default launch splash (centered logo + spinner) — shown on cold launches. Uses bg-surface
  // (same as the body and every app screen) so there's no color jump white → splash → app.
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-surface pb-4 pt-10">
      <h1 className="animate-splash-breathe text-3xl font-semibold text-ink">
        WhatYouAt
        <span className="relative inline-block">
          e
          <span className="absolute -top-1 right-0 translate-x-[10px] text-[10px] font-semibold text-ink/60">
            AI
          </span>
        </span>
      </h1>
      <Spinner />
    </div>
  );
}
