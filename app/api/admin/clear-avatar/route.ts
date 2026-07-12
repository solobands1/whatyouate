import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// One-off: strip leftover base64 avatar images out of auth user_metadata. A data-URL avatar
// (from the since-reverted photo feature) bloats the JWT to tens of KB, which rides in the
// Authorization header on every request and stalls the parallel data load on slower uplinks.
// Only touches avatar_url values that start with "data:" — real http(s) avatars are left alone.
//
// Trigger from a browser: /api/admin/clear-avatar?secret=<token>

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const TOKEN = "wya_migrate_9f3k2p8x7q1m5v4t6n0b7z";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== TOKEN && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = adminClient();
  const cleared: string[] = [];
  const failures: string[] = [];
  let page = 1;
  const perPage = 200;

  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) return NextResponse.json({ error: error.message, cleared: cleared.length }, { status: 500 });
    const users = data?.users ?? [];
    if (users.length === 0) break;

    for (const u of users) {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      const avatar = meta.avatar_url;
      if (typeof avatar === "string" && avatar.startsWith("data:")) {
        const { error: upErr } = await supabase.auth.admin.updateUserById(u.id, {
          user_metadata: { ...meta, avatar_url: null },
        });
        if (upErr) failures.push(`${u.id.slice(0, 8)}: ${upErr.message}`);
        else cleared.push(u.id.slice(0, 8));
      }
    }

    if (users.length < perPage) break;
    page++;
  }

  return NextResponse.json({ cleared: cleared.length, ids: cleared, failures });
}
