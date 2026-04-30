import { NextResponse } from "next/server";
import { sendPush, getLastError } from "../../../../lib/apns";

export async function POST(req: Request) {
  const { token, secret } = await req.json();
  if (secret !== "wya-push-test-2026") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const ok = await sendPush(token, {
    title: "Coach",
    body: "Test push — if you see this, APNs is working.",
    data: { screen: "summary" },
    badge: 1,
  });

  const rawKey = (process.env.APNS_KEY ?? "").replace(/\\n/g, "\n").trim();
  return NextResponse.json({
    ok,
    lastError: getLastError(),
    keyId: process.env.APNS_KEY_ID,
    teamId: process.env.APNS_TEAM_ID,
    sandbox: process.env.APNS_SANDBOX,
    keyLen: rawKey.length,
    keyStart: rawKey.slice(0, 40),
    keyEnd: rawKey.slice(-30),
  });
}
