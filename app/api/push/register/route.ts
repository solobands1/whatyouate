import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: Request) {
  try {
    const { userId, token } = await req.json();
    if (!userId || !token) {
      return NextResponse.json({ error: "Missing userId or token" }, { status: 400 });
    }

    const supabase = adminClient();
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
    await supabase.from("push_tokens").delete().match({ user_id: userId, token });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
