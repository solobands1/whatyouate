import { useMemo } from "react";
import { useAuth } from "../components/AuthProvider";
import { useAppData } from "../components/AppDataProvider";
import { computeTrialStatus, type TrialStatus } from "../lib/trial";

export function useTrialStatus(): TrialStatus {
  const { user } = useAuth();
  const { meals } = useAppData();
  return useMemo(
    () => computeTrialStatus(meals, user?.id ?? null),
    [meals, user]
  );
}
