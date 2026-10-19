import { NextResponse } from "next/server";
import { creatorsAdmin, csv, postToDiscord } from "../../../../lib/server/creators";

// Daily creator program job (10:00 Toronto time). Marks signups that qualified for the $1 bonus,
// hands out free Pro codes, and posts a Discord summary when there's news. On the 1st of the
// month it also creates that day's payouts and attaches a CSV of every payout so far.
export const maxDuration = 60;

const PAYOUT_LABEL: Record<string, string> = { etransfer: "Interac e-Transfer", paypal: "PayPal", wise: "Wise bank deposit" };
const LOW_POOL = 5;

function torontoToday() {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = creatorsAdmin();
  const today = torontoToday();
  const lines: string[] = [];
  let file: { name: string; text: string } | undefined;

  const { data: qualified, error: qErr } = await db.rpc("creator_mark_qualified");
  if (qErr) console.log("[cron/creators] mark_qualified", qErr.message);

  const { data: backfilled, error: bErr } = await db.rpc("creator_backfill_pro_codes");
  if (bErr) console.log("[cron/creators] backfill", bErr.message);

  // New creators since yesterday's run.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: joined } = await db
    .from("creators")
    .select("name, email, code, instagram, tiktok, country")
    .gte("joined_at", since)
    .order("joined_at");
  if (joined?.length) {
    lines.push(`**New creators (${joined.length})**`);
    for (const c of joined) {
      const socials = [c.instagram && `IG @${c.instagram}`, c.tiktok && `TikTok @${c.tiktok}`].filter(Boolean).join(", ");
      lines.push(`- ${c.name} (${c.email}), code **${c.code}**, ${c.country}${socials ? `, ${socials}` : ""}`);
    }
    lines.push("Say hi, and check the accounts look real.");
  }

  // Free Pro code supply.
  const { data: pool } = await db.from("creator_pro_codes").select("kind").is("creator_id", null);
  const left = { "3_months": 0, "1_year": 0 } as Record<string, number>;
  for (const p of pool ?? []) left[p.kind] = (left[p.kind] ?? 0) + 1;
  const { count: waiting } = await db
    .from("creators")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  const { count: withCode } = await db
    .from("creator_pro_codes")
    .select("code", { count: "exact", head: true })
    .eq("kind", "3_months")
    .not("creator_id", "is", null);
  const missing = Math.max(0, (waiting ?? 0) - (withCode ?? 0));
  if (left["3_months"] < LOW_POOL || left["1_year"] < LOW_POOL || missing > 0) {
    lines.push(
      `**Free Pro codes:** ${left["3_months"]} three-month and ${left["1_year"]} one-year codes left` +
        (missing ? `, and ${missing} creator${missing === 1 ? " is" : "s are"} waiting for one` : "") +
        ". Generate more in App Store Connect and load them (see supabase/CREATORS.md)."
    );
  }

  // 3-month codes that renew in about 10 days, for creators who haven't earned the year.
  const from = new Date(Date.now() - 82 * 86400000).toISOString();
  const { data: due } = await db
    .from("creator_pro_codes")
    .select("code, creator_id, creators(name, email)")
    .eq("kind", "3_months")
    .is("reminded_at", null)
    .lte("assigned_at", from);
  const remind: { code: string; name: string; email: string }[] = [];
  for (const d of due ?? []) {
    const { count } = await db
      .from("creator_pro_codes")
      .select("code", { count: "exact", head: true })
      .eq("creator_id", d.creator_id)
      .eq("kind", "1_year");
    const c = Array.isArray(d.creators) ? d.creators[0] : d.creators;
    if (!count && c) remind.push({ code: d.code, name: c.name, email: c.email });
  }
  if (remind.length) {
    lines.push(`**Free Pro ending soon (${remind.length})**: email them that their 3 months renews in about 10 days unless they cancel in Settings.`);
    for (const r of remind) lines.push(`- ${r.name} (${r.email})`);
    await db.from("creator_pro_codes").update({ reminded_at: new Date().toISOString() }).in("code", remind.map((r) => r.code));
  }

  // Payouts, on the 1st.
  if (today.endsWith("-01")) {
    const { data: made, error: pErr } = await db.rpc("creator_create_payouts", { p_today: today });
    if (pErr) {
      lines.push(`**Payouts:** couldn't create today's payouts: ${pErr.message}`);
    } else {
      const { data: all } = await db
        .from("creator_payouts")
        .select("due_on, amount, currency, status, paid_on, covers_before, creators(name, email, payout_method, payout_email, country)")
        .order("due_on");
      const rows = (all ?? []).map((p) => {
        const c = Array.isArray(p.creators) ? p.creators[0] : p.creators;
        return { ...p, c };
      });
      const todays = rows.filter((r) => r.due_on === today);
      if (todays.length) {
        lines.push(`**Payouts due today (${todays.length})**`);
        for (const r of todays) {
          lines.push(`- ${r.c?.name}: **${Number(r.amount).toFixed(2)} ${r.currency}** by ${PAYOUT_LABEL[r.c?.payout_method ?? ""] ?? r.c?.payout_method} to ${r.c?.payout_email}`);
        }
        lines.push("Once each one is sent, mark it paid (see supabase/CREATORS.md).");
      } else if ((made ?? []).length === 0) {
        lines.push("**Payouts:** nothing due today. Balances under $10 roll over.");
      }
      file = {
        name: `creator-payouts-${today}.csv`,
        text: csv([
          ["Creator", "Account email", "Country", "Method", "Payout email", "Currency", "Amount", "Covers earnings before", "Due", "Status", "Paid on"],
          ...rows.map((r) => [
            r.c?.name, r.c?.email, r.c?.country, PAYOUT_LABEL[r.c?.payout_method ?? ""] ?? r.c?.payout_method, r.c?.payout_email,
            r.currency, Number(r.amount).toFixed(2), r.covers_before, r.due_on, r.status, r.paid_on,
          ]),
        ]),
      };
    }
  }

  if (lines.length) await postToDiscord(["**Creator program**", ...lines].join("\n"), file).catch(() => {});
  console.log("[cron/creators]", { today, qualified, backfilled, joined: joined?.length ?? 0, remind: remind.length });
  return NextResponse.json({ ok: true, qualified, backfilled, posted: lines.length > 0 });
}
