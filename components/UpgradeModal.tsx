"use client";

import { useEffect, useState } from "react";
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";
import { getOfferings, purchasePackage, restorePurchases } from "../lib/purchases";
import { Capacitor } from "@capacitor/core";

export const UPGRADE_EVENT = "wya_show_upgrade";

export function openUpgradeModal() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(UPGRADE_EVENT));
  }
}

export default function UpgradeModal() {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<"monthly" | "yearly">("yearly");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [packages, setPackages] = useState<{ monthly: PurchasesPackage | null; yearly: PurchasesPackage | null }>({ monthly: null, yearly: null });
  const [coachState, setCoachState] = useState<"thinking" | "message" | null>(null);
  const [poppedPlan, setPoppedPlan] = useState<"monthly" | "yearly" | null>(null);

  const handlePlanSelect = (p: "monthly" | "yearly") => {
    setPlan(p);
    setPoppedPlan(p);
    setTimeout(() => setPoppedPlan(null), 250);
  };
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    const handler = () => { setOpen(true); setError(null); setCoachState("thinking"); };
    window.addEventListener(UPGRADE_EVENT, handler);
    return () => window.removeEventListener(UPGRADE_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setCoachState("message"), 3500);
    return () => clearTimeout(timer);
  }, [open]);

  // Load offerings when modal opens
  useEffect(() => {
    if (!open || !isNative) return;
    getOfferings().then((offering) => {
      if (!offering) {
        setError("No offerings found. Check RC dashboard.");
        return;
      }
      const pkgs = offering.availablePackages;
      if (pkgs.length === 0) {
        setError(`Offering found but no packages. Offering: ${offering.identifier}`);
        return;
      }
      const monthly = pkgs.find(
        (p) => p.product.identifier === "com.dillonpoulin.whatyouate.monthly"
      ) ?? null;
      const yearly = pkgs.find(
        (p) => p.product.identifier === "com.dillonpoulin.whatyouate.yearly"
      ) ?? null;
      if (!monthly && !yearly) {
        setError(`Packages found but IDs don't match. Got: ${pkgs.map(p => p.product.identifier).join(", ")}`);
        return;
      }
      setPackages({ monthly, yearly });
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`RC error: ${msg}`);
    });
  }, [open, isNative]);

  if (!open) return null;

  const monthlyCost = packages.monthly?.product.priceString ?? "$12.99";
  const yearlyCost = packages.yearly?.product.priceString ?? "$99.99";
  const yearlyMonthly = packages.yearly ? `${(packages.yearly.product.price / 12).toFixed(2)}` : "8.25";
  const yearlySavings = Math.round((1 - (packages.yearly?.product.price ?? 99) / ((packages.monthly?.product.price ?? 12.99) * 12)) * 100);

  const handlePurchase = async () => {
    if (loading) return;
    const pkg = plan === "monthly" ? packages.monthly : packages.yearly;

    if (!isNative) {
      setError("Purchases are only available in the iOS app.");
      return;
    }
    if (!pkg) {
      setError("Couldn't load products. Please try again.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const customerInfo = await purchasePackage(pkg);
      if (customerInfo.entitlements.active["pro"]) {
        window.dispatchEvent(new CustomEvent("wya_purchase_complete"));
        setOpen(false);
      } else {
        setError("Purchase completed but entitlement not found. Try restoring.");
      }
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code !== "PURCHASE_CANCELLED") {
        setError("Purchase failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    if (restoring || !isNative) return;
    setRestoring(true);
    setError(null);
    try {
      const customerInfo = await restorePurchases();
      if (customerInfo.entitlements.active["pro"]) {
        window.dispatchEvent(new CustomEvent("wya_purchase_complete"));
        setOpen(false);
      } else {
        setError("No active subscription found.");
      }
    } catch {
      setError("Restore failed. Please try again.");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
      <div className="flex w-full max-w-sm flex-col bg-white rounded-xl overflow-y-auto max-h-[90vh] shadow-xl">
        {/* Close */}
        <div className="flex justify-end px-5 pt-5">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/8 text-ink/50 transition active:scale-90 active:opacity-60"
            aria-label="Close"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col items-center px-6 pb-5 pt-1">
          {/* Icon */}
          <div className="h-14 w-14 overflow-hidden rounded-2xl border border-ink/10 shadow-sm">
            <img src="/icon.svg" alt="WhatYouAte" className="h-full w-full object-cover" />
          </div>

          {/* Headline */}
          <h1 className="mt-3 text-center text-xl font-semibold text-ink">
            Unlock Your Patterns
          </h1>
          <p className="mt-1.5 max-w-xs text-center text-sm text-muted/70">
            Unlock your personalized nudges, micronutrient patterns, and weekly insights.
          </p>

          {/* What's included */}
          <div className="mt-4 w-full rounded-2xl border border-ink/8 bg-white px-5 py-3 space-y-2">
            {[
              "Daily AI-powered nudges",
              "Micronutrient pattern tracking",
              "Weekly insights and trends",
              "Full access to your Patterns history",
            ].map((item, i) => (
              <div
                key={item}
                className="flex items-center gap-3 animate-fade-slide-up"
                style={{ animationDelay: `${i * 140}ms`, animationFillMode: "both" }}
              >
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
          <div className="mt-4 w-full">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => handlePlanSelect("yearly")}
                className={`relative flex-1 rounded-2xl border px-4 py-3.5 text-left transition active:scale-[0.98] ${
                  plan === "yearly" ? "border-primary/50 bg-primary/5" : "border-ink/10 bg-white"
                } ${poppedPlan === "yearly" ? "animate-pop" : ""}`}
              >
                <span className="absolute -top-2.5 right-3 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white">
                  Save {yearlySavings}%
                </span>
                <div className="flex items-start justify-between">
                  <div>
                    <p className={`text-sm text-ink transition ${plan === "yearly" ? "font-bold" : "font-semibold"}`}>Yearly</p>
                    <p className="mt-0.5 text-xs text-muted/70">
                      {yearlyCost}/year
                    </p>
                    <p className="text-[11px] text-ink/40">({`$${yearlyMonthly}/mo`})</p>
                  </div>
                  <div className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center transition ${
                    plan === "yearly" ? "border-primary bg-primary" : "border-ink/20 bg-white"
                  }`}>
                    {plan === "yearly" && (
                      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 5l2.5 2.5 3.5-4" />
                      </svg>
                    )}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handlePlanSelect("monthly")}
                className={`flex-1 rounded-2xl border px-4 py-3.5 text-left transition active:scale-[0.98] ${
                  plan === "monthly" ? "border-primary/50 bg-primary/5" : "border-ink/10 bg-white"
                } ${poppedPlan === "monthly" ? "animate-pop" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className={`text-sm text-ink transition ${plan === "monthly" ? "font-bold" : "font-semibold"}`}>Monthly</p>
                    <p className="mt-0.5 text-xs text-muted/70">{monthlyCost}/month</p>
                  </div>
                  <div className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center transition ${
                    plan === "monthly" ? "border-primary bg-primary" : "border-ink/20 bg-white"
                  }`}>
                    {plan === "monthly" && (
                      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 5l2.5 2.5 3.5-4" />
                      </svg>
                    )}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-4 w-full space-y-2.5">
            <div className="relative min-h-[44px]">
              {coachState === "thinking" && (
                <div
                  className="rounded-xl border border-primary/35 bg-primary/5 px-4 py-3 flex items-center gap-2.5 transition-all duration-300"
                  style={{ opacity: coachState === "thinking" ? 1 : 0 }}
                >
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary/80" />
                  </span>
                  <p className="text-sm text-primary/70 font-medium">Coach is thinking…</p>
                </div>
              )}
              {coachState === "message" && (
                <div
                  className="rounded-xl border border-primary/60 bg-primary/5 px-4 py-3 space-y-1 transition-all duration-300 animate-fade-slide-up"
                >
                  <p className="text-sm font-medium text-ink/90">I've been watching your patterns. I have a lot to tell you!</p>
                  <p className="text-[11px] text-primary/70 font-medium">— Coach</p>
                </div>
              )}
            </div>
            {error && (
              <p className="text-center text-[11px] text-red-500/80">{error}</p>
            )}
            <button
              type="button"
              onClick={handlePurchase}
              disabled={loading || restoring}
              className="w-full rounded-xl bg-primary px-5 py-3.5 text-sm font-semibold text-white transition active:opacity-80 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Processing…
                </span>
              ) : "Unlock"}
            </button>

            <p className="text-center text-[11px] text-muted/50">
              Cancel anytime. Subscriptions managed through Apple and can be cancelled in your device settings.
            </p>

            <button
              type="button"
              onClick={handleRestore}
              disabled={loading || restoring}
              className="w-full text-center text-[11px] text-muted/40 underline underline-offset-2 active:opacity-60 disabled:opacity-40"
            >
              {restoring ? "Restoring…" : "Restore Purchase"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
