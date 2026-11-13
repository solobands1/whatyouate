// Database side of the comeback ladder (lib/comeback.ts has the rules and the words). Everything
// here reads with the service role and checks every { error }: supabase-js never throws.
//
// supabase/comeback.sql adds the comeback_pushes table. Until it's run, comebackLadderReady says
// no and every caller keeps today's pushes exactly.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPush } from "../apns";
import { localDayKeyFromTs } from "../utils";
import type { ReflectionEntry } from "../habitState";
import {
  buildActivity,
  comebackMessage,
  isRealMeal,
  quietState,
  returnedAt,
  COMEBACK_RETURN_WINDOW_MS,
  type Activity,
  type ComebackStage,
  type QuietState,
} from "../comeback";

const MEAL_ROWS = 60;      // newest meal rows read for the quiet clock (supplements are at most one a day)
const FEEL_ROWS = 20;

const tag = (userId: string) => userId.slice(0, 8);

export function dayOfForOffset(offsetMinutes: number | null | undefined): (ms: number) => string {
  return (ms) => localDayKeyFromTs(ms, offsetMinutes ?? 0);
}

// The table and the columns this code uses are there. Checked once per cron run.
export async function comebackLadderReady(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase
    .from("comeback_pushes")
    .select("id, user_id, stage, quiet_since, sent_at, delivered, returned_at")
    .limit(1);
  if (error) {
    console.warn("[comeback] ladder off, keeping the daily pushes (run supabase/comeback.sql?):", error.message);
    return false;
  }
  return true;
}

type MealRow = { created_at?: string | null; status?: string | null; source?: string | null };
const mealOf = (r: MealRow) => ({ createdAt: r.created_at ? Date.parse(r.created_at) : null, status: r.status, source: r.source });

// One person's recent logs, with small selects. Null when a read fails, so the caller keeps
// today's behaviour for them rather than guessing.
export async function loadActivity(
  supabase: SupabaseClient,
  userId: string,
  profile: Record<string, unknown> | null,
): Promise<{ activity: Activity; hasRealMeal: boolean } | null> {
  const [mealsRes, feelRes] = await Promise.all([
    supabase.from("meals").select("created_at, status, analysis_json->>source")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(MEAL_ROWS),
    supabase.from("feel_logs").select("ts")
      .eq("user_id", userId).order("ts", { ascending: false }).limit(FEEL_ROWS),
  ]);
  if (mealsRes.error || feelRes.error) {
    console.error(`[comeback] activity read failed for ${tag(userId)}:`, (mealsRes.error ?? feelRes.error)?.message);
    return null;
  }
  const rows = (mealsRes.data ?? []) as MealRow[];
  const meals = rows.map(mealOf);
  const activity = buildActivity({
    meals,
    feelTs: ((feelRes.data ?? []) as Array<{ ts: unknown }>).map((r) => r.ts),
    reflections: profile?.reflections_json,
    waterLogs: profile?.water_logs_json,
  });
  // A full page of rows with no real meal in it means any real meal is older than all of them,
  // which only happens after weeks of app opens (one supplement row a day), so never in week one.
  const hasRealMeal = meals.some(isRealMeal) || rows.length >= MEAL_ROWS;
  return { activity, hasRealMeal };
}

export function quietFrom(
  loaded: { activity: Activity; hasRealMeal: boolean },
  profile: Record<string, unknown> | null,
  offsetMinutes: number | null | undefined,
  nowMs: number = Date.now(),
): QuietState {
  const created = typeof profile?.created_at === "string" ? Date.parse(profile.created_at) : NaN;
  return quietState({
    activity: loaded.activity,
    hasRealMeal: loaded.hasRealMeal,
    createdAtMs: Number.isFinite(created) ? created : null,
    nowMs,
    dayOf: dayOfForOffset(offsetMinutes),
  });
}

// Real meals and reflected nights, for the day-7 step. Meals are exact counts (everything not
// failed, less supplements), so the number is never capped by the API's row limit. Zero meals if a
// count fails, and the step then says only what it can.
async function lifetimeCounts(supabase: SupabaseClient, userId: string, profile: Record<string, unknown> | null): Promise<{ meals: number; nights: number }> {
  const reflections = Array.isArray(profile?.reflections_json) ? (profile!.reflections_json as Array<{ date?: unknown }>) : [];
  const nights = new Set(reflections.map((r) => r?.date).filter((d) => typeof d === "string")).size;
  const notFailed = () => supabase.from("meals").select("id", { count: "exact", head: true })
    .eq("user_id", userId).or("status.is.null,status.neq.failed");
  const [all, supplements] = await Promise.all([notFailed(), notFailed().eq("analysis_json->>source", "supplement")]);
  if (all.error || supplements.error || all.count == null || supplements.count == null) {
    console.error(`[comeback] meal count failed for ${tag(userId)}:`, (all.error ?? supplements.error)?.message || "no count");
    return { meals: 0, nights };
  }
  return { meals: Math.max(0, all.count - supplements.count), nights };
}

