"use client";

import { useEffect, useMemo, useState } from "react";
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";
import {
  CREATOR_MONTHLY_ID,
  CREATOR_OFFERING,
  getOffering,
  isIntroEligible,
  purchasePackage,
  restorePurchases,
} from "../lib/purchases";
import { useReferral } from "../hooks/useReferral";
import { Capacitor } from "@capacitor/core";
import { setPendingReviewFlag, isPromptDone } from "../lib/reviewPrompt";
import { useAppData } from "./AppDataProvider";
import WyaaAvatar from "./WyaaAvatar";
import { computeFoodFeelingLinks, foodLinkSentence, CONFIDENCE_CHIP } from "../lib/foodFeeling";

export const UPGRADE_EVENT = "wya_show_upgrade";

// Read by the review prompt, which never opens on top of the paywall.
let upgradeOpen = false;
export function isUpgradeModalOpen() {
  return upgradeOpen;
}

// When the coach has no real finding yet (opened early, or the 14-day cap came first): their
// numbers plus this, never a promise.
const STILL_CONNECTING = "Your coach is still connecting your food and how you feel. Keep logging and reflecting, and it'll show up in Patterns.";

export function openUpgradeModal() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(UPGRADE_EVENT));
  }
}

const MONTHLY_ID = "com.dillonpoulin.whatyouate.monthly";
const YEARLY_ID = "com.dillonpoulin.whatyouate.yearly";

type IntroPrice = { price: number; periodUnit: string; periodNumberOfUnits: number };

/** "7 Days", "1 Month" and so on, for a free trial. */
function trialLength(intro: IntroPrice) {
  const n = intro.periodNumberOfUnits;
  switch (intro.periodUnit) {
    case "DAY": return `${n} Day${n === 1 ? "" : "s"}`;
    case "WEEK": return `${n * 7} Days`;
    case "MONTH": return `${n} Month${n === 1 ? "" : "s"}`;
    case "YEAR": return `${n} Year${n === 1 ? "" : "s"}`;
    default: return "7 Days";
  }
}

