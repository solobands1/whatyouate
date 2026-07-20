"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { useAppData, _dataEverLoaded } from "./AppDataProvider";
import SplashScreen from "./SplashScreen";

// Module-level flag — persists across client-side navigations, resets on full page reload.
let _appReady = false;
// Set when the next splash follows a sign-in, so it renders the login-matched layout (seamless
// login → splash) instead of the centered launch splash. Reset once the app is ready.
let _postLoginSplash = false;

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
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  // True once we've observed a confirmed logged-out state (auth resolved, no user) — i.e. the
  // login screen was actually on screen. Lets us tell a real sign-in apart from a cold launch
  // that restores a session (both look like "no user → user", only the former is a login).
  const sawLoggedOutRef = useRef(false);

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

  // Record a confirmed logged-out state (auth resolved, no user) — the login screen is showing.
  useEffect(() => {
    if (!authLoading && !user) sawLoggedOutRef.current = true;
  }, [authLoading, user]);

  // When user transitions from logged-out → logged-in, reset splash so it shows during data
  // load. Only render the login-matched splash if we were genuinely on the login screen first
  // (a real sign-in) — not on a cold launch that just restored a session.
  useEffect(() => {
    const prev = prevUserIdRef.current;
    prevUserIdRef.current = user?.id ?? null;
    if (!prev && user?.id) {
      _appReady = false;
      if (sawLoggedOutRef.current) _postLoginSplash = true;
      sawLoggedOutRef.current = false;
      try { sessionStorage.removeItem("_appReady"); } catch {}
      setReady(false);
    }
  }, [user?.id]);

  // Once fully loaded for the first time, mark ready and persist for this session.
  useEffect(() => {
    if (ready || !fullyLoaded) return;
    _appReady = true;
    _postLoginSplash = false;
    markSessionReady();
    setReady(true);
  }, [fullyLoaded, ready]);

  if (!ready) return <SplashScreen variant={_postLoginSplash ? "login" : "launch"} />;
  return <>{children}</>;
}
