// Emails to creators: welcome, first qualified signup (3 months of Pro), free year, and payout sent.
// Sent through Resend from noreply@whatyouate.app, with replies going to support. Each email is
// claimed in creator_emails before it is sent, so a retry or a second cron run never sends it twice.

import type { SupabaseClient } from "@supabase/supabase-js";

const SITE = "https://whatyouate.app";
const FROM = "WhatYouAte Creators <noreply@whatyouate.app>";
const REPLY_TO = "support@whatyouate.app";
// One issued statement on the creator's Statements page (whatyouate-web components/creators/Statement.tsx).
const statementLink = (payoutId: string) => `${SITE}/creators/statements?id=${payoutId}`;
const REDEEM = "https://apps.apple.com/redeem?ctx=offercodes&id=6762287393&code=";

const INK = "#16233B";
const BODY = "#5B6B85";
const MUTED = "#8FA3C0";
const BLUE = "#2F6FC4";

const METHOD: Record<string, string> = {
  etransfer: "Interac e-Transfer",
  paypal: "PayPal",
  wise: "bank deposit through Wise",
};

type Email = { subject: string; html: string; text: string };

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

function money(n: number, currency: string) {
  return `$${n.toFixed(2)} ${currency}`;
}

// ---- Layout (matches supabase/email-magic-link.html) -------------------------------------------
// The AI is placed with padding and margin, not position: Gmail strips position, which left it
// floating above the name. Matches the app header's AI in Gmail and Apple Mail alike.

const p = (html: string, extra = "") =>
  `<p style="margin:0 0 16px 0;font-size:15.5px;line-height:1.6;color:${BODY};${extra}">${html}</p>`;

const codeBox = (code: string, size = 28) =>
  `<div style="margin:6px 0 22px 0;background-color:#EEF5FE;border:1.5px solid #B9D4FA;border-radius:16px;padding:16px 10px;text-align:center;font-size:${size}px;font-weight:700;letter-spacing:${Math.round(size / 6)}px;color:${INK};">${esc(code)}</div>`;

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px 0;"><tr><td style="border-radius:999px;background-color:${INK};">` +
  `<a href="${href}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${label}</a>` +
  `</td></tr></table>`;