export default function UpgradeModal() {
  // People who joined with a creator code see the creator offering: a monthly plan whose free
  // trial is a month, plus the normal yearly.
  const referral = useReferral();
  const [creatorTrialOk, setCreatorTrialOk] = useState(false);
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [packages, setPackages] = useState<{ monthly: PurchasesPackage | null; yearly: PurchasesPackage | null }>({ monthly: null, yearly: null });
  const [poppedPlan, setPoppedPlan] = useState<"monthly" | "yearly" | null>(null);
  const { meals, reflections } = useAppData();

  const handlePlanSelect = (p: "monthly" | "yearly") => {
    setPlan(p);
    setPoppedPlan(p);
    setTimeout(() => setPoppedPlan(null), 250);
  };
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    const handler = () => { setOpen(true); setError(null); };
    window.addEventListener(UPGRADE_EVENT, handler);
    return () => window.removeEventListener(UPGRADE_EVENT, handler);
  }, []);

  useEffect(() => {
    upgradeOpen = open;
    return () => { upgradeOpen = false; };
  }, [open]);

  // Their own numbers and the coach's actual top finding: the strongest food and feeling link,
  // from the same engine and in the same words as Patterns.
  const coach = useMemo(() => {
    if (!open) return null;
    const top = computeFoodFeelingLinks(meals, reflections)[0] ?? null;
    const realMeals = meals.filter((m) => m.analysisJson?.source !== "supplement" && m.status !== "failed").length;
    return {
      finding: top ? { text: foodLinkSentence(top), chip: CONFIDENCE_CHIP[top.confidence] } : null,
      meals: realMeals,
      mealsLabel: meals.length >= 400 ? `${realMeals}+` : String(realMeals), // the app loads the newest 400
      nights: new Set(reflections.map((r) => r.date)).size,
    };
  }, [open, meals, reflections]);

  // Load offerings when modal opens
  useEffect(() => {
    if (!open || !isNative) return;
    const load = async () => {
      if (referral) {
        // Until Apple approves the creator plan it isn't on sale, so fall back to the normal plans.
        const creator = await getOffering(CREATOR_OFFERING).catch(() => null);
        if (creator?.availablePackages.some((p) => p.product.identifier === CREATOR_MONTHLY_ID)) {
          setCreatorTrialOk(await isIntroEligible(CREATOR_MONTHLY_ID));
          return creator;
        }
      }
      return getOffering();
    };
    load().then((offering) => {
      if (!offering) {
        setError("Couldn't load products. Please try again.");
        return;
      }
      const pkgs = offering.availablePackages;
      if (pkgs.length === 0) {
        setError("Couldn't load products. Please try again.");
        return;
      }
      const monthly = pkgs.find(
        (p) => p.product.identifier === CREATOR_MONTHLY_ID || p.product.identifier === MONTHLY_ID
      ) ?? null;
      const yearly = pkgs.find(
        (p) => p.product.identifier === YEARLY_ID
      ) ?? null;
      if (!monthly && !yearly) {
        setError("Couldn't load products. Please try again.");
        return;
      }
      setPackages({ monthly, yearly });
    }).catch(() => {
      setError("Couldn't load products. Please try again.");
    });
  }, [open, isNative, referral]);

  if (!open) return null;

  const monthlyCost = packages.monthly?.product.priceString ?? "$12.99";
  const yearlyCost = packages.yearly?.product.priceString ?? "$109.99";
  const yearlyMonthly = packages.yearly ? `${(packages.yearly.product.price / 12).toFixed(2)}` : "9.17";
  const yearlySavings = Math.round((1 - (packages.yearly?.product.price ?? 109.99) / ((packages.monthly?.product.price ?? 12.99) * 12)) * 100);

  // Only promise the creator plan's free month when Apple confirms this person can get it.
  const isCreatorPlan = packages.monthly?.product.identifier === CREATOR_MONTHLY_ID;
  const monthlyTrial = packages.monthly?.product.introPrice?.price === 0 && (!isCreatorPlan || creatorTrialOk)
    ? packages.monthly.product.introPrice
    : null;
  const trial = plan === "monthly" && monthlyTrial ? trialLength(monthlyTrial) : null;

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
        if (!isPromptDone("p2")) setPendingReviewFlag("upgrade", "p2");
        setSuccess(true);
        setTimeout(() => { setOpen(false); setSuccess(false); }, 2000);
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
          {/* Icon (dropped on short screens such as the iPhone SE so the plans stay above the fold) */}
          <div className="h-14 w-14 [@media(max-height:740px)]:hidden">
            <img src="/icon.svg" alt="WhatYouAte" className="h-full w-full object-cover" />
          </div>

          {/* Headline */}
          <h1 className="mt-3 text-center text-xl font-semibold text-ink [@media(max-height:740px)]:mt-0">
            Unlock WhatYouAte Pro
          </h1>
          <p className={`mt-1.5 max-w-xs text-center text-sm text-muted/70 ${coach ? "[@media(max-height:740px)]:hidden" : ""}`}>
            See how your food affects how you feel, with daily coaching and your full nutrition picture.
          </p>

          {/* What the coach has so far: a real finding, or an honest "not yet", plus their numbers */}
          {coach && (
            <div data-paywall-coach className="mt-4 w-full rounded-2xl border border-primary/20 bg-primary/[0.05] px-4 py-3.5 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-dark/80">What Your Coach Is Noticing</p>
              <div className="mt-2.5 flex items-start gap-2.5">
                <div className="-mt-0.5 shrink-0"><WyaaAvatar size={32} /></div>
                <div className="min-w-0">
                  <p data-paywall-finding={coach.finding ? "real" : "none"} className="text-sm leading-snug text-ink/90">
                    {coach.finding ? coach.finding.text : STILL_CONNECTING}
                  </p>
                  {coach.finding && (
                    <span className="mt-1.5 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary/70">{coach.finding.chip}</span>
                  )}
                </div>
              </div>
              {(coach.meals > 0 || coach.nights > 0) && (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-primary/15 pt-2.5">
                  <div>
                    <p className="text-lg font-semibold leading-tight text-ink">{coach.mealsLabel}</p>
                    <p className="text-[11px] text-muted/70">{coach.meals === 1 ? "Meal Logged" : "Meals Logged"}</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold leading-tight text-ink">{coach.nights}</p>
                    <p className="text-[11px] text-muted/70">{coach.nights === 1 ? "Night Reflected" : "Nights Reflected"}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* What's included */}
          <div className="mt-4 w-full rounded-2xl border border-ink/8 bg-white px-5 py-3 space-y-2 [@media(max-height:740px)]:mt-3 [@media(max-height:740px)]:grid [@media(max-height:740px)]:grid-cols-2 [@media(max-height:740px)]:gap-x-3 [@media(max-height:740px)]:gap-y-2 [@media(max-height:740px)]:space-y-0 [@media(max-height:740px)]:px-4 [@media(max-height:740px)]:py-2.5">
            {[
              "Food & Feeling Connections",
              "Daily Coaching Nudges",
              "Macro & Micronutrient Trends",
              "AI Photo Logging",
            ].map((item, i) => {
              const hero = i === 0; // the differentiator — the headline reason to pay, so it stands out
              return (
              <div
                key={item}
                className="flex items-center gap-3 animate-fade-slide-up"
                style={{ animationDelay: `${i * 140}ms`, animationFillMode: "both" }}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${hero ? "bg-primary text-white" : "bg-primary/15 text-primary"}`}>
                  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                </span>
                <span className={hero ? "text-sm font-semibold text-ink" : "text-sm text-ink/80"}>{item}</span>
              </div>
              );
            })}
          </div>

          {isCreatorPlan && monthlyTrial && (
            <p className="mt-4 rounded-full bg-primary/10 px-3.5 py-1.5 text-center text-xs font-semibold text-primary">
              Creator code {referral}: your first month is free
            </p>
          )}

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
              ) : success ? "Welcome to Pro!" : trial ? `Try ${trial} Free` : "Unlock"}
            </button>

            <p className="text-center text-[11px] text-muted/50">
              {trial
                ? `Try free for ${trial.toLowerCase()}, then ${plan === "yearly" ? `${yearlyCost}/year` : `${monthlyCost}/month`}. Cancel anytime.`
                : "Cancel anytime. Subscriptions managed through Apple and can be cancelled in your device settings."}
            </p>

            <button
              type="button"
              onClick={handleRestore}
              disabled={loading || restoring}
              className="w-full text-center text-[11px] text-muted/40 underline underline-offset-2 active:opacity-60 disabled:opacity-40"
            >
              {restoring ? "Restoring…" : "Restore Purchase"}
            </button>

            <div className="flex items-center justify-center gap-4">
              <a
                href="https://whatyouate.app/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-muted/40 underline underline-offset-2"
              >
                Terms of Use
              </a>
              <a
                href="https://whatyouate.app/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-muted/40 underline underline-offset-2"
              >
                Privacy Policy
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
