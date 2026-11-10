// Fills user_subscription_status (supabase/owner_usage.sql) from RevenueCat for every app user, for the owner's
// usage page: the "Sync From RevenueCat" button there calls app/api/creators/sync-subscriptions, which runs this.
// The RevenueCat webhook keeps the table up to date as things happen; this catches up on everyone at once (people who
// subscribed before the webhook started saving status, or any event it missed). Safe to rerun.
// The same logic as scripts/backfill-subscription-status.mjs, which runs it from a laptop instead.
//
// With a v1 secret key (REVENUECAT_V1_SECRET_KEY, or REVENUECAT_SECRET_KEY) it asks the v1 subscribers endpoint, the
// same call lib/entitlement.ts makes. With a v2 key it needs REVENUECAT_PROJECT_ID too and reads each customer's
// subscriptions and purchases. Website-only creator accounts are skipped. Sandbox (TestFlight) purchases are ignored.

import { creatorsAdmin } from "./creators";
import type { SubscriptionState } from "./subscriptionStatus";

type Db = ReturnType<typeof creatorsAdmin>;
type V1Sub = {
  is_sandbox?: boolean;
  period_type?: string;
  purchase_date?: string | null;
  expires_date?: string | null;
  refunded_at?: string | null;
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
  grace_period_expires_date?: string | null;
  store?: string | null;
};
type V1Purchase = { is_sandbox?: boolean; purchase_date?: string | null; store?: string | null };
type V1Subscriber = { subscriptions?: Record<string, V1Sub>; non_subscriptions?: Record<string, V1Purchase[]> };
type V2Sub = {
  environment?: string;
  status?: string;
  starts_at?: number;
  current_period_ends_at?: number | null;
  ends_at?: number | null;
  auto_renewal_status?: string;
  gives_access?: boolean;
  product_id?: string;
  store?: string;
  total_revenue_in_usd?: { gross?: number };
};
type V2Purchase = { environment?: string; purchased_at?: number; product_id?: string; store?: string };

export type SyncResult = { checked: number; counts: Record<string, number>; failed: number; error?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : null);
const isoMin = (xs: number[]) => (xs.length ? new Date(Math.min(...xs)).toISOString() : null);

class Fatal extends Error {}

/** Every auth user id that belongs to the app (skips accounts made on the creator website that never opened it). */
async function appUserIds(db: Db) {
  const users: string[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    users.push(...data.users.map((u) => u.id));
    if (data.users.length < 1000) break;
  }
  const ids = async (table: string) => {
    const out = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select("user_id").range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      (data as { user_id: string | null }[]).forEach((r) => r.user_id && out.add(r.user_id));
      if (data.length < 1000) return out;
    }
  };
  const [profiles, creators] = await Promise.all([ids("profiles"), ids("creators")]);
  return users.filter((id) => profiles.has(id) || !creators.has(id));
}

/** The user's state from RevenueCat's v1 subscriber record, matching what the webhook would have saved; null if none. */
export function stateFromSubscriber(sub: V1Subscriber | undefined, now = Date.now()): SubscriptionState | null {
  const subs = Object.entries(sub?.subscriptions ?? {}).filter(([, s]) => !s.is_sandbox).map(([productId, s]) => ({ productId, ...s }));
  const once = Object.entries(sub?.non_subscriptions ?? {}).flatMap(([productId, list]) =>
    (list ?? []).filter((p) => !p.is_sandbox).map((p) => ({ productId, ...p })),
  );
  if (!subs.length && !once.length) return null;

  // v1 only shows each subscription's current period, so the first payment is approximate (the webhook records the
  // real one from now on, and the database keeps the earliest).
  const base = {
    trialStartedAt: isoMin(subs.filter((s) => s.period_type === "trial").map((s) => ms(s.purchase_date)).filter((x): x is number => !!x)),
    firstPaidAt: isoMin(
      [...subs.filter((s) => s.period_type !== "trial").map((s) => ms(s.purchase_date)), ...once.map((p) => ms(p.purchase_date))].filter((x): x is number => !!x),
    ),
  };
  if (!subs.length) {
    const p = once[once.length - 1];
    return { ...base, status: "subscribed", productId: p.productId, periodType: "NORMAL", expiresAt: null, willRenew: false, store: p.store?.toUpperCase() ?? null };
  }
  // The subscription that runs latest (no expiry = lifetime).
  const s = [...subs].sort((a, b) => (ms(b.expires_date) ?? Infinity) - (ms(a.expires_date) ?? Infinity))[0];
  const expires = ms(s.expires_date);
  const over = expires != null && expires <= now;
  const inGrace = !!s.billing_issues_detected_at && (ms(s.grace_period_expires_date) ?? 0) > now;
  const status: SubscriptionState["status"] = s.refunded_at
    ? "expired"
    : over
      ? inGrace ? "billing_issue" : "expired"
      : s.billing_issues_detected_at
        ? "billing_issue"
        : s.unsubscribe_detected_at
          ? "cancelled_active"
          : s.period_type === "trial" ? "trial" : "subscribed";
  return {
    ...base,
    status,
    productId: s.productId,
    periodType: (s.period_type ?? "").toUpperCase() || null,
    expiresAt: expires ? new Date(expires).toISOString() : null,
    willRenew: !s.refunded_at && !s.unsubscribe_detected_at && (!over || inGrace),
    store: s.store ? String(s.store).toUpperCase() : null,
  };
}

