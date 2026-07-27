import { Capacitor } from "@capacitor/core";

// Dev-only hooks (?trial / ?trialday, ?days / ?meals / ?refl, ?cue, ?fdebug URL params, plus
// the habit-hero "force state" taps) are testing shortcuts that force trial/paywall, unlock-
// ladder, cue, and habit states. They must work for US (browser dev preview + a native build
// pointed at the preview) but NEVER in the shipped production app.
//
// - Any browser  -> enabled (our dev preview; also the marketing site, unchanged).
// - Native shell -> enabled ONLY when loaded from a Vercel *preview* build. Preview branch URLs
//   contain "-git-" (e.g. whatyouate-git-dev-...vercel.app); production is whatyouate.vercel.app
//   (no "-git-"), so the shipped app stays inert for real testers and users.
export function devHooksEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (!Capacitor.isNativePlatform()) return true;
  try {
    return window.location.hostname.includes("-git-");
  } catch {
    return false;
  }
}
