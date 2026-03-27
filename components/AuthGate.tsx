"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import SplashScreen from "./SplashScreen";

// Once the app is fully ready (auth + data), never show the splash again this
// session — prevents any auth event flicker from re-showing the full-screen splash.
// Backed by sessionStorage so PWA wake-ups (minimize/restore) also skip it.
let _appReady = false;

export default function AuthGate({ children }: { children: ReactNode }) {
  const { loading: authLoading, user } = useAuth();
  const { loading: dataLoading } = useAppData();
  const [, setTick] = useState(0);

  // Restore from sessionStorage after mount — avoids SSR/client hydration mismatch
  useEffect(() => {
    if (!_appReady && sessionStorage.getItem("_appReady") === "1") {
      _appReady = true;
      setTick((t) => t + 1);
    }
  }, []);

  // Mark ready when both auth and data have resolved
  const fullyLoaded = !authLoading && (!user || !dataLoading);
  if (fullyLoaded && !_appReady) {
    _appReady = true;
    try { sessionStorage.setItem("_appReady", "1"); } catch {}
  }

  if (!_appReady) {
    return <SplashScreen />;
  }

  return children;
}
