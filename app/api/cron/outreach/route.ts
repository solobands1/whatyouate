import { NextResponse } from "next/server";
import { creatorsAdmin, postCards } from "../../../../lib/server/creators";
import { COLORS } from "../../../../lib/server/discord";
import { sendStep, sendOwner, syncReplies, syncJoins, type Contact } from "../../../../lib/server/outreach";

// Creator outreach, every 5 minutes. Syncs replies, bounces and creator sign-ups, then sends at most one email:
// a due follow-up first, otherwise the next approved creator's first email. Sends Mon to Thu, 10:30 to 2:00 in each
// creator's own time zone, at most 12 new and 20 total a day, 4 to 9 minutes apart. Nothing sends unless the owner has
// turned sending on (and not paused) on whatyouate.app/creators/owner/outreach.
// GET ?test=EMAIL (with the cron secret) sends all three emails to EMAIL as one thread, as a preview.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const SEND_DAYS = new Set([1, 2, 3, 4]); // Mon to Thu
const WINDOW: [number, number] = [10.5, 14];
const FIRST_PER_DAY = 12;
const TOTAL_PER_DAY = 20;
const FOLLOW_DAYS = [4, 10];

function localParts(tz: string, d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { wd, hour: Number(p.hour) + Number(p.minute) / 60, date: `${p.year}-${p.month}-${p.day}` };
}

function inWindow(tz: string) {
  const l = localParts(tz);
  return SEND_DAYS.has(l.wd) && l.hour >= WINDOW[0] && l.hour < WINDOW[1];
}

