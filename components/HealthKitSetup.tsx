"use client";

import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { syncHealthKitActivity } from "../lib/healthKit";

export default function HealthKitSetup() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    if (localStorage.getItem(`wya_healthkit_connected_${user.id}`) !== "true") return;
    // Don't clear localStorage on false — write-auth check returns false for read-only grants
    syncHealthKitActivity(user.id);
  }, [user?.id]);

  return null;
}
