"use client";

import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import SplashScreen from "./SplashScreen";

// Module-level flag — may reset on route changes due to Next.js module re-evaluation.
// Backed by sessionStorage so tab switches never re-show the splash once ready.
// Hard reload clears sessionStorage intentionally — data must re-fetch on cold start.
let _appReady = false;

function isSessionReady(): boolean {
  try { return sessionStorage.getItem("_appReady") === "1"; } catch { return false; }
}

function markSessionReady(): void {
  try { sessionStorage.setItem("_appReady", "1"); } catch {}
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const { loading: authLoading, user } = useAuth();
  const { loading: dataLoading, nudgesLoaded } = useAppData();

  // Restore from sessionStorage if module was re-evaluated during navigation
  if (!_appReady && isSessionReady()) {
    _appReady = true;
  }

  // Mark ready once auth + data + nudges have all resolved for the first time
  const fullyLoaded = !authLoading && (!user || (!dataLoading && nudgesLoaded));
  if (fullyLoaded && !_appReady) {
    _appReady = true;
    markSessionReady();
  }

  if (!_appReady) {
    return <SplashScreen />;
  }

  return children;
}
