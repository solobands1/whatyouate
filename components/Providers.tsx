"use client";

import { AuthProvider } from "./AuthProvider";
import { AppDataProvider } from "./AppDataProvider";
import AuthGate from "./AuthGate";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppDataProvider>
        <AuthGate>{children}</AuthGate>
      </AppDataProvider>
    </AuthProvider>
  );
}
