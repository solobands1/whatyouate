"use client";

import { Capacitor } from "@capacitor/core";

const RC_API_KEY = "appl_oXmyrQuxNbyCNOdoVhYoSyNsRez";

type PurchasesModule = typeof import("@revenuecat/purchases-capacitor");
let _mod: PurchasesModule | null = null;
let _initialized = false;

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
  if (_initialized) return;
  _initialized = true;
  try {
    await mod.Purchases.configure({ apiKey: RC_API_KEY, appUserID: userId });
  } catch (e) {
    _initialized = false;
    console.error("[RC] configure error:", e);
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
  if (!mod) throw new Error("NOT_NATIVE");
  try {
    const { current } = await mod.Purchases.getOfferings();
    return current;
  } catch (e) {
    throw e;
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