// One comeback push. The row goes in BEFORE anything is sent, and the table allows one row per
// person, quiet stretch and step, so a retried or repeated run can never send the same step twice
// (a duplicate insert fails with 23505 and nothing is sent). delivered is set once a device took it.
export async function sendComebackPush(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    stage: ComebackStage;
    quiet: QuietState;
    profile: Record<string, unknown> | null;
    tokens: Array<{ token: string }>;
    nowMs?: number;
  },
): Promise<number> {
  const { userId, stage, quiet, profile, tokens } = opts;
  if (!quiet.since || !tokens.length) return 0;
  const key = { user_id: userId, quiet_since: quiet.since, stage };
  const { error } = await supabase.from("comeback_pushes").insert({ ...key, sent_at: new Date(opts.nowMs ?? Date.now()).toISOString() });
  if (error) {
    if (error.code === "23505") console.log(`[cron/reminder] comeback step ${stage} already sent to ${tag(userId)}, skipping`);
    else console.error(`[cron/reminder] couldn't record comeback step ${stage} for ${tag(userId)}, not sending:`, error.message);
    return 0;
  }
  const reflections = Array.isArray(profile?.reflections_json) ? (profile!.reflections_json as ReflectionEntry[]) : [];
  const counts = stage === 2 && !quiet.neverActive ? await lifetimeCounts(supabase, userId, profile) : { meals: 0, nights: 0 };
  const msg = comebackMessage(stage, { neverActive: quiet.neverActive, meals: counts.meals, nights: counts.nights, reflections });
  // The title says which wording went out; the body stays out of the logs (it can quote their check-ins).
  console.log(`[cron/reminder] comeback step ${stage} for ${tag(userId)} (quiet day ${quiet.quietDays}): ${msg.title}`);
  let sent = 0;
  for (const t of tokens) {
    const ok = await sendPush(t.token, { title: msg.title, body: msg.body, data: { screen: "home" }, badge: 1 });
    if (ok) sent++;
  }
  if (sent) {
    const { error: markErr } = await supabase.from("comeback_pushes").update({ delivered: true })
      .eq("user_id", userId).eq("quiet_since", quiet.since).eq("stage", stage);
    if (markErr) console.error(`[cron/reminder] couldn't mark comeback step ${stage} delivered for ${tag(userId)}:`, markErr.message);
  }
  return sent;
}

// Marks comeback pushes whose person logged something within 48 hours. Runs every hour; looks a
// couple of hours past the window so one missed run doesn't lose anyone. Returns how many it marked.
export async function markComebackReturns(supabase: SupabaseClient, nowMs: number = Date.now()): Promise<number> {
  const from = new Date(nowMs - COMEBACK_RETURN_WINDOW_MS - 2 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("comeback_pushes")
    .select("id, user_id, stage, quiet_since, sent_at")
    .eq("delivered", true).is("returned_at", null).gte("sent_at", from);
  if (error) {
    console.error("[comeback] return check failed:", error.message);
    return 0;
  }
  type Row = { id: number; user_id: string; stage: number; quiet_since: string; sent_at: string };
  const byUser = new Map<string, Row[]>();
  for (const r of (data ?? []) as Row[]) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  let marked = 0;
  for (const [userId, rows] of byUser) {
    try {
      const { data: profile, error: pErr } = await supabase.from("profiles")
        .select("timezone_offset_minutes, reflections_json, water_logs_json").eq("user_id", userId).maybeSingle();
      if (pErr) {
        console.error(`[comeback] return check profile read failed for ${tag(userId)}:`, pErr.message);
        continue;
      }
      const loaded = await loadActivity(supabase, userId, profile as Record<string, unknown> | null);
      if (!loaded) continue;
      const dayOf = dayOfForOffset((profile as Record<string, unknown> | null)?.timezone_offset_minutes as number | null | undefined);
      for (const row of rows) {
        const sentMs = Date.parse(row.sent_at);
        const at = returnedAt(loaded.activity, sentMs, row.quiet_since, nowMs, dayOf);
        if (at == null || at - sentMs > COMEBACK_RETURN_WINDOW_MS) continue;
        const { error: uErr } = await supabase.from("comeback_pushes")
          .update({ returned_at: new Date(at).toISOString() }).eq("id", row.id).is("returned_at", null);
        if (uErr) console.error(`[comeback] couldn't mark return for ${tag(userId)}:`, uErr.message);
        else { marked++; console.log(`[comeback] ${tag(userId)} came back within 48h of step ${row.stage}`); }
      }
    } catch (err) {
      console.error(`[comeback] return check error for ${tag(userId)}:`, err);
    }
  }
  return marked;
}
