import { NextResponse } from "next/server";

const betaUnlockRateMap = new Map<string, { count: number; resetAt: number }>();
function checkBetaRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = betaUnlockRateMap.get(key);
  if (!entry || now >= entry.resetAt) {
    betaUnlockRateMap.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count += 1;
  return true;
}

export async function POST(req: Request) {
  const rateLimitKey = req.headers.get("x-forwarded-for") ?? "anon";
  if (!checkBetaRateLimit(rateLimitKey)) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const { password } = await req.json();
  const secret = process.env.BETA_PASSWORD ?? "";
  if (!secret || password !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
