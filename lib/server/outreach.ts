import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { SupabaseClient } from "@supabase/supabase-js";

// Creator outreach email: the three messages, the signature, and sending/reading through iCloud (contact@whatyouate.app
// is an iCloud+ custom-domain address on the owner's Apple ID). The schedule lives in app/api/cron/outreach.

export const FROM_ADDR = "contact@whatyouate.app";
const FROM = `WhatYouAte <${FROM_ADDR}>`;
export const OWNER_EMAIL = "dillonpoulin.1@gmail.com";
const ICLOUD_USER = () => process.env.ICLOUD_MAIL_USER || "";
const ICLOUD_PASS = () => process.env.ICLOUD_APP_PASSWORD || "";
const FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const APP_STORE = "https://apps.apple.com/app/id6762287393";

export type Sent = { step: number; id: string; ts: number };
export type Contact = {
  id: string; first_name: string; email: string; instagram: string; tiktok: string;
  currency: "USD" | "CAD"; tz: string; hook: string; decision: string; status: string; sent: Sent[]; auto_reply: boolean;
};

const PER_SUB = { USD: "$3.30 USD", CAD: "$4.50 CAD" } as const;
const FOOTER = ['Not interested? Reply "no thanks" and I won\'t email again.', "Integrity Stack Inc., 18 King St E, Suite 1400, Toronto, ON M5C 1C4"];
const TEXT_SIG = "Dillon\nFounder, WhatYouAte\nwhatyouate.app\ncontact@whatyouate.app";

export function subject(c: Pick<Contact, "first_name">) {
  return `${c.first_name} - WhatYouAte`;
}

