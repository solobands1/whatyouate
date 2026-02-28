"use client";

import { useAuth } from "./AuthProvider";

export default function AuthGate({ children }) {
  const { loading } = useAuth();

  if (loading) {
    return null;
  }

  return children;
}
