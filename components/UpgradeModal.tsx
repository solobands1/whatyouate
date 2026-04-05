"use client";

import { useEffect, useState } from "react";

export const UPGRADE_EVENT = "wya_show_upgrade";

export function openUpgradeModal() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(UPGRADE_EVENT));
  }
}

export default function UpgradeModal() {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<"monthly" | "yearly">("yearly");

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(UPGRADE_EVENT, handler);
    return () => window.removeEventListener(UPGRADE_EVENT, handler);
  }, []);

  if (!open) return null;

  const monthlyCost = 9.99;
  const yearlyCost = 99;
  const yearlySavings = Math.round((1 - yearlyCost / (monthlyCost * 12)) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/20">
    <div className="flex w-full max-w-md flex-col bg-surface overflow-y-auto">
      {/* Close */}
      <div className="flex justify-end px-5 pt-10">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/8 text-ink/50 transition active:opacity-60"
          aria-label="Close"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center px-6 pb-10 pt-2">
        {/* Icon */}
        <div className="h-16 w-16 overflow-hidden rounded-2xl border border-ink/10 shadow-sm">
          <img src="/icon-512.png" alt="WhatYouAte" className="h-full w-full object-cover" />
        </div>

        {/* Headline */}
        <h1 className="mt-5 text-center text-2xl font-semibold text-ink">
          Keep the insights coming
        </h1>
        <p className="mt-2 max-w-xs text-center text-sm text-muted/70">
          Unlock your personalized nudges, micronutrient patterns, and weekly insights.
        </p>

        {/* What's included */}
        <div className="mt-6 w-full rounded-2xl border border-ink/8 bg-white px-5 py-4 space-y-2.5">
          {[
            "Daily AI-powered nudges",
            "Micronutrient pattern tracking",
            "Weekly insights and trends",
            "Unlimited meal logging",
          ].map((item) => (
            <div key={item} className="flex items-center gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 6l3 3 5-5" />
                </svg>
              </span>
              <span className="text-sm text-ink/80">{item}</span>
            </div>
          ))}
        </div>

        {/* Plan toggle */}
        <div className="mt-6 w-full">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setPlan("yearly")}
              className={`relative flex-1 rounded-2xl border px-4 py-3.5 text-left transition ${
                plan === "yearly"
                  ? "border-primary/50 bg-primary/5"
                  : "border-ink/10 bg-white"
              }`}
            >
              {plan === "yearly" && (
                <span className="absolute -top-2.5 right-3 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white">
                  Save {yearlySavings}%
                </span>
              )}
              <p className="text-sm font-semibold text-ink">Yearly</p>
              <p className="mt-0.5 text-xs text-muted/70">
                ${yearlyCost}/year
                <span className="ml-1.5 text-ink/40">${(yearlyCost / 12).toFixed(2)}/mo</span>
              </p>
            </button>
            <button
              type="button"
              onClick={() => setPlan("monthly")}
              className={`flex-1 rounded-2xl border px-4 py-3.5 text-left transition ${
                plan === "monthly"
                  ? "border-primary/50 bg-primary/5"
                  : "border-ink/10 bg-white"
              }`}
            >
              <p className="text-sm font-semibold text-ink">Monthly</p>
              <p className="mt-0.5 text-xs text-muted/70">${monthlyCost}/month</p>
            </button>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-6 w-full space-y-3">
          <button
            type="button"
            disabled
            className="w-full rounded-xl bg-primary/40 px-5 py-3.5 text-sm font-semibold text-white/80 cursor-not-allowed"
          >
            Upgrade
          </button>
          <p className="text-center text-[11px] text-muted/50">
            Payment processing launches with the App Store release.
            <br />
            Beta testers have extended access.
          </p>
          <button
            type="button"
            className="w-full text-center text-[11px] text-muted/40 underline underline-offset-2 active:opacity-60"
          >
            Restore purchase
          </button>
        </div>
      </div>
    </div>
    </div>
  );
}
