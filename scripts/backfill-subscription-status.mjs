// One-off: fills user_subscription_status (supabase/owner_usage.sql) from RevenueCat for every app user, so the owner's
// usage page knows who is on a trial or paying from before the webhook started saving it. After this, the RevenueCat
// webhook keeps it up to date. Safe to rerun.
//
//   node scripts/backfill-subscription-status.mjs --dry-run      # reads only; prints what it would save
//   node scripts/backfill-subscription-status.mjs                # saves
//   options: --limit 10   --user <uuid>   --delay 300 (ms between RevenueCat calls)
//            --profiles-only (only people who finished onboarding)
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and a RevenueCat secret key (read from .env.local if
// not set). With a v1 secret key (REVENUECAT_V1_SECRET_KEY, or REVENUECAT_SECRET_KEY) it asks the v1 subscribers
// endpoint, the same call the crons make (lib/entitlement.ts). With a v2 key it needs REVENUECAT_PROJECT_ID too (the id
// in the RevenueCat dashboard address, like proj1a2b3c4d) and reads each customer's subscriptions and purchases; the v2
// key needs the customer_information read permissions.
// Accounts made on the creator website that never opened the app are skipped. Sandbox (TestFlight) purchases are ignored.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY = flag("--dry-run");
const LIMIT = Number(option("--limit", "0")) || Infinity;
const ONLY = option("--user", null);
const PROFILES_ONLY = flag("--profiles-only");
const DELAY = Math.max(100, Number(option("--delay", "300")) || 300);

// .env.local, without overriding anything already set. Values are never printed.
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
const RC_KEY = process.env.REVENUECAT_V1_SECRET_KEY || process.env.REVENUECAT_SECRET_KEY;
const RC_PROJECT = process.env.REVENUECAT_PROJECT_ID || "";
for (const [k, v] of [["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL], ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY], ["REVENUECAT_SECRET_KEY", RC_KEY]]) {
  if (!v) {
    console.error(`Missing ${k}`);
    process.exit(1);
  }
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ms = (s) => (s ? Date.parse(s) : null);

/** Every auth user id, plus who has app data, so website-only creator accounts can be skipped. */
async function appUserIds() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  const ids = async (table) => {
    const out = new Set();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select("user_id").range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      data.forEach((r) => r.user_id && out.add(r.user_id));
      if (data.length < 1000) return out;
    }
  };
  const [profiles, creators] = await Promise.all([ids("profiles"), ids("creators")]);
  const all = users.map((u) => u.id);
  const keep = all.filter((id) => profiles.has(id) || (!PROFILES_ONLY && !creators.has(id)));
  return { ids: keep, skipped: all.length - keep.length };
}

class Fatal extends Error {}

/** A RevenueCat GET, retrying politely on 429 and 5xx. Returns { status, body }. */
async function rc(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.revenuecat.com${path}`, {
      headers: { Authorization: `Bearer ${RC_KEY}`, "Content-Type": "application/json" },
    });
    if (res.status === 429 || res.status >= 500) {
      await sleep(Number(res.headers.get("retry-after")) * 1000 || 2000 * (attempt + 1));
      continue;
    }
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  throw new Error("RevenueCat kept failing");
}

// Which API the key works with, found on the first call.
let api = null;

/** The user's state in RevenueCat, or null if they've never had a purchase or trial. */
async function lookUp(id) {
  const uid = encodeURIComponent(id);
  if (api !== "v2") {
    const r = await rc(`/v1/subscribers/${uid}`);
    if (r.status === 200) {
      api = "v1";
      return stateFromSubscriber(r.body?.subscriber);
    }
    // 7723: "secret API key incompatible with RevenueCat API V1", i.e. a v2 key.
    if (r.body?.code !== 7723) throw new Error(`RevenueCat ${r.status} ${r.body?.message ?? ""}`.trim());
    if (!RC_PROJECT) {
      throw new Fatal(
        "This RevenueCat key only works with API v2. Either set REVENUECAT_PROJECT_ID (from the RevenueCat dashboard " +
          "address) to use v2, or put a v1 secret key in REVENUECAT_V1_SECRET_KEY. Nothing was saved.",
      );
    }
    api = "v2";
  }
  const base = `/v2/projects/${encodeURIComponent(RC_PROJECT)}/customers/${uid}`;
  const subs = await rc(`${base}/subscriptions?limit=50`);
  if (subs.status === 404) return null; // RevenueCat has never seen this user
  if (subs.status !== 200) {
    const msg = `RevenueCat v2 ${subs.status} ${subs.body?.message ?? ""}`.trim();
    if (subs.status === 401 || subs.status === 403) throw new Fatal(`${msg.replace(/\.+$/, "")}. Nothing more was tried.`);
    throw new Error(msg);
  }
  const purchases = await rc(`${base}/purchases?limit=50`);
  return stateFromV2(subs.body?.items ?? [], purchases.status === 200 ? purchases.body?.items ?? [] : []);
}

/** The same state from API v2's subscription and purchase objects (times in ms). */
export function stateFromV2(items, purchases, now = Date.now()) {
  const subs = items.filter((s) => s.environment !== "sandbox");
  const once = purchases.filter((p) => p.environment !== "sandbox");
  if (!subs.length && !once.length) return null;
  const trials = subs.filter((s) => s.status === "trialing").map((s) => s.starts_at).filter(Boolean);
  // Approximate, as for v1: when a paid subscription started (the webhook records the real first payment from now on).
  const payments = [
    ...subs.filter((s) => (s.total_revenue_in_usd?.gross ?? 0) > 0).map((s) => s.starts_at),
    ...once.map((p) => p.purchased_at),
  ].filter(Boolean);
  const base = {
    trialStartedAt: trials.length ? new Date(Math.min(...trials)).toISOString() : null,
    firstPaidAt: payments.length ? new Date(Math.min(...payments)).toISOString() : null,
  };
  if (!subs.length) {
    const p = once[once.length - 1];
    return { ...base, status: "subscribed", productId: p.product_id ?? null, periodType: "NORMAL", expiresAt: null, willRenew: false, store: p.store ? String(p.store).toUpperCase() : null };
  }
  const end = (s) => s.current_period_ends_at ?? s.ends_at ?? Infinity;
  const s = [...subs].sort((a, b) => end(b) - end(a))[0];
  const stopping = s.auto_renewal_status === "will_not_renew";
  const status =
    s.status === "trialing" ? (stopping ? "cancelled_active" : "trial")
    : s.status === "active" ? (stopping ? "cancelled_active" : "subscribed")
    : s.status === "in_grace_period" || s.status === "in_billing_retry" ? "billing_issue"
    : s.status === "paused" ? "cancelled_active"
    : s.status === "expired" ? "expired"
    : s.gives_access ? "subscribed" : "expired";
  const expires = s.current_period_ends_at ?? s.ends_at ?? null;
  return {
    ...base,
    status,
    productId: s.product_id ?? null,
    periodType: s.status === "trialing" ? "TRIAL" : "NORMAL",
    expiresAt: expires ? new Date(expires).toISOString() : null,
    willRenew: !stopping && status !== "expired",
    store: s.store ? String(s.store).toUpperCase() : null,
  };
}

/** The user's state from RevenueCat's subscriber record, matching what the webhook would have saved; null if none. */
export function stateFromSubscriber(sub, now = Date.now()) {
  const subs = Object.entries(sub?.subscriptions ?? {})
    .filter(([, s]) => !s.is_sandbox)
    .map(([productId, s]) => ({ productId, ...s }));
  const once = Object.entries(sub?.non_subscriptions ?? {}).flatMap(([productId, list]) =>
    (list ?? []).filter((p) => !p.is_sandbox).map((p) => ({ productId, ...p })),
  );
  if (!subs.length && !once.length) return null;

  const trials = subs.filter((s) => s.period_type === "trial").map((s) => ms(s.purchase_date)).filter(Boolean);
  // v1 only shows each subscription's current period, so the first payment is approximate: the start of the current
  // paid period (the webhook records the real one from now on, and the database keeps the earliest).
  const payments = [
    ...subs.filter((s) => s.period_type !== "trial").map((s) => ms(s.purchase_date)),
    ...once.map((p) => ms(p.purchase_date)),
  ].filter(Boolean);
  const base = {
    trialStartedAt: trials.length ? new Date(Math.min(...trials)).toISOString() : null,
    firstPaidAt: payments.length ? new Date(Math.min(...payments)).toISOString() : null,
  };

  if (!subs.length) {
    const p = once[once.length - 1];
    return { ...base, status: "subscribed", productId: p.productId, periodType: "NORMAL", expiresAt: null, willRenew: false, store: p.store?.toUpperCase() ?? null };
  }
  // The subscription that runs latest (no expiry = lifetime).
  const s = [...subs].sort((a, b) => (ms(b.expires_date) ?? Infinity) - (ms(a.expires_date) ?? Infinity))[0];
  const expires = ms(s.expires_date);
  const over = expires != null && expires <= now;
  const inGrace = s.billing_issues_detected_at && ms(s.grace_period_expires_date) > now;
  let status;
  if (s.refunded_at) status = "expired";
  else if (over) status = inGrace ? "billing_issue" : "expired";
  else if (s.billing_issues_detected_at) status = "billing_issue";
  else if (s.unsubscribe_detected_at) status = "cancelled_active";
  else status = s.period_type === "trial" ? "trial" : "subscribed";
  return {
    ...base,
    status,
    productId: s.productId,
    periodType: (s.period_type ?? "").toUpperCase() || null,
    expiresAt: expires ? new Date(expires).toISOString() : null,
    willRenew: !s.refunded_at && !s.unsubscribe_detected_at && (!over || !!inGrace),
    store: s.store ? String(s.store).toUpperCase() : null,
  };
}

async function main() {
  const { ids, skipped } = ONLY ? { ids: [ONLY], skipped: 0 } : await appUserIds();
  const todo = ids.slice(0, LIMIT);
  console.log(`${DRY ? "DRY RUN: nothing will be saved. " : ""}${todo.length} users to check${skipped ? ` (${skipped} skipped: ${PROFILES_ONLY ? "no profile yet, or " : ""}website-only creator accounts)` : ""}.`);
  const counts = {};
  let failed = 0;
  for (const [i, id] of todo.entries()) {
    try {
      const state = await lookUp(id);
      const label = state ? state.status : "none";
      counts[label] = (counts[label] ?? 0) + 1;
      const detail = state ? `${state.status} ${state.productId ?? ""} ${state.periodType ?? ""} until ${state.expiresAt?.slice(0, 10) ?? "-"}` : "no purchases";
      if (state && !DRY) {
        const { data, error } = await db.rpc("usage_record_subscription", {
          p_user_id: id,
          p_status: state.status,
          p_product_id: state.productId,
          p_period_type: state.periodType,
          p_expires_at: state.expiresAt,
          p_will_renew: state.willRenew,
          p_store: state.store,
          p_event_type: "BACKFILL",
          p_event_at: new Date().toISOString(),
          p_trial_started_at: state.trialStartedAt,
          p_first_paid_at: state.firstPaidAt,
        });
        if (error) throw new Error(`save: ${error.message}`);
        console.log(`${i + 1}/${todo.length} ${id.slice(0, 8)} ${detail} -> ${data}`);
      } else {
        console.log(`${i + 1}/${todo.length} ${id.slice(0, 8)} ${detail}${state && DRY ? " (would save)" : ""}`);
      }
    } catch (e) {
      if (e instanceof Fatal) {
        console.error(e.message);
        process.exit(1);
      }
      failed++;
      console.log(`${i + 1}/${todo.length} ${id.slice(0, 8)} FAILED ${e.message}`);
    }
    if (i < todo.length - 1) await sleep(DELAY);
  }
  console.log("Done.", JSON.stringify(counts), failed ? `${failed} failed (rerun to retry).` : "");
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