// Each row: label, value, and an optional small line under the value (like the website's table).
const rows = (items: ([string, string] | [string, string, string])[]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px 0;border-top:1px solid #EDF1F7;">` +
  items
    .map(
      ([label, value, sub]) =>
        `<tr><td style="padding:11px 0;border-bottom:1px solid #EDF1F7;font-size:14.5px;color:${BODY};">${label}</td>` +
        `<td style="padding:11px 0;border-bottom:1px solid #EDF1F7;font-size:14.5px;font-weight:600;color:${INK};text-align:right;white-space:nowrap;">${value}${sub ? `<br><span style="font-size:12.5px;font-weight:400;color:${BODY};">${sub}</span>` : ""}</td></tr>`
    )
    .join("") +
  `</table>`;

function layout(title: string, body: string) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#F5F8FD;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EEF4FC;background-image:linear-gradient(180deg,#E3EEFC 0%,#F5F8FD 100%);padding:44px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td style="padding-right:10px;vertical-align:middle;">
              <img src="${SITE}/icon-512.png" width="34" height="34" alt="" style="display:block;border-radius:9px;border:0;">
            </td>
            <td style="vertical-align:middle;font-size:19px;font-weight:600;letter-spacing:-0.3px;color:#1F2937;white-space:nowrap;">WhatYouAte<span style="display:inline-block;font-size:6.6px;line-height:1;font-weight:600;color:#1F2937;opacity:0.6;vertical-align:top;padding-top:5px;margin-left:1px;">AI</span></td>
          </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:22px;box-shadow:0 18px 40px -26px rgba(16,42,86,0.30);">
          <tr>
            <td style="padding:34px 34px 30px 34px;text-align:left;">
              <p style="margin:0 0 14px 0;font-size:22px;font-weight:700;letter-spacing:-0.5px;color:${INK};">${title}</p>
              ${body}
              <p style="margin:24px 0 0 0;font-size:13.5px;line-height:1.6;color:${MUTED};">Questions? Just reply to this email.</p>
            </td>
          </tr>
        </table>
        <p style="margin:22px 0 0 0;font-size:12.5px;color:${MUTED};">
          <a href="${SITE}/creators" style="color:${MUTED};text-decoration:none;">whatyouate.app/creators</a>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---- The emails ------------------------------------------------------------------------------

export type CreatorRow = {
  id: string;
  name: string;
  email: string;
  code: string;
  country: string;
  currency: string;
  payout_method: string;
  payout_email: string;
};

const KIT_NOTE =
  "In your dashboard you'll find your numbers, your free Pro and the Creator Kit, with captions, post ideas, videos and a printable card with your code.";

export function welcomeEmail(c: CreatorRow): Email {
  const link = `${SITE}/c/${c.code}`;
  const ca = c.currency === "CAD";
  // Every amount carries the creator's currency: CAD in Canada, USD everywhere else.
  const cur = c.currency;
  const yearly = ca ? "about $38 CAD" : "about $28 USD";
  const monthly = ca ? "about $4.50 CAD" : "about $3.30 USD";
  const payouts = `Payouts go out in the first week of each month by ${METHOD[c.payout_method] ?? c.payout_method}, in ${ca ? "Canadian" : "US"} dollars, once you have $10 ${cur} or more. Your 3 months of free Pro unlock with your first signup.`;
  const html = layout(
    `Welcome To Our Team, ${esc(firstName(c.name))}!`,
    p("Here's your creator code. Anyone who signs up with it gets their first month of WhatYouAte Pro free.") +
      codeBox(c.code) +
      p(`Your link is <a href="${link}" style="color:${BLUE};text-decoration:none;font-weight:600;">whatyouate.app/c/${esc(c.code)}</a>. Put it in your bio, or send it to anyone you think it would help.`) +
      rows([
        ["Each Yearly Subscriber", yearly],
        ["Each Monthly Subscriber", monthly, "a month, up to a year"],
        ["Each Signup In Your First Month", `$1 ${cur}`],
      ]) +
      p(payouts) +
      p(KIT_NOTE, "margin-bottom:20px;") +
      button(`${SITE}/creators/dashboard`, "Open Your Dashboard")
  );
  const text = [
    `Welcome To Our Team, ${firstName(c.name)}!`,
    "",
    "Here's your creator code. Anyone who signs up with it gets their first month of WhatYouAte Pro free.",
    "",
    `Your code: ${c.code}`,
    `Your link: ${link}`,
    "",
    `Each Yearly Subscriber: ${yearly}`,
    `Each Monthly Subscriber: ${monthly} a month, up to a year`,
    `Each Signup In Your First Month: $1 ${cur}`,
    "",
    payouts,
    "",
    KIT_NOTE,
    "",
    `Your dashboard: ${SITE}/creators/dashboard`,
    "",
    "Questions? Just reply to this email.",
  ].join("\n");
  return { subject: "Welcome To The WhatYouAte Creator Program", html, text };
}

export function proEmail(c: CreatorRow, kind: "3_months" | "1_year", code: string): Email {
  const three = kind === "3_months";
  const title = three ? "Your First Signup Counts" : "You Earned A Free Year";
  const lead = three
    ? "Someone who joined with your code has been active in the app on 3 days, so they count as your first signup. That unlocks 3 months of WhatYouAte Pro for you."
    : "Three of your referrals are sticking with it: each has paid for 2 months or a year. Thank you. Here's a year of WhatYouAte Pro, on us.";
  const after = three
    ? "Redeem it within a few weeks. It doesn't renew, so you won't be charged anything when it ends."
    : "Redeem it within a few weeks. It doesn't renew, so you won't be charged anything when it ends. If your 3 free months are still running, redeem this after they end.";
  const html = layout(
    title,
    p(lead) +
      p("Open this email on your iPhone and tap the button. Or redeem it by hand: in the App Store app, tap your profile picture, then Redeem Gift Card or Code.", "margin-bottom:10px;") +
      codeBox(code, 20) +
      button(REDEEM + encodeURIComponent(code), "Redeem On iPhone") +
      p(after, "margin:18px 0 0 0;font-size:14px;")
  );
  const text = [
    title,
    "",
    lead,
    "",
    `Your code: ${code}`,
    `Redeem on your iPhone: ${REDEEM}${encodeURIComponent(code)}`,
    "Or in the App Store app, tap your profile picture, then Redeem Gift Card or Code.",
    "",
    after,
    "",
    "Questions? Just reply to this email.",
  ].join("\n");
  return { subject: three ? "Your First Signup And 3 Months Of Pro" : "You Earned A Free Year Of WhatYouAte Pro", html, text };
}

export type PayoutRow = { id: string; amount: number; currency: string; covers_before: string; reference: string | null };

export function payoutEmail(c: CreatorRow, pay: PayoutRow): Email {
  const amount = money(Number(pay.amount), pay.currency);
  const method = METHOD[c.payout_method] ?? c.payout_method;
  // covers_before is the 1st of a month; the payout covers everything earned before it.
  const through = new Date(new Date(pay.covers_before + "T12:00:00Z").getTime() - 86400000).toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  // Wise is the only method that may need something from the creator.
  const wise = c.payout_method === "wise" ? `Wise emails ${c.payout_email} to collect your bank details, if they don't have them yet.` : "";
  const html = layout(
    "Your Payout Is On Its Way",
    p(`We sent you ${amount} by ${method.replace("-", "&#8209;")}.`) +
      rows([
        ["Covers Earnings Through", through],
        ["Sent To", esc(c.payout_email)],
      ]) +
      (wise ? p(esc(wise)) : "") +
      button(statementLink(pay.id), "See Your Statement")
  );
  const text = [
    "Your Payout Is On Its Way",
    "",
    `We sent you ${amount} by ${method}.`,
    `Covers earnings through ${through}.`,
    `Sent to ${c.payout_email}.`,
    "",
    ...(wise ? [wise, ""] : []),
    `Your statement: ${statementLink(pay.id)}`,
    "",
    "Questions? Just reply to this email.",
  ].join("\n");
  return { subject: `Your WhatYouAte Payout: ${amount}`, html, text };
}

// ---- Sending -----------------------------------------------------------------------------------

export async function sendViaResend(to: string, email: Email, key: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject: email.subject, html: email.html, text: email.text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * Sends one email at most once. `ref` identifies what it's about (the creator for a welcome, the
 * Pro code, the payout). Returns "sent", "skipped" (already sent) or an error message.
 */
export async function sendCreatorEmail(
  db: SupabaseClient,
  creator: CreatorRow,
  kind: "welcome" | "pro_3_months" | "pro_1_year" | "payout",
  ref: string,
  email: Email
): Promise<"sent" | "skipped" | string> {
  if (!process.env.RESEND_API_KEY?.trim()) return "RESEND_API_KEY is not set";
  const { data: claimed, error } = await db
    .from("creator_emails")
    .upsert({ kind, ref, creator_id: creator.id, to_email: creator.email }, { onConflict: "kind,ref", ignoreDuplicates: true })
    .select("kind");
  if (error) return error.message;
  if (!claimed?.length) return "skipped";
  try {
    await sendViaResend(creator.email, email, `${kind}:${ref}`);
    return "sent";
  } catch (e) {
    // Let the next run try again.
    await db.from("creator_emails").delete().eq("kind", kind).eq("ref", ref);
    return e instanceof Error ? e.message : String(e);
  }
}

const CREATOR_COLS = "id, name, email, code, country, currency, payout_method, payout_email";

/** Welcome emails for a creator account that hasn't had one. */
export async function sendWelcome(db: SupabaseClient, creator: CreatorRow) {
  return sendCreatorEmail(db, creator, "welcome", creator.id, welcomeEmail(creator));
}

/**
 * Catches up on every creator email that's due: welcomes the join route missed, newly assigned Pro
 * codes, and payouts marked paid. Only looks back a short way, so nothing old is sent when this
 * first goes live. Returns counts and any errors, for the daily Discord summary.
 */
export async function sendDueCreatorEmails(db: SupabaseClient) {
  const sent = { welcome: 0, pro: 0, payout: 0 };
  const errors: string[] = [];
  const note = (r: string, what: string) => {
    if (r !== "sent" && r !== "skipped") errors.push(`${what}: ${r}`);
    return r === "sent";
  };
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

  const { data: fresh } = await db.from("creators").select(CREATOR_COLS).eq("status", "active").gte("joined_at", daysAgo(3));
  for (const c of (fresh ?? []) as CreatorRow[]) {
    if (note(await sendWelcome(db, c), `welcome ${c.code}`)) sent.welcome++;
  }

  const { data: codes } = await db
    .from("creator_pro_codes")
    .select(`code, kind, creators(${CREATOR_COLS})`)
    .not("creator_id", "is", null)
    .gte("assigned_at", daysAgo(7));
  for (const r of codes ?? []) {
    const c = (Array.isArray(r.creators) ? r.creators[0] : r.creators) as CreatorRow | null;
    if (!c) continue;
    const kind = r.kind as "3_months" | "1_year";
    if (note(await sendCreatorEmail(db, c, `pro_${kind}`, r.code, proEmail(c, kind, r.code)), `pro ${c.code}`)) sent.pro++;
  }

  const { data: paid } = await db
    .from("creator_payouts")
    .select(`id, amount, currency, covers_before, reference, creators(${CREATOR_COLS})`)
    .eq("status", "paid")
    .gte("paid_on", daysAgo(14).slice(0, 10));
  for (const r of paid ?? []) {
    const c = (Array.isArray(r.creators) ? r.creators[0] : r.creators) as CreatorRow | null;
    if (!c) continue;
    if (note(await sendCreatorEmail(db, c, "payout", r.id, payoutEmail(c, r as PayoutRow)), `payout ${c.code}`)) sent.payout++;
  }

  return { sent, errors };
}
