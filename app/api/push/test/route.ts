import { NextResponse } from "next/server";
import { sendPush } from "../../../../lib/apns";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const ok = await sendPush(token, {
    title: "Coach",
    body: "Test push — if you see this, APNs is working.",
    data: { screen: "summary" },
    badge: 1,
  });

  return NextResponse.json({ ok });
}
