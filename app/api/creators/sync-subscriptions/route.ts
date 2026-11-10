import { NextResponse } from "next/server";
import { creatorsAdmin } from "../../../../lib/server/creators";
import { siteCors } from "../../../../lib/server/cors";
import { syncSubscriptionStatuses } from "../../../../lib/server/subscriptionSync";

// Called by the owner's usage page (whatyouate.app/creators/owner/usage) when they tap "Sync From RevenueCat": checks
// every app user against RevenueCat and saves who's on a trial or paying (lib/server/subscriptionSync.ts). Runs here
// because the RevenueCat key lives on this server. Only owners (creator_owners) can call it.

export const maxDuration = 120;

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: siteCors(req) });
}

export async function POST(req: Request) {
  const headers = siteCors(req);
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400, headers });

  const db = creatorsAdmin();
  const { data: authed } = await db.auth.getUser(token);
  const email = authed?.user?.email?.toLowerCase();
  const { data: owner } = email ? await db.from("creator_owners").select("email").eq("email", email).maybeSingle() : { data: null };
  if (!owner) return NextResponse.json({ error: "Not allowed." }, { status: 403, headers });

  const result = await syncSubscriptionStatuses();
  console.log("[sync-subscriptions]", JSON.stringify(result));
  return NextResponse.json({ ok: !result.error, ...result }, { status: result.error ? 502 : 200, headers });
}
