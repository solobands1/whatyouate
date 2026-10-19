// Server-side helpers for the creator program (whatyouate.app/creators). The rules live in the
// database (supabase/creators.sql); these routes only feed it events and report on it.

import { createClient } from "@supabase/supabase-js";

export function creatorsAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Creator reports can go to their own channel; otherwise they share the feedback webhook.
function webhookUrl() {
  return (process.env.CREATOR_DISCORD_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK_URL ?? "").trim();
}

/** Posts to Discord, optionally with a file. Messages over Discord's 2000 characters are cut. */
export async function postToDiscord(content: string, file?: { name: string; text: string }) {
  const url = webhookUrl();
  if (!url) return;
  const body = content.length > 1990 ? content.slice(0, 1980) + "\n…" : content;
  if (!file) {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: body }) });
    return;
  }
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content: body }));
  form.append("files[0]", new Blob([file.text], { type: "text/csv" }), file.name);
  await fetch(url, { method: "POST", body: form });
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
