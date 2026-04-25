"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useAuth } from "./AuthProvider";

const PERMISSION_ASKED_KEY = "wya_push_permission_asked";
const DECLINED_AT_KEY = "wya_push_declined_at";
const REDECLINE_DAYS = 3;

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
  const [showPrePrompt, setShowPrePrompt] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!user || initialized.current) return;
    if (!Capacitor.isNativePlatform()) return;

    initialized.current = true;

    const asked = localStorage.getItem(PERMISSION_ASKED_KEY);
    const declinedAt = localStorage.getItem(DECLINED_AT_KEY);

    // Always try to register if permissions are already granted (e.g. enabled via Settings)
    if (asked === "1" || asked === "declined") {
      initPush(user.id, /* silentIfNotGranted */ true);
    }

    // Decide whether to show the pre-prompt banner
    const declinedRecently = declinedAt
      ? Date.now() - Number(declinedAt) < REDECLINE_DAYS * 24 * 60 * 60 * 1000
      : false;

    if (!asked || (asked === "declined" && !declinedRecently)) {
      const t = setTimeout(() => {
        const walkthroughActive = localStorage.getItem(`wya_walkthrough_active_${user.id}`) === "true";
        if (!walkthroughActive) setShowPrePrompt(true);
      }, 5000);
      return () => clearTimeout(t);
    }
  }, [user]);

  async function initPush(userId: string, silentIfNotGranted = false) {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");

      const permStatus = await PushNotifications.checkPermissions();

      if (permStatus.receive === "prompt" || permStatus.receive === "prompt-with-rationale") {
        if (silentIfNotGranted) return;
        const result = await PushNotifications.requestPermissions();
        if (result.receive !== "granted") return;
      } else if (permStatus.receive !== "granted") {
        return;
      }

      await PushNotifications.register();

      PushNotifications.addListener("registration", async (token) => {
        try {
          await fetch("/api/push/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, token: token.value }),
          });
        } catch {
          // Silently fail — token will be registered next launch
        }
      });

      PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const screen = action.notification.data?.screen;
        if (screen === "summary") {
          window.location.hash = "#/summary";
          window.dispatchEvent(new CustomEvent("navigate", { detail: { screen: "summary" } }));
        }
      });
    } catch {
      // Plugin not available (simulator / web)
    }
  }

  function handleAllow() {
    localStorage.setItem(PERMISSION_ASKED_KEY, "1");
    localStorage.removeItem(DECLINED_AT_KEY);
    setShowPrePrompt(false);
    if (user) initPush(user.id);
  }

  function handleDecline() {
    localStorage.setItem(PERMISSION_ASKED_KEY, "declined");
    localStorage.setItem(DECLINED_AT_KEY, String(Date.now()));
    setShowPrePrompt(false);
  }

  if (!showPrePrompt) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 animate-slide-down px-3 pt-12 max-w-screen overflow-hidden">
      <div className="rounded-2xl bg-white/70 backdrop-blur-xl shadow-lg border border-white/50 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-primary shrink-0">
            <BellIcon />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold text-ink leading-snug">Turn On Notifications</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink/55">
              Get personalized nudges from your coach delivered when they matter most.
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
    </div>
  );
}
