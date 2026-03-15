"use client";

import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { loading } = useAuth();

  if (loading) {
    return null;
  }

  return children;
}
