import { NextResponse } from "next/server";
import { creatorsAdmin } from "../../../../lib/server/creators";
import { sendWelcome, type CreatorRow } from "../../../../lib/server/creatorEmails";

// Called by whatyouate.app/creators/join right after someone joins, with their Supabase session.
// Sends the welcome email once. The daily creators cron sends any this route missed.

const ORIGINS = new Set(["https://whatyouate.app", "https://www.whatyouate.app"]);

function cors(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://whatyouate.app",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    Vary: "Origin",
  };
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req) });
}

export async function POST(req: Request) {
  const headers = cors(req);
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return NextResponse.json({ error: "Missing auth token." }, { status: 401, headers });

  const db = creatorsAdmin();
  const { data: authed, error: authError } = await db.auth.getUser(token);
  if (authError || !authed?.user) return NextResponse.json({ error: "Invalid session." }, { status: 401, headers });

  const { data: creator } = await db
    .from("creators")
    .select("id, name, email, code, country, currency, payout_method, payout_email")
    .eq("user_id", authed.user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!creator) return NextResponse.json({ error: "Not a creator." }, { status: 404, headers });

  const result = await sendWelcome(db, creator as CreatorRow);
  if (result !== "sent" && result !== "skipped") console.log("[creators/welcome]", result);
  return NextResponse.json({ ok: result === "sent" || result === "skipped" }, { headers });
}