export function paragraphs(step: number, c: Pick<Contact, "first_name" | "currency" | "hook">): string[] {
  if (step === 1)
    return [
      `Hi ${c.first_name},`,
      "I'm Dillon, founder of WhatYouAte, a food and mood journal. You log what you eat and how your day went, and it shows " +
        "what lines up over time. I made it because I struggle with my own gut health and energy.",
      c.hook,
      "I'd love to have you in our creator program. It's free to join with no set number of posts. You get the full app free " +
        `plus 30% of every subscription you bring in (about ${PER_SUB[c.currency]} a month each), and your followers get their ` +
        "first month free with your code.",
      "Would you be open to giving it a try? Everything's at whatyouate.app/creators.",
      "Thanks,",
    ];
  if (step === 2)
    return [`Hi ${c.first_name}, just bumping this in case it got buried. Want me to send you a free code for the full app so you can try it first?`, "Thanks,"];
  return [
    `Hi ${c.first_name}, last one from me so I don't crowd your inbox. If the creator program is ever a fit, everything's at ` +
      "whatyouate.app/creators. Either way, keep doing what you're doing.",
    "Take care,",
  ];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SIGNATURE_HTML = `
<table cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;border-collapse:collapse;font-family:${FONT};">
  <tr>
    <td style="padding:0 14px 0 0;vertical-align:middle;">
      <img src="https://whatyouate.app/icon-512.png" width="52" height="52" alt="WhatYouAte" style="display:block;width:52px;height:52px;border-radius:12px;border:0;">
    </td>
    <td style="padding:2px 0 2px 14px;vertical-align:middle;border-left:2px solid #DCE8FB;">
      <div style="font-size:15px;line-height:20px;font-weight:600;color:#1F2937;">Dillon</div>
      <div style="font-size:13px;line-height:18px;color:#5A6B85;">Founder, WhatYouAte</div>
      <div style="font-size:13px;line-height:19px;margin-top:3px;">
        <a href="https://whatyouate.app" style="color:#3F7FD6;text-decoration:none;">whatyouate.app</a>
        <span style="color:#B8C4D6;">&nbsp;|&nbsp;</span>
        <a href="mailto:contact@whatyouate.app" style="color:#3F7FD6;text-decoration:none;">contact@whatyouate.app</a>
      </div>
      <div style="font-size:12px;line-height:18px;margin-top:2px;">
        <a href="${APP_STORE}" style="color:#5A6B85;text-decoration:none;">Free on the App Store &rsaquo;</a>
      </div>
    </td>
  </tr>
</table>`.trim();

export function bodyText(step: number, c: Pick<Contact, "first_name" | "currency" | "hook">) {
  return paragraphs(step, c).join("\n\n") + "\n" + TEXT_SIG + "\n\n\n" + FOOTER.join("\n");
}

export function bodyHtml(step: number, c: Pick<Contact, "first_name" | "currency" | "hook">, quoted = "") {
  const ps = paragraphs(step, c)
    .map((p) => esc(p).replace("whatyouate.app/creators", '<a href="https://whatyouate.app/creators" style="color:#3F7FD6;text-decoration:none;">whatyouate.app/creators</a>'))
    .map((p, i, a) => `<p style="margin:0 0 ${i === a.length - 1 ? 0 : 14}px 0;">${p}</p>`)
    .join("");
  return (
    `<div style="font-family:${FONT};font-size:15px;line-height:22px;color:#222222;">${ps}${SIGNATURE_HTML}` +
    `<p style="margin:26px 0 0 0;font-size:11px;line-height:16px;color:#9AA5B5;">${FOOTER.map(esc).join("<br>")}</p>${quoted}</div>`
  );
}

function transport() {
  return nodemailer.createTransport({
    host: "smtp.mail.me.com", port: 587, secure: false, requireTLS: true,
    auth: { user: ICLOUD_USER(), pass: ICLOUD_PASS() },
  });
}

async function imap() {
  const client = new ImapFlow({ host: "imap.mail.me.com", port: 993, secure: true, auth: { user: ICLOUD_USER(), pass: ICLOUD_PASS() }, logger: false });
  await client.connect();
  return client;
}

function msgId() {
  return `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}@whatyouate.app>`;
}

/** Send one email of the sequence (step 1, 2 or 3) and keep a copy in Sent. Returns the Message-ID. */
export async function sendStep(c: Pick<Contact, "first_name" | "email" | "currency" | "hook">, step: number, thread: Sent[]) {
  const id = msgId();
  let text = bodyText(step, c);
  let quoted = "";
  const headers: Record<string, string> = {};
  if (step > 1 && thread.length) {
    headers["In-Reply-To"] = thread[thread.length - 1].id;
    headers["References"] = thread.map((t) => t.id).join(" ");
    const when = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(thread[0].ts));
    text += `\n\nOn ${when}, WhatYouAte <${FROM_ADDR}> wrote:\n` + bodyText(1, c).split("\n").map((l) => (l ? "> " + l : ">")).join("\n");
    // a plain grey block, not a cite blockquote (iPhone Mail colours those purple)
    quoted = `<div style="margin-top:24px;color:#666666;font-size:13px;line-height:19px;">On ${esc(when)}, WhatYouAte &lt;${FROM_ADDR}&gt; wrote:</div>` +
      `<div style="margin:8px 0 0 0;padding-left:12px;border-left:2px solid #DDDDDD;">${bodyHtml(1, c)}</div>`;
  }
  const t = transport();
  const opts = {
    from: FROM, to: c.email, replyTo: FROM_ADDR, messageId: id, headers,
    subject: step === 1 ? subject(c) : "Re: " + subject(c), text, html: bodyHtml(step, c, quoted),
  };
  await t.sendMail(opts);
  try {
    // build the same message as raw bytes and save it to Sent so it shows in Mail like a normal email
    const raw = await new Promise<Buffer>((res, rej) =>
      nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(opts, (e, info) => (e ? rej(e) : res(info.message as Buffer))));
    const box = await imap();
    await box.append("Sent Messages", raw, ["\\Seen"]);
    await box.logout();
  } catch (e) {
    console.log("[outreach] could not save to Sent", (e as Error).message);
  }
  return id;
}

export async function sendOwner(subjectLine: string, text: string) {
  await transport().sendMail({ from: FROM, to: OWNER_EMAIL, subject: subjectLine, text });
}

const AUTO_SUBJ = /^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|ooo\b|away from|on vacation|autoreply)/i;
const NO_THANKS = /\b(no thanks|no thank you|not interested|unsubscribe|remove me|stop emailing|please stop|take me off)\b/i;

