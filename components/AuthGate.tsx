"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { useAppData, _dataEverLoaded } from "./AppDataProvider";
import SplashScreen from "./SplashScreen";

// Module-level flag — persists across client-side navigations, resets on full page reload.
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

  // Start as false so server and client agree on initial render — no hydration mismatch.
  const [ready, setReady] = useState(false);

  // Wait for auth + main data + nudges (all load in parallel so nudges add minimal extra time)
  const fullyLoaded = !authLoading && (!user || (!dataLoading && nudgesLoaded));

  // On mount: skip splash if data was already loaded this lifecycle OR this session.
  // sessionStorage guards against iOS Safari partial remounts on background/foreground.
  // It is only ever set AFTER data has fully loaded (below), so it never skips prematurely.
  useEffect(() => {
    if (_appReady || _dataEverLoaded || isSessionReady()) {
      _appReady = true;
      setReady(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once fully loaded for the first time, mark ready and persist for this session.
  useEffect(() => {
    if (ready || !fullyLoaded) return;
    _appReady = true;
    markSessionReady();
    setReady(true);
  }, [fullyLoaded, ready]);

  if (!ready) return <SplashScreen />;
  return <>{children}</>;
}
