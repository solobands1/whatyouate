import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Validate the caller's Supabase session and return their user id, or null if the Bearer token is
// missing/invalid. This route uses the service-role key, so without this gate anyone could register
// or delete push tokens for any user id — here every write is bound to the authenticated user.
async function authedUserId(req: Request, supabase: ReturnType<typeof adminClient>): Promise<string | null> {
  const authHeader = req.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!accessToken) return null;
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user.id;
}

export async function POST(req: Request) {
  try {
    const { userId, token } = await req.json();
    if (!userId || !token) {
      return NextResponse.json({ error: "Missing userId or token" }, { status: 400 });
    }

    const supabase = adminClient();
    const authedId = await authedUserId(req, supabase);
    if (!authedId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (authedId !== userId) return NextResponse.json({ error: "User mismatch" }, { status: 403 });

    const { error } = await supabase.from("push_tokens").upsert(
      { user_id: userId, token, platform: "ios", updated_at: new Date().toISOString() },
      { onConflict: "user_id,token" }
    );

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/register]", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { userId, token } = await req.json();
    if (!userId || !token) {
      return NextResponse.json({ error: "Missing userId or token" }, { status: 400 });
    }

    const supabase = adminClient();
    const authedId = await authedUserId(req, supabase);
    if (!authedId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (authedId !== userId) return NextResponse.json({ error: "User mismatch" }, { status: 403 });

    await supabase.from("push_tokens").delete().match({ user_id: userId, token });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
