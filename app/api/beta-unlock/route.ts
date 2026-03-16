import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { password } = await req.json();
  const secret = process.env.BETA_PASSWORD ?? "";
  if (!secret || password !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
