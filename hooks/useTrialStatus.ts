import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { useAppData } from "../components/AppDataProvider";
import { computeTrialStatus, type TrialStatus } from "../lib/trial";
import { initializePurchases, checkIsPro } from "../lib/purchases";
import { devHooksEnabled } from "../lib/devHooks";

export function useTrialStatus(): TrialStatus {
  const { user } = useAuth();
  const { meals } = useAppData();
  const [rcIsPro, setRcIsPro] = useState(false);

  // Dev-only state override (strip pre-merge): ?trial=pro | ?trial=expired |
  // ?trial=active | ?trialday=N (active trial forced to day N) to preview every
  // trial/paywall state on any account without juggling data.
  const [override, setOverride] = useState<TrialStatus | null>(null);
  useEffect(() => {
    if (!devHooksEnabled()) return; // inert in any native (TestFlight/App Store) build
    const p = new URLSearchParams(window.location.search);
    let t = p.get("trial");
    const dayRaw = parseInt(p.get("trialday") ?? "", 10);
    const hasDay = !Number.isNaN(dayRaw);
    // Persist across client-side navigation (which drops the query param). ?trial=off clears it.
    try {
      if (t === "off") { sessionStorage.removeItem("wya_trial_override"); setOverride(null); return; }
      if (t) sessionStorage.setItem("wya_trial_override", t);
      else if (!hasDay) t = sessionStorage.getItem("wya_trial_override");
    } catch {}
    if (t === "pro") {
      setOverride({ hasStarted: true, isTrialActive: false, isExpired: false, isPro: true, isFree: false, currentDay: 0, daysLeft: 7 });
    } else if (t === "expired") {
      setOverride({ hasStarted: true, isTrialActive: false, isExpired: true, isPro: false, isFree: true, currentDay: 7, daysLeft: 0 });
    } else if (t === "active" || hasDay) {
      const d = Math.min(Math.max(hasDay ? dayRaw : 3, 1), 7);
      setOverride({ hasStarted: true, isTrialActive: true, isExpired: false, isPro: false, isFree: false, currentDay: d, daysLeft: Math.max(0, 8 - d) });
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    initializePurchases(user.id)
      .then(() => checkIsPro())
      .then(setRcIsPro)
      .catch(() => {});
  }, [user?.id]);

  // Listen for successful purchases and recheck entitlements
  useEffect(() => {
    const handler = async () => {
      const pro = await checkIsPro().catch(() => false);
      setRcIsPro(pro);
    };
    window.addEventListener("wya_purchase_complete", handler);
    return () => window.removeEventListener("wya_purchase_complete", handler);
  }, []);

  return useMemo(() => {
    if (override) return override; // dev-only ?trial / ?trialday override
    const status = computeTrialStatus(meals, user?.id ?? null, user?.email ?? null);
    if (rcIsPro && !status.isPro) {
      return { ...status, isPro: true, isFree: false, isTrialActive: false, isExpired: false };
    }
    return status;
  }, [override, meals, user?.id, user?.email, rcIsPro]);
}
