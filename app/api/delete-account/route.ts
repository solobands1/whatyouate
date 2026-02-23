import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function POST(req: Request) {
  try {
    const { userId } = (await req.json()) as { userId?: string };
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Server missing Supabase service credentials." },
        { status: 500 }
      );
    }
    if (!userId) {
      return NextResponse.json({ error: "Missing userId." }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: authed, error: authError } = await admin.auth.getUser(token);
    if (authError || !authed?.user) {
      return NextResponse.json({ error: "Invalid session." }, { status: 401 });
    }
    if (authed.user.id !== userId) {
      return NextResponse.json({ error: "User mismatch." }, { status: 403 });
    }

    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Delete failed." }, { status: 500 });
  }
}
