"use client";

export default function SplashScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#F1F6FF]">
      <h1 className="animate-splash-breathe text-3xl font-semibold text-ink">
        WhatYouAt
        <span className="relative inline-block">
          e
          <span className="absolute -top-1 right-0 translate-x-[10px] text-[10px] font-semibold text-ink/60">
            AI
          </span>
        </span>
      </h1>
    </div>
  );
}
