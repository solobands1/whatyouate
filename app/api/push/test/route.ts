import { NextResponse } from "next/server";
import { sendPush } from "../../../../lib/apns";

export async function POST(req: Request) {
  const { token, secret } = await req.json();
  if (!process.env.WYA_TEST_SECRET || secret !== process.env.WYA_TEST_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const ok = await sendPush(token, {
    title: "Coach",
    body: "Test push — if you see this, APNs is working.",
    data: { screen: "summary" },
    badge: 1,
  });

  return NextResponse.json({ ok });
}
