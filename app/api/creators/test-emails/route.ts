import { NextResponse } from "next/server";
import { creatorsAdmin } from "../../../../lib/server/creators";
import { siteCors } from "../../../../lib/server/cors";
import { payoutEmail, proEmail, sendViaResend, welcomeEmail, type CreatorRow } from "../../../../lib/server/creatorEmails";

// Owner-only: sends every creator email, filled in with sample data (or the owner's own creator
// account), to the signed-in owner, so they can be checked in a real inbox. Owners are listed in the
// OWNER_EMAILS env var (comma separated); without it this route is off. Nothing is logged in
// creator_emails, so real emails are unaffected.


export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: siteCors(req) });
}

export async function POST(req: Request) {
  const headers = siteCors(req);
  const owners = (process.env.OWNER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!owners.length) return NextResponse.json({ error: "Test emails are turned off." }, { status: 403, headers });

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const db = creatorsAdmin();
  const { data: authed } = token ? await db.auth.getUser(token) : { data: null };
  const email = authed?.user?.email?.toLowerCase();
  if (!email || !owners.includes(email)) return NextResponse.json({ error: "Not allowed." }, { status: 403, headers });

  const { data: mine } = await db
    .from("creators")
    .select("id, name, email, code, country, currency, payout_method, payout_email")
    .eq("user_id", authed!.user!.id)
    .maybeSingle();
  const c: CreatorRow = (mine as CreatorRow | null) ?? {
    id: "test", name: "Alex Rivera", email, code: "YOURCODE", country: "CA", currency: "CAD",
    payout_method: "etransfer", payout_email: email,
  };
  const firstOfMonth = new Date().toISOString().slice(0, 8) + "01";
  const emails = [
    welcomeEmail(c),
    proEmail(c, "3_months", "SAMPLE3MONTHCODE"),
    proEmail(c, "1_year", "SAMPLEYEARCODE00"),
    payoutEmail(c, { id: "test", amount: 47.91, currency: c.currency, covers_before: firstOfMonth, reference: null }),
  ];

  const stamp = Date.now();
  const results: string[] = [];
  for (const [i, e] of emails.entries()) {
    try {
      await sendViaResend(email, { ...e, subject: `[Test] ${e.subject}` }, `test:${email}:${stamp}:${i}`);
      results.push("sent");
    } catch (err) {
      results.push(err instanceof Error ? err.message : String(err));
    }
  }
  const sent = results.filter((r) => r === "sent").length;
  return NextResponse.json({ ok: sent === emails.length, sent, to: email, errors: results.filter((r) => r !== "sent") }, { headers });
}
