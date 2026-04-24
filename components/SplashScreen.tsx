"use client";

export default function SplashScreen() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-[#F1F6FF] pb-4 pt-10">
      <h1 className="animate-splash-breathe text-3xl font-semibold text-ink">
        WhatYouAt
        <span className="relative inline-block">
          e
          <span className="absolute -top-1 right-0 translate-x-[10px] text-[10px] font-semibold text-ink/60">
            AI
          </span>
        </span>
      </h1>
      <svg className="animate-spin text-primary/40" width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="40 20" />
      </svg>
    </div>
  );
}
