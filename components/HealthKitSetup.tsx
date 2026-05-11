"use client";

import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { syncHealthKitActivity } from "../lib/healthKit";

export default function HealthKitSetup() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    syncHealthKitActivity(user.id).then((connected) => {
      if (connected) {
        localStorage.setItem(`wya_healthkit_connected_${user.id}`, "true");
      }
    });
  }, [user?.id]);

  return null;
}
