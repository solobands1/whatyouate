import { NextResponse } from "next/server";
import { creatorsAdmin, csv, postToDiscord } from "../../../../lib/server/creators";
import { sendDueCreatorEmails } from "../../../../lib/server/creatorEmails";

// Daily creator program job (10:00 Toronto time). Marks signups that qualified for the $1 bonus,
// hands out free Pro codes, and posts a Discord summary when there's news (new creators, codes
// running low or expiring). On the 1st of the
// month it also creates that day's payouts and attaches a CSV of every payout so far. Then it emails
// creators anything due: welcomes, new free Pro codes, and payouts marked paid.
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

  // Creators who earned their free year since yesterday.
  const { data: earnedYear } = await db
    .from("creator_pro_codes")
    .select("creators(name, email, code)")
    .eq("kind", "1_year")
    .gte("assigned_at", since);
  const yearNames = (earnedYear ?? [])
    .map((r) => (Array.isArray(r.creators) ? r.creators[0] : r.creators))
    .filter(Boolean)
    .map((c) => `- ${c!.name} (${c!.email}), code **${c!.code}**`);
  if (yearNames.length) {
    lines.push(`**Earned their free year (${yearNames.length})**: 3 of their followers have each paid for 2 months or a year. Worth a thank-you.`);
    lines.push(...yearNames);
  }

  // Free Pro code supply. Codes with under two weeks left aren't handed out, so they don't count.
  const usableAfter = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const { data: pool } = await db.from("creator_pro_codes").select("kind, expires_on").is("creator_id", null);
  const left = { "3_months": 0, "1_year": 0 } as Record<string, number>;
  let soonestExpiry: string | null = null;
  for (const p of pool ?? []) {
    if (p.expires_on && p.expires_on <= usableAfter) continue;
    left[p.kind] = (left[p.kind] ?? 0) + 1;
    if (p.expires_on && (!soonestExpiry || p.expires_on < soonestExpiry)) soonestExpiry = p.expires_on;
  }
  const expiringSoon = soonestExpiry && soonestExpiry <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
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
  if (left["3_months"] < LOW_POOL || left["1_year"] < LOW_POOL || missing > 0 || expiringSoon) {
    lines.push(
      `**Free Pro codes:** ${left["3_months"]} three-month and ${left["1_year"]} one-year codes left` +
        (missing ? `, and ${missing} creator${missing === 1 ? " is" : "s are"} waiting for one` : "") +
        (expiringSoon ? `. Some expire on ${soonestExpiry}` : "") +
        ". Generate more in App Store Connect and load them (see supabase/CREATORS.md)."
    );
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

  // After payouts and Pro codes, so today's new codes go out today.
  const emails = await sendDueCreatorEmails(db);
  if (emails.errors.length) {
    lines.push(`**Creator emails:** ${emails.errors.length} didn't send. They'll retry tomorrow.`);
    lines.push(...emails.errors.slice(0, 5).map((e) => `- ${e}`));
  }

  if (lines.length) await postToDiscord(["**Creator program**", ...lines].join("\n"), file).catch(() => {});
  console.log("[cron/creators]", { today, qualified, backfilled, joined: joined?.length ?? 0, emails });
  return NextResponse.json({ ok: true, qualified, backfilled, posted: lines.length > 0 });
}
