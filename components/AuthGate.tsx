"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import SplashScreen from "./SplashScreen";

// Module-level flag persists across client-side navigations (Providers stays mounted).
// sessionStorage backup handles the case where the module is re-evaluated.
let _appReady = false;

function isSessionReady(): boolean {
  try { return sessionStorage.getItem("_appReady") === "1"; } catch { return false; }
}

function markSessionReady(): void {
  try { sessionStorage.setItem("_appReady", "1"); } catch {}
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const { loading: authLoading, user } = useAuth();
  const { loading: dataLoading } = useAppData();

  // Start as false so server and client agree on initial render — no hydration mismatch.
  const [ready, setReady] = useState(false);

  const fullyLoaded = !authLoading && (!user || !dataLoading);

  // On mount (client only): if this session already completed the splash, skip it immediately.
  useEffect(() => {
    if (_appReady || isSessionReady()) {
      _appReady = true;
      setReady(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once auth + data are fully loaded for the first time, mark ready and persist.
  useEffect(() => {
    if (ready || !fullyLoaded) return;
    _appReady = true;
    markSessionReady();
    setReady(true);
  }, [fullyLoaded, ready]);

  if (!ready) return <SplashScreen />;
  return <>{children}</>;
}
