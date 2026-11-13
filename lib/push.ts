import { Capacitor } from "@capacitor/core";
import { supabase } from "./supabaseClient";

export const PUSH_ASKED_KEY = "wya_push_permission_asked";
export const PUSH_DECLINED_AT_KEY = "wya_push_declined_at";
export const PUSH_REDECLINE_DAYS = 3;

let listenersAdded = false;
let navigateHandler: ((screen: string) => void) | null = null;

// PushNotificationSetup registers this so a tapped notification can route in-app (it owns the
// router). Kept out of lib/push so this module stays framework-agnostic.
export function setPushNavigate(fn: (screen: string) => void) {
  navigateHandler = fn;
}

// Request permission (if needed) + register the device token. `silentIfNotGranted` makes it a
// no-op when permission hasn't been granted yet (used for background re-registration on mount).
// Safe to call from multiple places — the OS listeners are added at most once. Returns true if
// the device ended up granted/registered. No-op (false) off native.
export async function initPush(userId: string, silentIfNotGranted = false): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    const permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive === "prompt" || permStatus.receive === "prompt-with-rationale") {
      if (silentIfNotGranted) return false;
      const result = await PushNotifications.requestPermissions();
      if (result.receive !== "granted") return false;
    } else if (permStatus.receive !== "granted") {
      return false;
    }

    // Listeners must be added before register() — the token event can fire immediately after
    // register(). Guarded so multiple callers (onboarding + the fallback banner) don't stack them.
    if (!listenersAdded) {
      listenersAdded = true;
      PushNotifications.addListener("registration", async (token) => {
        try {
          const { data: sess } = await supabase.auth.getSession();
          const accessToken = sess.session?.access_token;
          const res = await fetch("/api/push/register", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify({ userId, token: token.value }),
          });
          if (!res.ok) console.error("[push] Token registration failed:", res.status, await res.text());
          else localStorage.setItem("wya_push_token", token.value);
        } catch (err) {
          console.error("[push] Token registration error:", err);
        }
      });
      PushNotifications.addListener("registrationError", (err) => {
        console.error("[push] Registration error:", JSON.stringify(err));
      });
      PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
        const screen = action.notification.data?.screen;
        if (screen && navigateHandler) navigateHandler(screen);
      });
    }

    await PushNotifications.register();
    return true;
  } catch (err) {
    console.error("[push] initPush error:", err);
    return false;
  }
}

// Current notification permission state, for the Profile toggle. "unsupported" on web.
export async function getPushStatus(): Promise<"granted" | "prompt" | "denied" | "unsupported"> {
  if (!Capacitor.isNativePlatform()) return "unsupported";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const s = await PushNotifications.checkPermissions();
    if (s.receive === "granted") return "granted";
    if (s.receive === "denied") return "denied";
    return "prompt";
  } catch {
    return "unsupported";
  }
}

// Whether a soft "turn on notifications" ask is worth showing now: iOS hasn't asked yet, and they
// didn't tap Maybe Later in the last few days. False off native.
export async function pushAskDue(): Promise<boolean> {
  if ((await getPushStatus()) !== "prompt") return false;
  try {
    if (localStorage.getItem(PUSH_ASKED_KEY) === "declined") {
      const at = Number(localStorage.getItem(PUSH_DECLINED_AT_KEY) || 0);
      if (Date.now() - at < PUSH_REDECLINE_DAYS * 24 * 60 * 60 * 1000) return false;
    }
  } catch { /* storage blocked: ask */ }
  return true;
}

// Shows the real iOS dialog (when it hasn't been answered) and registers the device. Marks it asked
// first, so the fallback banner (PushNotificationSetup) never asks again on top. Resolves with
// whether notifications ended up on.
export async function askPushPermission(userId: string): Promise<boolean> {
  try {
    localStorage.setItem(PUSH_ASKED_KEY, "1");
    localStorage.removeItem(PUSH_DECLINED_AT_KEY);
  } catch { /* ignore */ }
  return initPush(userId);
}

// "Maybe Later" on a soft ask: the fallback banner may ask again after PUSH_REDECLINE_DAYS.
export function markPushDeclined(): void {
  try {
    localStorage.setItem(PUSH_ASKED_KEY, "declined");
    localStorage.setItem(PUSH_DECLINED_AT_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

// Open the iOS Settings page for this app, so a user who denied can re-enable Notifications.
export async function openPushSettings(): Promise<void> {
  try { window.open("app-settings:", "_system"); } catch { /* no-op */ }
}
