import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// One-off migration: move legacy base64 meal thumbnails (stored inline in meals.image_url,
// ~74 KB each) out to the meal-thumbnails storage bucket and replace image_url with a short
// public URL. Safe + idempotent: it only touches rows whose image_url still starts with
// "data:", uploads first and only then rewrites the row (base64 is never dropped on failure),
// and once a row is a URL it no longer matches, so re-running just continues where it left off.
//
// Trigger from a browser (repeat until {"done": true}):
//   /api/admin/migrate-thumbnails?secret=<CRON_SECRET>

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Cap work per invocation so we stay well under the 300s limit; the caller re-runs to finish.
const MAX_PER_RUN = 250;
const PAGE = 50;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const auth = req.headers.get("authorization");
  if (secret !== process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = adminClient();

  const { count: remainingBefore } = await supabase
    .from("meals")
    .select("id", { count: "exact", head: true })
    .like("image_url", "data:%");

  let migrated = 0;
  let failed = 0;
  let processed = 0;
  const failures: string[] = [];

  while (processed < MAX_PER_RUN) {
    const { data: rows, error } = await supabase
      .from("meals")
      .select("id, user_id, image_url")
      .like("image_url", "data:%")
      .limit(PAGE);
    if (error) return NextResponse.json({ error: error.message, migrated, failed }, { status: 500 });
    if (!rows || rows.length === 0) break;

    const migratedBefore = migrated;
    for (const row of rows) {
      processed++;
      try {
        const dataUrl: string = row.image_url;
        const base64 = dataUrl.split(",")[1];
        if (!base64) { failed++; failures.push(`${row.id}: not a data url`); continue; }
        const bytes = Buffer.from(base64, "base64");
        const path = `${row.user_id}/${row.id}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("meal-thumbnails")
          .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
        if (upErr) { failed++; failures.push(`${row.id}: upload ${upErr.message}`); continue; }
        const { data: pub } = supabase.storage.from("meal-thumbnails").getPublicUrl(path);
        const { error: updErr } = await supabase
          .from("meals")
          .update({ image_url: pub.publicUrl })
          .eq("id", row.id);
        if (updErr) { failed++; failures.push(`${row.id}: update ${updErr.message}`); continue; }
        migrated++;
      } catch (e: unknown) {
        failed++;
        failures.push(`${row.id}: ${e instanceof Error ? e.message : "error"}`);
      }
    }

    // If a whole page produced no successful migration, stop — the remaining rows are
    // persistently failing (surfaced in `failures`) and would otherwise loop forever.
    if (migrated === migratedBefore) break;
  }

  const remaining = Math.max(0, (remainingBefore ?? 0) - migrated);
  return NextResponse.json({
    migrated,
    failed,
    remaining,
    done: remaining === 0 && failed === 0,
    failures: failures.slice(0, 10),
  });
}
