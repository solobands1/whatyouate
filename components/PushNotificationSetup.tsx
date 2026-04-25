"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useAuth } from "./AuthProvider";

const PERMISSION_ASKED_KEY = "wya_push_permission_asked";

export default function PushNotificationSetup() {
  const { user } = useAuth();
  const [showPrePrompt, setShowPrePrompt] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!user || initialized.current) return;
    if (!Capacitor.isNativePlatform()) return;

    initialized.current = true;

    const alreadyAsked = localStorage.getItem(PERMISSION_ASKED_KEY);
    if (alreadyAsked) {
      initPush(user.id);
    } else {
      // Delay pre-prompt slightly so it doesn't appear immediately on first open
      const t = setTimeout(() => setShowPrePrompt(true), 3000);
      return () => clearTimeout(t);
    }
  }, [user]);

  async function initPush(userId: string) {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");

      const permStatus = await PushNotifications.checkPermissions();

      if (permStatus.receive === "prompt" || permStatus.receive === "prompt-with-rationale") {
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
    setShowPrePrompt(false);
    if (user) initPush(user.id);
  }

  function handleDecline() {
    localStorage.setItem(PERMISSION_ASKED_KEY, "declined");
    setShowPrePrompt(false);
  }

  if (!showPrePrompt) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-8">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        <div className="mb-4 text-center text-2xl">🔔</div>
        <h2 className="mb-2 text-center text-[17px] font-semibold text-ink">Stay on track</h2>
        <p className="mb-6 text-center text-[14px] leading-relaxed text-ink/60">
          Get a daily nudge from your coach when it's ready — so when you open the app, insights are already there waiting.
        </p>
        <button
          onClick={handleAllow}
          className="mb-3 w-full rounded-xl bg-primary py-3 text-[15px] font-semibold text-white active:opacity-80"
        >
          Turn On Notifications
        </button>
        <button
          onClick={handleDecline}
          className="w-full rounded-xl py-2.5 text-[14px] text-ink/40 active:opacity-60"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
