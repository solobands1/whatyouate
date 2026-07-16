import { Capacitor } from "@capacitor/core";

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
          const res = await fetch("/api/push/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