/** Read new mail in Inbox and Junk and update statuses: replies, no thanks, bounces. Auto-replies are ignored. */
export async function syncReplies(db: SupabaseClient, people: Contact[]) {
  const sent = people.filter((p) => p.sent.length);
  if (!sent.length) return [];
  const byId = new Map<string, Contact>();
  for (const p of sent) for (const s of p.sent) byId.set(s.id.replace(/[<>]/g, ""), p);
  const byEmail = new Map(sent.map((p) => [p.email, p]));
  const since = new Date(Math.min(...sent.map((p) => p.sent[0].ts)) - 86400000);
  const changes: string[] = [];
  const client = await imap();
  try {
    for (const box of ["INBOX", "Junk"]) {
      const lock = await client.getMailboxLock(box).catch(() => null);
      if (!lock) continue;
      try {
        const uids = (await client.search({ since }, { uid: true })) || [];
        if (!uids.length) continue;
        for await (const m of client.fetch(uids, { source: true }, { uid: true })) {
          if (!m.source) continue;
          const mail = await simpleParser(m.source);
          const from = (mail.from?.value?.[0]?.address || "").toLowerCase();
          const refs = [mail.inReplyTo || "", ...(Array.isArray(mail.references) ? mail.references : [mail.references || ""])].join(" ");
          const textBody = mail.text || "";
          let who: Contact | undefined;
          for (const [mid, p] of byId) if (refs.includes(mid)) { who = p; break; }
          const subj = (mail.subject || "").replace(/^(re|fwd?):\s*/i, "");
          if (/^(mailer-daemon|postmaster)/.test(from) || /delivery status notification|undeliverable|returned mail/i.test(mail.subject || "")) {
            who = who || [...byId.entries()].find(([mid]) => textBody.includes(mid))?.[1] || sent.find((p) => textBody.toLowerCase().includes(p.email));
            if (who && who.status !== "bounced") {
              await db.from("outreach_contacts").update({ status: "bounced", status_at: new Date().toISOString() }).eq("id", who.id);
              who.status = "bounced"; changes.push(`bounced: ${who.email}`);
            }
            continue;
          }
          who = who || byEmail.get(from);
          if (!who) continue;
          const h = mail.headers;
          const auto = (String(h.get("auto-submitted") || "no").toLowerCase() !== "no") || h.has("x-autoreply") || h.has("x-autorespond") ||
            ["auto_reply", "bulk", "junk"].includes(String(h.get("precedence") || "").toLowerCase()) || AUTO_SUBJ.test(subj);
          if (auto) {
            if (!who.auto_reply) { await db.from("outreach_contacts").update({ auto_reply: true }).eq("id", who.id); who.auto_reply = true; }
            continue;
          }
          if (["replied", "opted_out", "joined"].includes(who.status)) continue;
          const own = textBody.split("\n").filter((l) => !l.startsWith(">")).join("\n").slice(0, 600);
          const now = new Date().toISOString();
          if (NO_THANKS.test(own)) {
            await db.from("outreach_contacts").update({ status: "opted_out", status_at: now }).eq("id", who.id);
            await db.from("outreach_dnc").upsert({ email: who.email });
            who.status = "opted_out"; changes.push(`no thanks: ${who.email}`);
          } else {
            await db.from("outreach_contacts").update({ status: "replied", replied_at: now, status_at: now }).eq("id", who.id);
            who.status = "replied"; changes.push(`replied: ${who.email}`);
          }
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return changes;
}

/** Anyone who joined the creator program (by email or Instagram/TikTok handle) gets nothing more. */
export async function syncJoins(db: SupabaseClient, people: Contact[]) {
  const { data } = await db.from("creators").select("email, instagram, tiktok");
  const emails = new Set((data || []).map((r) => String(r.email || "").toLowerCase()));
  const handles = new Set((data || []).flatMap((r) => [r.instagram, r.tiktok]).filter(Boolean).map((h) => String(h).toLowerCase().replace(/^@/, "")));
  const changes: string[] = [];
  for (const p of people) {
    if (p.status === "joined") continue;
    const hit = emails.has(p.email) || (p.instagram && handles.has(p.instagram)) || (p.tiktok && handles.has(p.tiktok));
    if (hit) {
      await db.from("outreach_contacts").update({ status: "joined", status_at: new Date().toISOString() }).eq("id", p.id);
      p.status = "joined"; changes.push(`joined: ${p.email}`);
    }
  }
  return changes;
}
