"use client";

import { Capacitor } from "@capacitor/core";

const RC_API_KEY = "test_OlqPyiZnvspixiHkBbnowHYCwBL";

type PurchasesModule = typeof import("@revenuecat/purchases-capacitor");
let _mod: PurchasesModule | null = null;

async function getMod(): Promise<PurchasesModule | null> {
  if (!Capacitor.isNativePlatform()) return null;
  if (!_mod) {
    _mod = await import("@revenuecat/purchases-capacitor");
  }
  return _mod;
}

export async function initializePurchases(userId: string): Promise<void> {
  const mod = await getMod();
  if (!mod) return;
  try {
    await mod.Purchases.configure({ apiKey: RC_API_KEY, appUserID: userId });
  } catch {
    // Already configured — safe to ignore
  }
}

export async function getCustomerInfo() {
  const mod = await getMod();
  if (!mod) return null;
  try {
    const { customerInfo } = await mod.Purchases.getCustomerInfo();
    return customerInfo;
  } catch {
    return null;
  }
}

export async function checkIsPro(): Promise<boolean> {
  const info = await getCustomerInfo();
  if (!info) return false;
  return !!info.entitlements.active["pro"];
}

export async function getOfferings() {
  const mod = await getMod();
  if (!mod) return null;
  try {
    const { current } = await mod.Purchases.getOfferings();
    return current;
  } catch {
    return null;
  }
}

export async function purchasePackage(pkg: import("@revenuecat/purchases-capacitor").PurchasesPackage) {
  const mod = await getMod();
  if (!mod) throw new Error("Purchases not available on this platform");
  const { customerInfo } = await mod.Purchases.purchasePackage({ aPackage: pkg });
  return customerInfo;
}

export async function restorePurchases() {
  const mod = await getMod();
  if (!mod) throw new Error("Purchases not available on this platform");
  const { customerInfo } = await mod.Purchases.restorePurchases();
  return customerInfo;
}
