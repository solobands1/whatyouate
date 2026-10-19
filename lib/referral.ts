"use client";

// Creator codes (whatyouate.app/creators). A code entered at signup only links the new account to
// the creator who shared it; it unlocks nothing by itself. People with a code are offered the
// Monthly (Creator) plan, whose Apple free trial is one month. The rules live in the database
// (supabase/creators.sql).

import { supabase } from "./supabaseClient";

export const REFERRAL_EVENT = "wya_referral_updated";
const cacheKey = (uid: string) => `wya_referral_${uid}`;
const triedKey = (uid: string) => `wya_code_tried_${uid}`;

export function normalizeCode(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15);
}

/** The creator's first name for a working code ("Sarah"), or null if the code doesn't exist. */
export async function creatorNameForCode(code: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("creator_public_name", { p_code: code });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export type RedeemResult =
  | { ok: true; code: string }
  | { ok: false; reason: "already_redeemed" | "unknown_code" | "inactive_code" | "own_code" | "existing_account" | "not_signed_in" | "unavailable"; code?: string };

/** Links the signed-in account to a creator code. Only new accounts count, and only once. */
export async function redeemCreatorCode(code: string, uid: string): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc("redeem_creator_code", { p_code: code });
  if (error) return { ok: false, reason: "unavailable" };
  const result = data as RedeemResult;
  const linked = result.ok ? result.code : result.reason === "already_redeemed" ? result.code : undefined;
  if (linked) {
    try { localStorage.setItem(cacheKey(uid), linked); } catch {}
    window.dispatchEvent(new CustomEvent(REFERRAL_EVENT, { detail: linked }));
  }
  return result;
}

/** The code this account joined with, from the last known value, or null. */
export function cachedReferral(uid: string): string | null {
  try { return localStorage.getItem(cacheKey(uid)); } catch { return null; }
}

/** The code this account joined with, from the database (falls back to the cached value offline). */
export async function fetchReferral(uid: string): Promise<string | null> {
  const { data, error } = await supabase.from("referrals").select("code").eq("user_id", uid).maybeSingle();
  if (error) return cachedReferral(uid);
  const code = (data?.code as string | undefined) ?? null;
  try {
    if (code) localStorage.setItem(cacheKey(uid), code);
    else localStorage.removeItem(cacheKey(uid));
  } catch {}
  return code;
}

/**
 * Redeems a code saved at signup (in the account's metadata) that hasn't been redeemed yet, for
 * example when signup needed an email confirmation first. Runs once per account per device.
 */
export async function redeemPendingCode(uid: string, metadataCode: unknown) {
  const code = typeof metadataCode === "string" ? normalizeCode(metadataCode) : "";
  if (!code) return;
  try { if (localStorage.getItem(triedKey(uid))) return; } catch {}
  const result = await redeemCreatorCode(code, uid);
  if (result.ok || result.reason !== "unavailable") {
    try { localStorage.setItem(triedKey(uid), "1"); } catch {}
  }
}
