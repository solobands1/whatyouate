import { NextResponse } from "next/server";
import { creatorsAdmin, csv, postCards, usdCadOn } from "../../../../lib/server/creators";
import { COLORS, section, type Embed } from "../../../../lib/server/discord";
import { sendDueCreatorEmails } from "../../../../lib/server/creatorEmails";

// Daily creator program job (10:00 Toronto time). Marks signups that qualified for the $1 bonus,
// hands out free Pro codes, and posts a Discord summary when there's news (new creators, codes
// running low or expiring). On the 1st of the
// month it also creates that month's payouts and attaches a CSV of every payout so far; on the 5th it
// lists any still unsent. Payouts are marked paid on the owner page (whatyouate.app/creators/owner). Then it emails
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
  const cards: Embed[] = [];
  const OWNER = "https://whatyouate.app/creators/owner";
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
    const rows = joined.map((c) => {
      const socials = [c.instagram && `Instagram @${c.instagram}`, c.tiktok && `TikTok @${c.tiktok}`].filter(Boolean).join("  ·  ");
      return `**${c.name}**  ·  code \`${c.code}\`\n${c.email}  ·  ${c.country}${socials ? `\n${socials}` : ""}\n`;
    });
    cards.push(...section(`🆕 New Creators (${joined.length})`, rows, { color: COLORS.blue, footer: { text: "Say hi, and check the accounts look real." } }));
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
    .map((c) => `**${c!.name}**  ·  code \`${c!.code}\`\n${c!.email}\n`);
  if (yearNames.length) {
    cards.push(...section(`🎉 Earned Their Free Year (${yearNames.length})`, yearNames, {
      color: COLORS.green,
      footer: { text: "3 of their followers have each paid for 2 months or a year. Worth a thank-you." },
    }));
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
    const fields = [
      { name: "3-Month Codes Left", value: String(left["3_months"]), inline: true },
      { name: "1-Year Codes Left", value: String(left["1_year"]), inline: true },
    ];
    if (missing) fields.push({ name: "Creators Waiting", value: String(missing), inline: true });
    if (expiringSoon) fields.push({ name: "Next Expiry", value: String(soonestExpiry), inline: true });
    cards.push({
      title: "🎟️ Free Pro Codes Running Low",
      color: COLORS.amber,
      fields,
      footer: { text: "Generate more in App Store Connect and load them (see supabase/CREATORS.md)." },
    });
  }

  // On the 5th, a nudge for any payout still waiting to be sent: they go out in the first week.
  if (today.endsWith("-05")) {
    const { data: waiting } = await db
      .from("creator_payouts")
      .select("amount, currency, creators(name)")
      .eq("status", "due")
      .lte("due_on", today);
    if (waiting?.length) {
      const rows = waiting.map((w) => {
        const c = Array.isArray(w.creators) ? w.creators[0] : w.creators;
        return `**${c?.name}**  ·  ${Number(w.amount).toFixed(2)} ${w.currency}`;
      });
      cards.push(...section(`⏰ Payouts Still To Send (${waiting.length})`, ["Due by the 7th.\n", ...rows, `\n[Mark them paid on the owner page](${OWNER})`], { color: COLORS.amber, url: OWNER }));
    }
  }

  // Payouts, worked out on the 1st and sent during the first week.
  if (today.endsWith("-01")) {
    const { data: made, error: pErr } = await db.rpc("creator_create_payouts", { p_today: today });
    if (pErr) {
      cards.push({ title: "⚠️ Payouts Not Created", description: `Couldn't create today's payouts.\n\n${pErr.message}`, color: COLORS.red });
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
        const rows = todays.map((r) =>
          `**${r.c?.name}**  ·  **${Number(r.amount).toFixed(2)} ${r.currency}**\n${PAYOUT_LABEL[r.c?.payout_method ?? ""] ?? r.c?.payout_method}  →  ${r.c?.payout_email}\n`
        );
        cards.push(...section(`💸 Payouts Due Today (${todays.length})`, [...rows, `[Open the owner page](${OWNER})`], {
          color: COLORS.green,
          url: OWNER,
          footer: { text: "Send these in the first week, then mark each one paid. That emails the creator their statement. Full CSV attached." },
        }));
      } else if ((made ?? []).length === 0) {
        cards.push({ title: "💸 Payouts", description: "Nothing due today. Balances under $10 roll over.", color: COLORS.grey });
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

  // USD payouts marked paid without their CAD rate saved (the owner page normally saves it): catch up.
  const { data: noRate } = await db.from("creator_payouts").select("id, paid_on").eq("status", "paid").eq("currency", "USD").is("paid_usd_cad", null);
  for (const p of noRate ?? []) {
    const rate = p.paid_on ? await usdCadOn(new Date(`${p.paid_on}T12:00:00Z`)) : null;
    if (rate) await db.from("creator_payouts").update({ paid_usd_cad: rate }).eq("id", p.id);
  }

  // After payouts and Pro codes, so today's new codes go out today.
  const emails = await sendDueCreatorEmails(db, today);
  if (emails.errors.length) {
    cards.push(...section(`⚠️ Creator Emails Didn't Send (${emails.errors.length})`, emails.errors.slice(0, 5).map((e) => `• ${e}`), {
      color: COLORS.red,
      footer: { text: "They'll retry tomorrow." },
    }));
  }

  // Mondays: a short weekly summary, always posted, so a quiet Discord also means the job is running.
  if (new Date(`${today}T12:00:00Z`).getUTCDay() === 1) {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const [{ count: active }, { count: newCreators }, { count: uses }, { count: counted }, { count: paying }, { data: earned }] = await Promise.all([
      db.from("creators").select("id", { count: "exact", head: true }).eq("status", "active"),
      db.from("creators").select("id", { count: "exact", head: true }).gte("joined_at", weekAgo),
      db.from("referrals").select("id", { count: "exact", head: true }).gte("redeemed_at", weekAgo),
      db.from("referrals").select("id", { count: "exact", head: true }).gte("qualified_at", weekAgo),
      db.from("referrals").select("id", { count: "exact", head: true }).gte("first_paid_at", weekAgo),
      db.from("creator_earnings").select("amount, currency").gte("occurred_at", weekAgo),
    ]);
    const byCur: Record<string, number> = {};
    for (const e of earned ?? []) byCur[e.currency] = (byCur[e.currency] ?? 0) + Number(e.amount);
    const money = Object.entries(byCur).map(([c, v]) => `$${v.toFixed(2)} ${c}`).join(" + ") || "$0";
    cards.push({
      title: "📊 Creator Program This Week",
      color: COLORS.blue,
      url: OWNER,
      fields: [
        { name: "Active Creators", value: `${active ?? 0}  (${newCreators ?? 0} new)`, inline: true },
        { name: "Code Uses", value: String(uses ?? 0), inline: true },
        { name: "Signups That Count", value: String(counted ?? 0), inline: true },
        { name: "New Paying Subscribers", value: String(paying ?? 0), inline: true },
        { name: "Earned By Creators", value: money, inline: true },
        { name: "Free Pro Codes Left", value: `${left["3_months"]} three-month  ·  ${left["1_year"]} one-year`, inline: true },
      ],
      footer: { text: "Posted every Monday, so a quiet channel also means the job is running." },
    });
  }
  if (emails.sent.yearSummary) {
    cards.push({ title: "📬 Year Summaries Sent", description: `Sent to ${emails.sent.yearSummary} creator${emails.sent.yearSummary === 1 ? "" : "s"}.`, color: COLORS.green });
  }

  if (cards.length) await postCards(cards, file).catch(() => {});
  console.log("[cron/creators]", { today, qualified, backfilled, joined: joined?.length ?? 0, emails });
  return NextResponse.json({ ok: true, qualified, backfilled, posted: cards.length > 0 });
}