function due(p: Contact, dnc: Set<string>): number | null {
  if (p.decision !== "approve" || dnc.has(p.email)) return null;
  if (!p.sent.length) return p.status === "queued" ? 1 : null;
  if (p.status !== "sent" || p.sent.length >= 3) return null;
  const days = (Date.now() - p.sent[0].ts) / 86400000;
  return days >= FOLLOW_DAYS[p.sent.length - 1] ? p.sent.length + 1 : null;
}

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.ICLOUD_APP_PASSWORD || !process.env.ICLOUD_MAIL_USER) {
    return NextResponse.json({ error: "ICLOUD_MAIL_USER / ICLOUD_APP_PASSWORD not set" }, { status: 500 });
  }
  const url = new URL(req.url);
  const test = url.searchParams.get("test");
  if (test) {
    const c = { first_name: "Alex", email: test.toLowerCase(), currency: "USD" as const,
      hook: "Your morning gut-health reels caught my attention because we align on a lot, especially paying attention to how food makes you feel." };
    const thread: { step: number; id: string; ts: number }[] = [];
    for (const step of [1, 2, 3]) thread.push({ step, id: await sendStep(c, step, thread), ts: Date.now() });
    return NextResponse.json({ ok: true, test: test, sent: 3 });
  }

  const db = creatorsAdmin();
  const { data: settings } = await db.from("outreach_settings").select("*").eq("id", 1).single();
  const { data: rows, error } = await db.from("outreach_contacts").select("*").order("block").order("position");
  if (error || !settings) return NextResponse.json({ error: error?.message || "no settings" }, { status: 500 });
  const people = (rows || []) as Contact[];
  const { data: dncRows } = await db.from("outreach_dnc").select("email");
  const dnc = new Set((dncRows || []).map((r) => r.email as string));
  const log: string[] = [];

  // Sync every 15 minutes, and always right before a send.
  const syncDue = !settings.last_sync || Date.now() - new Date(settings.last_sync).getTime() > 14 * 60000;
  const sync = async () => {
    try {
      log.push(...(await syncReplies(db, people)), ...(await syncJoins(db, people)));
      await db.from("outreach_settings").update({ last_sync: new Date().toISOString() }).eq("id", 1);
      return true;
    } catch (e) {
      log.push("sync error: " + (e as Error).message);
      return false;
    }
  };
  if (syncDue) await sync();
  const news = log.filter((l) => /^(replied|joined|no thanks)/.test(l));
  if (news.length) {
    await postCards([{ title: "✉️ Outreach Update", color: COLORS.blue, description: news.map((n) => "• " + n).join("\n") }]).catch(() => {});
  }

  // Morning preview (8am Toronto, send days) and Friday summary (3pm Toronto) to the owner.
  const tor = localParts("America/Toronto");
  if (settings.live && !settings.paused && SEND_DAYS.has(tor.wd) && tor.hour >= 8 && settings.preview_on !== tor.date) {
    const first = people.filter((p) => due(p, dnc) === 1).slice(0, FIRST_PER_DAY);
    const follow = people.filter((p) => (due(p, dnc) || 0) > 1);
    await sendOwner(`Outreach today: ${first.length} new, ${follow.length} follow-ups`,
      ["Going out from about 10:30 in each creator's time zone. Pause anytime on whatyouate.app/creators/owner/outreach.", "",
        "New:", ...(first.length ? first.map((p) => `  ${p.first_name} (${p.email})`) : ["  none"]), "",
        "Follow-ups:", ...(follow.length ? follow.map((p) => `  email ${due(p, dnc)}: ${p.first_name} (${p.email})`) : ["  none"])].join("\n")).catch((e) => log.push("preview error " + e.message));
    await db.from("outreach_settings").update({ preview_on: tor.date }).eq("id", 1);
  }
  if (settings.live && tor.wd === 5 && tor.hour >= 15 && settings.summary_on !== tor.date) {
    const week = Date.now() - 7 * 86400000;
    const sentW = people.flatMap((p) => p.sent).filter((s) => s.ts > week);
    const n = (s: string) => people.filter((p) => p.status === s).length;
    await sendOwner("Creator outreach: weekly summary",
      `This week: ${sentW.filter((s) => s.step === 1).length} new creators emailed, ${sentW.length} emails in total.\n\n` +
      `All time: ${n("replied")} replied, ${n("joined")} signed up, ${n("opted_out")} said no thanks, ${n("bounced")} bounced, ` +
      `${n("sent")} still in the sequence, ${n("done")} finished with no reply.\n\nwhatyouate.app/creators/owner/outreach`).catch((e) => log.push("summary error " + e.message));
    await db.from("outreach_settings").update({ summary_on: tor.date }).eq("id", 1);
  }

  if (!settings.live || settings.paused) return NextResponse.json({ ok: true, live: settings.live, paused: settings.paused, log });
  if (settings.last_send && Date.now() - new Date(settings.last_send).getTime() < settings.next_gap_s * 1000) return NextResponse.json({ ok: true, waiting: true, log });

  const today = localParts("America/Toronto").date;
  const sentToday = people.flatMap((p) => p.sent).filter((s) => localParts("America/Toronto", new Date(s.ts)).date === today);
  if (sentToday.length >= TOTAL_PER_DAY) return NextResponse.json({ ok: true, cap: "total", log });
  const firstCap = sentToday.filter((s) => s.step === 1).length >= FIRST_PER_DAY;

  let queue = people.map((p) => ({ p, step: due(p, dnc) })).filter((x) => x.step && inWindow(x.p.tz)) as { p: Contact; step: number }[];
  queue.sort((a, b) => b.step - a.step); // follow-ups first so threads stay on schedule
  if (firstCap) queue = queue.filter((x) => x.step > 1);
  if (!queue.length) return NextResponse.json({ ok: true, nothingDue: true, log });

  if (!syncDue && !(await sync())) return NextResponse.json({ ok: false, skipped: "pre-send sync failed", log });
  const next = queue.find((x) => due(x.p, dnc) === x.step);
  if (!next) return NextResponse.json({ ok: true, nothingDue: true, log });

  const { p, step } = next;
  const id = await sendStep(p, step, p.sent);
  const sent = [...p.sent, { step, id, ts: Date.now() }];
  await db.from("outreach_contacts").update({ sent, status: step < 3 ? "sent" : "done", status_at: new Date().toISOString() }).eq("id", p.id);
  await db.from("outreach_settings").update({ last_send: new Date().toISOString(), next_gap_s: (4 + Math.floor(Math.random() * 6)) * 60 }).eq("id", 1);
  log.push(`sent email ${step} to ${p.email}`);
  return NextResponse.json({ ok: true, log });
}
