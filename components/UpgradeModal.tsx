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
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    const handler = () => { setOpen(true); setError(null); setCoachState("thinking"); };
    window.addEventListener(UPGRADE_EVENT, handler);
    return () => window.removeEventListener(UPGRADE_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setCoachState("message"), 2000);
    return () => clearTimeout(timer);
  }, [open]);

  // Load offerings when modal opens
  useEffect(() => {
    if (!open || !isNative) return;
    getOfferings().then((offering) => {
      if (!offering) return;
      const pkgs = offering.availablePackages;
      const monthly = pkgs.find(
        (p) => p.product.identifier === "com.dillonpoulin.whatyouate.monthly"
      ) ?? null;
      const yearly = pkgs.find(
        (p) => p.product.identifier === "com.dillonpoulin.whatyouate.yearly"
      ) ?? null;
      setPackages({ monthly, yearly });
    }).catch(() => {});
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
            className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/8 text-ink/50 transition active:opacity-60"
            aria-label="Close"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col items-center px-6 pb-8 pt-2">
          {/* Icon */}
          <div className="h-16 w-16 overflow-hidden rounded-2xl border border-ink/10 shadow-sm">
            <img src="/icon-512.png" alt="WhatYouAte" className="h-full w-full object-cover" />
          </div>

          {/* Headline */}
          <h1 className="mt-5 text-center text-2xl font-semibold text-ink">
            Unlock Your Patterns
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
              "Full access to your Patterns history",
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
                  plan === "yearly" ? "border-primary/50 bg-primary/5" : "border-ink/10 bg-white"
                }`}
              >
                <span className="absolute -top-2.5 right-3 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-white">
                  Save {yearlySavings}%
                </span>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink">Yearly</p>
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
                onClick={() => setPlan("monthly")}
                className={`flex-1 rounded-2xl border px-4 py-3.5 text-left transition ${
                  plan === "monthly" ? "border-primary/50 bg-primary/5" : "border-ink/10 bg-white"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink">Monthly</p>
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
          <div className="mt-6 w-full space-y-3">
            {coachState === "thinking" && (
              <div className="flex justify-center">
                <span className="flex items-center gap-1 rounded-full bg-primary/10 px-4 py-2.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.8s" }}
                    />
                  ))}
                </span>
              </div>
            )}
            {coachState === "message" && (
              <div className="flex justify-center">
                <span className="rounded-full bg-primary/10 px-4 py-2 text-[11px] font-semibold text-primary">
                  I have a lot to tell you — Coach
                </span>
              </div>
            )}
            {error && (
              <p className="text-center text-[11px] text-red-500/80">{error}</p>
            )}
            <button
              type="button"
              onClick={handlePurchase}
              disabled={loading || restoring}
              className="w-full rounded-xl bg-primary px-5 py-3.5 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-50"
            >
              {loading ? "Processing…" : "Unlock"}
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
