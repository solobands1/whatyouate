"use client";

import { useEffect, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import SplashScreen from "./SplashScreen";

function removeStaticSplash() {
  const el = document.getElementById("app-splash");
  if (el) el.remove();
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const { loading } = useAuth();

  // Once auth resolves, remove the static HTML splash that showed before JS loaded
  useEffect(() => {
    if (!loading) removeStaticSplash();
  }, [loading]);

  if (loading) {
    return <SplashScreen />;
  }

  return children;
}
