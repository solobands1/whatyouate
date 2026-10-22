import { NextResponse } from "next/server";
import { creatorsAdmin, postToDiscord, usdCadOn } from "../../../../lib/server/creators";

// RevenueCat webhook for the creator program. Every payment, renewal and refund for a user who
// joined with a creator code is recorded as earnings; everything else is ignored by the database.
// Set up in RevenueCat > Project > Integrations > Webhooks with the Authorization header
// "Bearer <REVENUECAT_WEBHOOK_SECRET>".

// REFUND_REVERSED arrives with a positive price and restores what the refund took away.
const PAYMENT_EVENTS = new Set(["INITIAL_PURCHASE", "RENEWAL", "NON_RENEWING_PURCHASE", "CANCELLATION", "REFUND_REVERSED"]);

type RcEvent = {
  id?: string;
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  purchased_at_ms?: number;
  expiration_at_ms?: number;
  period_type?: string;
  event_timestamp_ms?: number;
  price?: number | null;
  price_in_purchased_currency?: number | null;
  currency?: string | null;
  tax_percentage?: number | null;
  commission_percentage?: number | null;
  environment?: string;
};

export async function POST(req: Request) {
  const secret = (process.env.REVENUECAT_WEBHOOK_SECRET ?? "").trim();
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const e: RcEvent | undefined = body?.event;
  if (!e?.id || !e.type) return NextResponse.json({ ok: true, result: "no_event" });
  if (e.environment !== "PRODUCTION" && process.env.CREATOR_ALLOW_SANDBOX !== "1") {
    return NextResponse.json({ ok: true, result: "sandbox" });
  }
  const ids = [e.app_user_id, e.original_app_user_id, ...(e.aliases ?? [])].filter((x): x is string => !!x);

  // Free month tracking for the creator dashboard ("In Their Free Month"): a trial starting, renewal
  // being turned off during it (a non-refund cancellation), or turned back on.
  const isRefund = (e.price ?? 0) < 0;
  const trialAction =
    e.type === "INITIAL_PURCHASE" && (e.period_type === "TRIAL" || e.period_type === "INTRO") && !(e.price ?? 0)
      ? "start"
      : e.type === "CANCELLATION" && !isRefund
        ? "cancel"
        : e.type === "UNCANCELLATION"
          ? "uncancel"
          : null;
  if (trialAction) {
    const { data, error } = await creatorsAdmin().rpc("creator_record_trial", {
      p_app_user_ids: ids,
      p_action: trialAction,
      p_trial_ends_at: e.expiration_at_ms ? new Date(e.expiration_at_ms).toISOString() : null,
    });
    if (error) {
      console.log("[creators/revenuecat] trial error", e.id, error.message);
      return NextResponse.json({ error: "record_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, result: data });
  }

  if (!PAYMENT_EVENTS.has(e.type)) return NextResponse.json({ ok: true, result: "ignored_type" });
  const purchasedAt = new Date(e.type === "CANCELLATION" ? e.event_timestamp_ms ?? Date.now() : e.purchased_at_ms ?? e.event_timestamp_ms ?? Date.now());
  const usdCad = (e.currency ?? "").toUpperCase() === "CAD" ? null : await usdCadOn(purchasedAt);

  const { data, error } = await creatorsAdmin().rpc("creator_record_transaction", {
    p_event_id: e.id,
    p_app_user_ids: ids,
    p_purchased_at: purchasedAt.toISOString(),
    p_product_id: e.product_id ?? null,
    p_price_usd: e.price ?? 0,
    p_price_local: e.price_in_purchased_currency ?? null,
    p_currency: e.currency ?? null,
    p_tax_pct: e.tax_percentage ?? null,
    p_store_pct: e.commission_percentage ?? null,
    p_usd_cad: usdCad,
  });

  if (error) {
    console.log("[creators/revenuecat] error", e.id, error.message);
    // Not having an exchange rate yet is temporary: a 500 makes RevenueCat retry later.
    if (error.message.includes("missing_fx_rate")) return NextResponse.json({ error: "fx" }, { status: 500 });
    await postToDiscord(`**Creator program:** couldn't record RevenueCat event ${e.id} (${e.type}): ${error.message}`).catch(() => {});
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }

  console.log("[creators/revenuecat]", e.id, e.type, data);
  return NextResponse.json({ ok: true, result: data });
}
