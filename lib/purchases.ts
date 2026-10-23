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

export type ProStatus = "pro" | "free" | "unknown";

// Like checkIsPro, but distinguishes a definitive "not entitled" (RC reachable) from "unknown"
// (RC unreachable — offline, cache miss, or non-native). Callers use "unknown" to avoid
// downgrading a known subscriber on a transient failure, which would trap a paying customer.
export async function checkProStatus(): Promise<ProStatus> {
  const mod = await getMod();
  if (!mod) return "unknown"; // web / non-native: no StoreKit to check
  try {
    const { customerInfo } = await mod.Purchases.getCustomerInfo();
    return customerInfo.entitlements.active["pro"] ? "pro" : "free";
  } catch {
    return "unknown"; // RC unreachable — do NOT treat as "not Pro"
  }
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

// The creator program's plan: same price as the normal monthly, with a 1-month free trial. It is
// only offered to people who joined with a creator code (see lib/referral.ts).
export const CREATOR_OFFERING = "creator";
export const CREATOR_MONTHLY_ID = "com.dillonpoulin.whatyouate.monthly.creator";

/** A specific offering by identifier, or the current one when no id is given. */
export async function getOffering(id?: string) {
  const mod = await getMod();
  if (!mod) throw new Error("NOT_NATIVE");
  const offerings = await mod.Purchases.getOfferings();
  return id ? offerings.all[id] ?? null : offerings.current;
}

/**
 * Whether Apple will give this person the product's free trial. Apple allows one per subscription
 * group, so anyone who already had a trial is ineligible. RevenueCat advises treating "unknown" as
 * not eligible, so nobody is promised a trial they won't get.
 */
export async function isIntroEligible(productId: string): Promise<boolean> {
  const mod = await getMod();
  if (!mod) return false;
  try {
    const result = await mod.Purchases.checkTrialOrIntroductoryPriceEligibility({ productIdentifiers: [productId] });
    return result[productId]?.status === 2; // INTRO_ELIGIBILITY_STATUS_ELIGIBLE
  } catch {
    return false;
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

/**
 * Apple's sheet for redeeming an offer code, such as a creator's free Pro code. iPhone only; the
 * plugin method has been in the app since 1.0.2, so this needed no new build.
 */
export async function presentRedeemSheet(): Promise<boolean> {
  const mod = await getMod();
  if (!mod) return false;
  try {
    await mod.Purchases.presentCodeRedemptionSheet();
    return true;
  } catch {
    return false;
  }
}

export function resetPurchases(): void {
  _initialized = false;
}
