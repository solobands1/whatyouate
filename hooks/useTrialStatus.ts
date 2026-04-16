import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { useAppData } from "../components/AppDataProvider";
import { computeTrialStatus, type TrialStatus } from "../lib/trial";
import { initializePurchases, checkIsPro } from "../lib/purchases";

export function useTrialStatus(): TrialStatus {
  const { user } = useAuth();
  const { meals } = useAppData();
  const [rcIsPro, setRcIsPro] = useState(false);

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
    const status = computeTrialStatus(meals, user?.id ?? null);
    if (rcIsPro && !status.isPro) {
      return { ...status, isPro: true, isFree: false, isTrialActive: false, isExpired: false };
    }
    return status;
  }, [meals, user?.id, rcIsPro]);
}
