"use client";

import { useEffect, useState } from "react";
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";
import { Capacitor } from "@capacitor/core";
import {
  CREATOR_MONTHLY_ID,
  CREATOR_OFFERING,
  getOffering,
  initializePurchases,
  isIntroEligible,
  purchasePackage,
} from "../lib/purchases";

/**
 * Shown right after someone signs up with a creator code: start the Monthly (Creator) plan with its
 * one month free trial, or carry on with the normal 7 days. Calls onDone straight away when Apple
 * won't give this person the trial, so nobody sees an offer they can't get. In a web browser it
 * shows with the usual price but can't purchase, like the upgrade screen.
 */
export default function CreatorOffer({
  userId,
  code,
  name,
  onDone,
}: {
  userId: string;
  code: string;
  name: string | null;
  onDone: () => void;
}) {
  const [pkg, setPkg] = useState<PurchasesPackage | null>(null);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!isNative) return;
    let live = true;
    (async () => {
      try {
        await initializePurchases(userId);
        const offering = await getOffering(CREATOR_OFFERING);
        const monthly = offering?.availablePackages.find((p) => p.product.identifier === CREATOR_MONTHLY_ID) ?? null;
        if (!monthly || !(await isIntroEligible(CREATOR_MONTHLY_ID))) return onDone();
        if (live) setPkg(monthly);
      } catch {
        onDone();
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!pkg && isNative) {
    return (
      <div className="flex justify-center py-16">
        <svg className="h-6 w-6 animate-spin text-primary/60" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      </div>
    );
  }

  const price = pkg?.product.priceString ?? "$12.99";

  const start = async () => {
    if (buying) return;
    if (!pkg) {
      setError("Purchases are only available in the iOS app.");
      return;
    }
    setBuying(true);
    setError(null);
    try {
      const info = await purchasePackage(pkg);
      if (info.entitlements.active["pro"]) {
        window.dispatchEvent(new CustomEvent("wya_purchase_complete"));
        setWelcome(true);
        setTimeout(onDone, 1600);
      } else {
        setError("Something went wrong. You can start your free month later from the upgrade screen.");
      }
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== "PURCHASE_CANCELLED") {
        setError("Couldn't start your free month. Please try again.");
      }
    } finally {
      setBuying(false);
    }
  };

  return (
    <div className="flex flex-col items-center text-center">
      <img src="/icon.svg" alt="WhatYouAte" className="h-14 w-14 object-cover" />
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-primary/80">
        {name ? `${name}'s code` : "Your code"} · {code}
      </p>
      <h2 className="mt-2 text-xl font-semibold text-ink">Your First Month Is Free</h2>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted/70">
        Get everything in WhatYouAte Pro free for a month: the food and feeling connections, daily coaching and your
        full nutrition picture.
      </p>

      <div className="mt-6 w-full space-y-2.5">
        {error && <p className="text-[11px] text-red-500/80">{error}</p>}
        <button
          type="button"
          onClick={start}
          disabled={buying || welcome}
          className="w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-white transition active:scale-[0.98] active:opacity-80 disabled:opacity-60"
        >
          {welcome ? "Welcome to Pro!" : buying ? "Processing…" : "Start My Free Month"}
        </button>
        <p className="text-[11px] leading-relaxed text-muted/50">
          Free for 1 month, then {price}/month. Renews automatically unless you cancel at least 24 hours before the
          free month ends. Cancel anytime in Settings.
        </p>
        <button
          type="button"
          onClick={onDone}
          disabled={buying}
          className="w-full py-2 text-sm font-medium text-muted/60 transition active:opacity-60"
        >
          Not now, start with 7 days free
        </button>
        <div className="flex items-center justify-center gap-4 pt-1">
          <a href="https://whatyouate.app/terms" target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted/40 underline underline-offset-2">
            Terms of Use
          </a>
          <a href="https://whatyouate.app/privacy" target="_blank" rel="noopener noreferrer" className="text-[11px] text-muted/40 underline underline-offset-2">
            Privacy Policy
          </a>
        </div>
      </div>
    </div>
  );
}
