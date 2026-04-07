"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { useAppData, _dataEverLoaded } from "./AppDataProvider";
import SplashScreen from "./SplashScreen";

// Module-level flag persists across client-side navigations (Providers stays mounted).
// Resets on full page reload — unlike sessionStorage, so we never skip splash before data is ready.
let _appReady = false;

export default function AuthGate({ children }: { children: ReactNode }) {
  const { loading: authLoading, user } = useAuth();
  const { loading: dataLoading, nudgesLoaded } = useAppData();

  // Start as false so server and client agree on initial render — no hydration mismatch.
  const [ready, setReady] = useState(false);

  // Wait for auth + main data + nudges (all load in parallel so nudges add minimal extra time)
  const fullyLoaded = !authLoading && (!user || (!dataLoading && nudgesLoaded));

  // On mount (client only): if data was already loaded this module lifecycle (client-side nav), skip splash.
  useEffect(() => {
    if (_appReady || _dataEverLoaded) {
      _appReady = true;
      setReady(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once fully loaded for the first time, mark ready.
  useEffect(() => {
    if (ready || !fullyLoaded) return;
    _appReady = true;
    setReady(true);
  }, [fullyLoaded, ready]);

  if (!ready) return <SplashScreen />;
  return <>{children}</>;
}
