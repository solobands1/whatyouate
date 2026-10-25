// Server-side helpers for the creator program (whatyouate.app/creators). The rules live in the
// database (supabase/creators.sql); these routes only feed it events and report on it.

import { createClient } from "@supabase/supabase-js";
import { COLORS, sendEmbeds, type Embed } from "./discord";

export function creatorsAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Creator reports can go to their own channel; otherwise they share the feedback webhook.
function webhookUrl() {
  return (process.env.CREATOR_DISCORD_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK_URL ?? "").trim();
}

/** Posts report cards (Discord embeds) to the creator channel, optionally with a CSV on the first message. */
export async function postCards(embeds: Embed[], file?: { name: string; text: string }) {
  const url = webhookUrl();
  if (!url || !embeds.length) return;
  await sendEmbeds(url, embeds.map((e) => ({ ...e, timestamp: e.timestamp ?? new Date().toISOString() })), { file });
}

/** A single alert card, for one-off problems (red by default). */
export async function postAlert(title: string, text: string, color = COLORS.red) {
  await postCards([{ title, description: text, color }]);
}

const rateCache = new Map<string, number | null>();

/**
 * Canadian dollars per US dollar on a given day, from the Bank of Canada. Weekends and holidays
 * use the most recent earlier rate. Returns null if the rate can't be fetched.
 */
export async function usdCadOn(day: Date): Promise<number | null> {
  const key = day.toISOString().slice(0, 10);
  if (rateCache.has(key)) return rateCache.get(key)!;
  const start = new Date(day.getTime() - 10 * 86400000).toISOString().slice(0, 10);
  try {
    const res = await fetch(`https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=${start}&end_date=${key}`);
    if (!res.ok) return null;
    const data = await res.json();
    const obs: { FXUSDCAD?: { v?: string } }[] = data?.observations ?? [];
    const v = Number(obs[obs.length - 1]?.FXUSDCAD?.v);
    const rate = Number.isFinite(v) && v > 0 ? v : null;
    rateCache.set(key, rate);
    return rate;
  } catch {
    return null;
  }
}

export function csv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}
