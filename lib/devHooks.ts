import { Capacitor } from "@capacitor/core";

// Dev-only URL hooks (?trial / ?trialday, ?days / ?meals / ?refl, ?cue, ?fdebug) are testing
// shortcuts that force trial/paywall, unlock-ladder, and cue states from the address bar. They
// must work in a browser (our dev preview) but never inside the shipped native app.
// Capacitor.isNativePlatform() is true in any TestFlight / App Store build and false in a
// browser, so gating on it makes the hooks inert for real testers and users while staying
// usable for us. (These were marked "strip pre-merge"; this guard is the standing version.)
export function devHooksEnabled(): boolean {
  return typeof window !== "undefined" && !Capacitor.isNativePlatform();
}
