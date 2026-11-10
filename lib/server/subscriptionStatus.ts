// Each user's latest RevenueCat state, kept in user_subscription_status (supabase/owner_usage.sql) for the owner's
// usage page. The app itself still checks RevenueCat live (lib/entitlement.ts); nothing in the app reads this table.
// Fed by the RevenueCat webhook (app/api/creators/revenuecat/route.ts) and, once, by
// scripts/backfill-subscription-status.mjs.

import { creatorsAdmin } from "./creators";

export type SubscriptionStatus = "trial" | "subscribed" | "cancelled_active" | "expired" | "billing_issue";

export type SubscriptionState = {
  status: SubscriptionStatus;
  productId: string | null;
  periodType: string | null;
  expiresAt: string | null;
  willRenew: boolean;
  store: string | null;
  trialStartedAt: string | null;
  firstPaidAt: string | null;
};

/** The webhook event fields this needs (see https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields). */
export type RcStatusEvent = {
  id?: string;
  type?: string;
  product_id?: string;
  period_type?: string;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  event_timestamp_ms?: number;
  price?: number | null;
  store?: string;
  cancel_reason?: string;
};

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The state an event leaves the user in, or null for events that don't change it (TEST, TRANSFER, PRODUCT_CHANGE,
 * which only takes effect at the next renewal, and so on).
 */
export function subscriptionStateFromEvent(e: RcStatusEvent, now = Date.now()): SubscriptionState | null {
  const period = e.period_type ? e.period_type.toUpperCase() : null;
  const paid = (e.price ?? 0) > 0;
  // A free intro offer (the Monthly (Creator) plan's free month) is a trial too, as the creator webhook treats it.
  const isTrial = period === "TRIAL" || (period === "INTRO" && !paid);
  const expires = e.expiration_at_ms ?? null;
  const ranOut = expires != null && expires <= now;

  let status: SubscriptionStatus;
  let willRenew: boolean;
  switch (e.type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "SUBSCRIPTION_EXTENDED":
    case "REFUND_REVERSED":
      status = ranOut ? "expired" : isTrial ? "trial" : "subscribed";
      willRenew = !ranOut;
      break;
    case "NON_RENEWING_PURCHASE":
      status = ranOut ? "expired" : "subscribed";
      willRenew = false;
      break;
    case "CANCELLATION": {
      // A refund (negative price, or Apple support) ends access now; otherwise it runs to the end of the period.
      const refunded = (e.price ?? 0) < 0 || e.cancel_reason === "CUSTOMER_SUPPORT";
      status = refunded || ranOut ? "expired" : "cancelled_active";
      willRenew = false;
      break;
    }
    case "BILLING_ISSUE":
      status = "billing_issue";
      willRenew = true;
      break;
    case "EXPIRATION":
      status = "expired";
      willRenew = false;
      break;
    default:
      return null;
  }

  const startedTrial = e.type === "INITIAL_PURCHASE" && isTrial;
  const madePayment = (e.type === "INITIAL_PURCHASE" || e.type === "RENEWAL" || e.type === "NON_RENEWING_PURCHASE") && !isTrial;
  return {
    status,
    productId: e.product_id ?? null,
    periodType: period,
    expiresAt: iso(expires),
    willRenew,
    store: e.store ?? null,
    trialStartedAt: startedTrial ? iso(e.purchased_at_ms ?? e.event_timestamp_ms) : null,
    firstPaidAt: madePayment ? iso(e.purchased_at_ms ?? e.event_timestamp_ms) : null,
  };
}

/**
 * Saves the state an event leaves the user in. Never throws: this sits in front of the creator program's webhook
 * handling, and a problem here (including owner_usage.sql not being installed yet) must not change that response.
 * Returns what happened, for the log.
 */
export async function recordSubscriptionStatus(e: RcStatusEvent, appUserIds: string[]): Promise<string> {
  try {
    const state = subscriptionStateFromEvent(e);
    if (!state) return "no_status_change";
    // The app logs users in to RevenueCat with their Supabase user id (lib/purchases.ts).
    const userId = appUserIds.find((id) => UUID.test(id));
    if (!userId) return "no_user_id";
    const { data, error } = await creatorsAdmin().rpc("usage_record_subscription", {
      p_user_id: userId,
      p_status: state.status,
      p_product_id: state.productId,
      p_period_type: state.periodType,
      p_expires_at: state.expiresAt,
      p_will_renew: state.willRenew,
      p_store: state.store,
      p_event_type: e.type ?? null,
      p_event_at: iso(e.event_timestamp_ms) ?? new Date().toISOString(),
      p_trial_started_at: state.trialStartedAt,
      p_first_paid_at: state.firstPaidAt,
    });
    if (error) {
      console.log("[revenuecat] subscription status not saved", e.id, error.message);
      return "error";
    }
    return String(data);
  } catch (err) {
    console.log("[revenuecat] subscription status not saved", e.id, err instanceof Error ? err.message : String(err));
    return "error";
  }
}
