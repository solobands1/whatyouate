"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import SplashScreen from "./SplashScreen";

// Once auth resolves once, never show the splash again for this session —
// prevents any brief loading=true flicker (token refresh, auth events, etc.)
// from showing the full-screen splash during navigation.
// Backed by sessionStorage so page reloads (e.g. minimize/restore on mobile) don't reset it.
// NOTE: sessionStorage is read in useEffect (not render) to avoid SSR/hydration mismatches.
let _authResolved = false;

export default function AuthGate({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  const [, setTick] = useState(0);

  // Restore from sessionStorage after mount — avoids SSR/client hydration mismatch
  useEffect(() => {
    if (!_authResolved && sessionStorage.getItem("_authResolved") === "1") {
      _authResolved = true;
      setTick((t) => t + 1);
    }
  }, []);

  if (!loading) {
    _authResolved = true;
    try { sessionStorage.setItem("_authResolved", "1"); } catch {}
  }

  if (!_authResolved) {
    return <SplashScreen />;
  }

  return children;
}
