"use client";

import { AuthProvider } from "./AuthProvider";
import { AppDataProvider } from "./AppDataProvider";
import AuthGate from "./AuthGate";
import UpgradeModal from "./UpgradeModal";
import ValueMomentSheet from "./ValueMomentSheet";
import PushNotificationSetup from "./PushNotificationSetup";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppDataProvider>
        <AuthGate>{children}</AuthGate>
        <UpgradeModal />
        <ValueMomentSheet />
        <PushNotificationSetup />
      </AppDataProvider>
    </AuthProvider>
  );
}
