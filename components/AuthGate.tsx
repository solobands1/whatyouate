"use client";

import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import SplashScreen from "./SplashScreen";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { loading } = useAuth();

  if (loading) {
    return <SplashScreen />;
  }

  return children;
}
