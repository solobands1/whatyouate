"use client";

import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import SplashScreen from "./SplashScreen";

// Module-level flag — persists through client-side navigation so the splash
// never re-appears when switching tabs. Resets on full page reload (intentional:
// on reload, data must be fetched fresh before the app is shown).
let _appReady = false;

export default function AuthGate({ children }: { children: ReactNode }) {
  const { loading: authLoading, user } = useAuth();
  const { loading: dataLoading, nudgesLoaded } = useAppData();

  // All three must resolve before the splash lifts
  const fullyLoaded = !authLoading && (!user || (!dataLoading && nudgesLoaded));
  if (fullyLoaded && !_appReady) {
    _appReady = true;
  }

  if (!_appReady) {
    return <SplashScreen />;
  }

  return children;
}
