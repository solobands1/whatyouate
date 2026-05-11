"use client";

import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { requestHealthKitPermissions, syncHealthKitActivity } from "../lib/healthKit";

export default function HealthKitSetup() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    requestHealthKitPermissions().then(() => {
      syncHealthKitActivity(user.id);
    });
  }, [user?.id]);

  return null;
}
