"use client";

import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { syncHealthKitActivity, checkHealthKitAuthorization } from "../lib/healthKit";

export default function HealthKitSetup() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    if (localStorage.getItem(`wya_healthkit_connected_${user.id}`) !== "true") return;
    checkHealthKitAuthorization().then((authorized) => {
      if (!authorized) {
        localStorage.removeItem(`wya_healthkit_connected_${user.id}`);
        return;
      }
      syncHealthKitActivity(user.id);
    });
  }, [user?.id]);

  return null;
}
