import { NextResponse } from "next/server";
import { creatorsAdmin } from "../../../../lib/server/creators";
import { siteCors } from "../../../../lib/server/cors";
import { payoutEmail, sendCreatorEmail, type CreatorRow, type PayoutRow } from "../../../../lib/server/creatorEmails";

// Called by the owner page (whatyouate.app/creators/owner) right after a payout is marked paid, so
// the creator's payout email goes out at once. Only owners (creator_owners) can call it. The email
// is sent at most once; the daily creators cron sends any this route missed.

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: siteCors(req) });
}

export async function POST(req: Request) {
  const headers = siteCors(req);
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const { payoutId } = (await req.json().catch(() => ({}))) as { payoutId?: string };
  if (!token || !payoutId) return NextResponse.json({ error: "Missing token or payout." }, { status: 400, headers });

  const db = creatorsAdmin();
  const { data: authed } = await db.auth.getUser(token);
  const email = authed?.user?.email?.toLowerCase();
  const { data: owner } = email ? await db.from("creator_owners").select("email").eq("email", email).maybeSingle() : { data: null };
  if (!owner) return NextResponse.json({ error: "Not allowed." }, { status: 403, headers });

  const { data: pay } = await db
    .from("creator_payouts")
    .select("id, amount, currency, covers_before, reference, status, creators(id, name, email, code, country, currency, payout_method, payout_email)")
    .eq("id", payoutId)
    .maybeSingle();
  if (!pay || pay.status !== "paid") return NextResponse.json({ error: "That payout isn't marked paid." }, { status: 409, headers });
  const c = (Array.isArray(pay.creators) ? pay.creators[0] : pay.creators) as CreatorRow | null;
  if (!c) return NextResponse.json({ error: "No creator." }, { status: 404, headers });

  const result = await sendCreatorEmail(db, c, "payout", pay.id, payoutEmail(c, pay as PayoutRow));
  if (result !== "sent" && result !== "skipped") console.log("[creators/payout-paid]", result);
  return NextResponse.json({ ok: result === "sent" || result === "skipped", result }, { headers });
}
