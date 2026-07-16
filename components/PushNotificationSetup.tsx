"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { useAuth } from "./AuthProvider";
import { initPush, setPushNavigate, PUSH_ASKED_KEY, PUSH_DECLINED_AT_KEY, PUSH_REDECLINE_DAYS } from "../lib/push";

function BellIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export default function PushNotificationSetup() {
  const { user } = useAuth();
  const router = useRouter();
  const [showPrePrompt, setShowPrePrompt] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!user || initialized.current) return;
    if (!Capacitor.isNativePlatform()) return;

    initialized.current = true;

    // Route a tapped notification in-app (the reflection/meal reminders open home; nudges open summary).
    setPushNavigate((screen) => { if (screen === "summary") router.push("/summary"); });

    const asked = localStorage.getItem(PUSH_ASKED_KEY);
    const declinedAt = localStorage.getItem(PUSH_DECLINED_AT_KEY);

    // Always attempt silent registration — covers users who granted during onboarding or via iOS
    // Settings. silentIfNotGranted means it's a no-op if permission hasn't been granted yet.
    initPush(user.id, /* silentIfNotGranted */ true);

    const declinedRecently = declinedAt
      ? Date.now() - Number(declinedAt) < PUSH_REDECLINE_DAYS * 24 * 60 * 60 * 1000
      : false;

    // The PRIMARY ask now lives in onboarding. This banner is only a fallback re-ask — for people
    // who tapped "Maybe Later" (after the cooldown) or somehow skipped the onboarding step.
    if (!asked || (asked === "declined" && !declinedRecently)) {
      let cancelled = false;
      const tryShow = (attempt: number) => {
        if (cancelled || !user) return;
        const walkthroughActive = localStorage.getItem(`wya_walkthrough_active_${user.id}`) === "true";
        const onboardingDone = localStorage.getItem(`wya_onboarding_done_${user.id}`) === "true";
        if (walkthroughActive || !onboardingDone) return;
        // Don't stack on a home celebration/nudge banner (same top slot) — wait for it to clear.
        if (typeof document !== "undefined" && document.querySelector("[data-top-banner]") && attempt < 8) {
          setTimeout(() => tryShow(attempt + 1), 5000);
          return;
        }
        setShowPrePrompt(true);
      };
      const t = setTimeout(() => tryShow(0), 5000);
      return () => { cancelled = true; clearTimeout(t); };
    }
  }, [user, router]);

  function handleAllow() {
    localStorage.setItem(PUSH_ASKED_KEY, "1");
    localStorage.removeItem(PUSH_DECLINED_AT_KEY);
    setShowPrePrompt(false);
    if (user) initPush(user.id);
  }

  function handleDecline() {
    localStorage.setItem(PUSH_ASKED_KEY, "declined");
    localStorage.setItem(PUSH_DECLINED_AT_KEY, String(Date.now()));
    setShowPrePrompt(false);
  }

  if (!showPrePrompt) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 animate-slide-down mx-auto max-w-md bg-white/60 backdrop-blur-xl border-b border-white/40 px-5 pb-4 safe-top">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-primary shrink-0">
          <BellIcon />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-ink leading-snug">Turn On Notifications</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink/55">
            Get personalized nudges from your coach delivered when they matter most
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={handleDecline}
          className="flex-1 rounded-xl border border-ink/10 py-2 text-[13px] font-medium text-ink/50 active:opacity-60"
        >
          Not Now
        </button>
        <button
          onClick={handleAllow}
          className="flex-[2] rounded-xl bg-primary py-2 text-[13px] font-semibold text-white active:opacity-80"
        >
          Turn On
        </button>
      </div>
    </div>
  );
}
