"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useAuth } from "./AuthProvider";
import { checkHealthKitAuthorization, getHealthKitAuthStatus, requestHealthKitPermissions, syncHealthKitActivity } from "../lib/healthKit";
import { PUSH_ASKED_KEY, PUSH_DECLINED_AT_KEY, PUSH_REDECLINE_DAYS } from "../lib/push";
import { readFirstMeal } from "../lib/firstMeal";
import { todayKey } from "../lib/utils";

// Apple Health is no longer asked for in onboarding, where it landed within a minute of the
// notifications and camera prompts. Instead new users get one ask from their second day: a banner
// in the same style as the notifications one (PushNotificationSetup). The key holds the day they
// finished onboarding and is only written by onboarding, so people who onboarded before this see
// nothing new. Profile's Apple Health "Connect" works for everyone, as before.
export const healthAskKey = (uid: string) => `wya_health_ask_${uid}`;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

// The notifications banner shows this launch (same rule as PushNotificationSetup), so Health waits
// for another day rather than stacking a second banner on it.
function pushBannerDue(): boolean {
  const asked = read(PUSH_ASKED_KEY);
  if (!asked) return true;
  if (asked !== "declined") return false;
  const at = Number(read(PUSH_DECLINED_AT_KEY) || 0);
  return Date.now() - at >= PUSH_REDECLINE_DAYS * 24 * 60 * 60 * 1000;
}

function HealthIcon() {
  return (
    <svg viewBox="0 0 16 16" width="28" height="28" aria-hidden="true">
      <defs>
        <linearGradient id="ahHeartAsk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF6482" />
          <stop offset="1" stopColor="#FF2D55" />
        </linearGradient>
      </defs>
      <path fill="url(#ahHeartAsk)" d="M8 13.7C7.7 13.5 1 9.2 1 5.5 1 3.6 2.6 2 4.5 2c1 0 2 .5 2.7 1.3L8 4.2l.8-.9C9.5 2.5 10.5 2 11.5 2 13.4 2 15 3.6 15 5.5c0 3.7-6.7 8-7 8.2z" />
    </svg>
  );
}

export default function HealthKitSetup() {
  const { user } = useAuth();
  const [showAsk, setShowAsk] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    if (localStorage.getItem(`wya_healthkit_connected_${user.id}`) !== "true") return;
    // Don't clear localStorage on false: the write-auth check returns false for read-only grants
    syncHealthKitActivity(user.id);
  }, [user?.id]);

  // The one-time ask, from the day after onboarding.
  useEffect(() => {
    if (!user?.id || !Capacitor.isNativePlatform()) return;
    const uid = user.id;
    const from = read(healthAskKey(uid));
    if (!from || todayKey() <= from) return;
    const done = () => { try { localStorage.removeItem(healthAskKey(uid)); } catch { /* ignore */ } };
    let cancelled = false;
    const tryShow = async (attempt: number) => {
      if (cancelled) return;
      if (read(`wya_healthkit_connected_${uid}`) === "true") { done(); return; }
      if (read(`wya_onboarding_done_${uid}`) !== "true" || read(`wya_walkthrough_active_${uid}`) === "true") return;
      if (readFirstMeal(uid) || pushBannerDue()) return; // another launch
      // Don't stack on a home celebration or nudge banner (same top slot): wait for it to clear.
      if (document.querySelector("[data-top-banner], [data-push-banner]")) {
        if (attempt < 8) setTimeout(() => tryShow(attempt + 1), 5000);
        return;
      }
      const { notDetermined } = await getHealthKitAuthStatus();
      if (cancelled) return;
      if (!notDetermined) { done(); return; } // iOS has already asked on this phone
      setShowAsk(true);
    };
    const t = setTimeout(() => tryShow(0), 9000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [user?.id]);

  if (!showAsk || !user) return null;

  const close = () => {
    try { localStorage.removeItem(healthAskKey(user.id)); } catch { /* ignore */ }
    setShowAsk(false);
  };
  const connect = async () => {
    if (connecting) return;
    setConnecting(true);
    await requestHealthKitPermissions();
    const granted = await checkHealthKitAuthorization();
    if (granted) {
      try { localStorage.setItem(`wya_healthkit_connected_${user.id}`, "true"); } catch { /* ignore */ }
      syncHealthKitActivity(user.id).catch(() => {});
    }
    setConnecting(false);
    close();
  };

  return (
    <div className="fixed inset-x-0 top-0 z-50 animate-slide-down mx-auto max-w-md bg-white/60 backdrop-blur-xl border-b border-white/40 px-5 pb-4 safe-top" data-health-banner>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <HealthIcon />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-ink leading-snug">Connect Apple Health</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink/55">
            Sync steps, sleep, and workouts to make your coach smarter.
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={close}
          disabled={connecting}
          className="flex-1 rounded-xl border border-ink/10 py-2 text-[13px] font-medium text-ink/50 active:opacity-60"
        >
          Not Now
        </button>
        <button
          onClick={connect}
          disabled={connecting}
          className="flex-[2] rounded-xl bg-primary py-2 text-[13px] font-semibold text-white active:opacity-80 disabled:opacity-60"
        >
          {connecting ? "Connecting…" : "Connect"}
        </button>
      </div>
    </div>
  );
}
