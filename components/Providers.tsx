"use client";

import { AuthProvider } from "./AuthProvider";
import AuthGate from "./AuthGate";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>{children}</AuthGate>
    </AuthProvider>
  );
}