/** The same state from API v2's subscription and purchase objects (times in ms). */
export function stateFromV2(items: V2Sub[], purchases: V2Purchase[]): SubscriptionState | null {
  const subs = items.filter((s) => s.environment !== "sandbox");
  const once = purchases.filter((p) => p.environment !== "sandbox");
  if (!subs.length && !once.length) return null;
  const base = {
    trialStartedAt: isoMin(subs.filter((s) => s.status === "trialing").map((s) => s.starts_at).filter((x): x is number => !!x)),
    firstPaidAt: isoMin(
      [...subs.filter((s) => (s.total_revenue_in_usd?.gross ?? 0) > 0).map((s) => s.starts_at), ...once.map((p) => p.purchased_at)].filter((x): x is number => !!x),
    ),
  };
  if (!subs.length) {
    const p = once[once.length - 1];
    return { ...base, status: "subscribed", productId: p.product_id ?? null, periodType: "NORMAL", expiresAt: null, willRenew: false, store: p.store ? String(p.store).toUpperCase() : null };
  }
  const end = (s: V2Sub) => s.current_period_ends_at ?? s.ends_at ?? Infinity;
  const s = [...subs].sort((a, b) => end(b) - end(a))[0];
  const stopping = s.auto_renewal_status === "will_not_renew";
  const status: SubscriptionState["status"] =
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

/** Checks every app user against RevenueCat and saves what it finds. Never throws; problems come back in the result. */
export async function syncSubscriptionStatuses(): Promise<SyncResult> {
  const key = process.env.REVENUECAT_V1_SECRET_KEY || process.env.REVENUECAT_SECRET_KEY;
  const project = process.env.REVENUECAT_PROJECT_ID || "";
  const result: SyncResult = { checked: 0, counts: {}, failed: 0 };
  if (!key) return { ...result, error: "No RevenueCat key on the server." };

  /** A RevenueCat GET, retrying politely on 429 and 5xx. */
  const rc = async (path: string): Promise<{ status: number; body: Record<string, unknown> | null }> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`https://api.revenuecat.com${path}`, { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } });
      if (res.status === 429 || res.status >= 500) {
        await sleep(Number(res.headers.get("retry-after")) * 1000 || 1500 * (attempt + 1));
        continue;
      }
      return { status: res.status, body: await res.json().catch(() => null) };
    }
    throw new Error("RevenueCat kept failing");
  };

  let api: "v1" | "v2" | null = null;
  const lookUp = async (id: string) => {
    const uid = encodeURIComponent(id);
    if (api !== "v2") {
      const r = await rc(`/v1/subscribers/${uid}`);
      if (r.status === 200) {
        api = "v1";
        return stateFromSubscriber((r.body as { subscriber?: V1Subscriber } | null)?.subscriber);
      }
      // 7723: "secret API key incompatible with RevenueCat API V1", i.e. a v2 key.
      if (r.body?.code !== 7723) throw new Error(`RevenueCat ${r.status} ${String(r.body?.message ?? "")}`.trim());
      if (!project) throw new Fatal("The RevenueCat key on the server only works with API v2, and REVENUECAT_PROJECT_ID isn't set.");
      api = "v2";
    }
    const base = `/v2/projects/${encodeURIComponent(project)}/customers/${uid}`;
    const subs = await rc(`${base}/subscriptions?limit=50`);
    if (subs.status === 404) return null; // RevenueCat has never seen this user
    if (subs.status === 401 || subs.status === 403) throw new Fatal(`RevenueCat v2 said ${subs.status}: the key can't read customers.`);
    if (subs.status !== 200) throw new Error(`RevenueCat v2 ${subs.status}`);
    const purchases = await rc(`${base}/purchases?limit=50`);
    return stateFromV2((subs.body?.items as V2Sub[]) ?? [], purchases.status === 200 ? ((purchases.body?.items as V2Purchase[]) ?? []) : []);
  };

  try {
    const db = creatorsAdmin();
    const ids = await appUserIds(db);
    for (const id of ids) {
      try {
        const state = await lookUp(id);
        result.checked++;
        const label = state ? state.status : "none";
        result.counts[label] = (result.counts[label] ?? 0) + 1;
        if (!state) continue;
        const { error } = await db.rpc("usage_record_subscription", {
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
      } catch (e) {
        if (e instanceof Fatal) throw e;
        result.failed++;
        console.log("[sync-subscriptions]", id.slice(0, 8), e instanceof Error ? e.message : String(e));
      }
      await sleep(120);
    }
    return result;
  } catch (e) {
    return { ...result, error: e instanceof Error ? e.message : String(e) };
  }
}
