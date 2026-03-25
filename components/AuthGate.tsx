"use client";

import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import SplashScreen from "./SplashScreen";

// Once auth resolves once, never show the splash again for this session —
// prevents any brief loading=true flicker (token refresh, auth events, etc.)
// from showing the full-screen splash during navigation.
let _authResolved = false;

export default function AuthGate({ children }: { children: ReactNode }) {
  const { loading } = useAuth();

  if (!loading) _authResolved = true;

  if (!_authResolved) {
    return <SplashScreen />;
  }

  return children;
}
