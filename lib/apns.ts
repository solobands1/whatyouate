import http2 from "node:http2";
import { SignJWT, importPKCS8 } from "jose";

interface CachedJwt {
  token: string;
  issuedAt: number;
}

let cachedJwt: CachedJwt | null = null;
let lastError: string | null = null;
export function getLastError() { return lastError; }

async function getJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.issuedAt < 45 * 60) {
    return cachedJwt.token;
  }
  const rawKey = (process.env.APNS_KEY ?? "").replace(/\\n/g, "\n").trim();
  console.log("[APNs] keyId:", process.env.APNS_KEY_ID, "teamId:", process.env.APNS_TEAM_ID, "keyLen:", rawKey.length, "keyStart:", rawKey.slice(0, 27));
  const privateKey = await importPKCS8(rawKey, "ES256");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: process.env.APNS_KEY_ID!.trim() })
    .setIssuer(process.env.APNS_TEAM_ID!.trim())
    .setIssuedAt()
    .sign(privateKey);
  cachedJwt = { token, issuedAt: now };
  return token;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
}

export async function sendPush(deviceToken: string, payload: PushPayload): Promise<boolean> {
  let jwt: string;
  try {
    jwt = await getJwt();
  } catch (err: unknown) {
    lastError = `jwt: ${err instanceof Error ? err.message : String(err)}`;
    console.error("[APNs] JWT error:", lastError);
    return false;
  }
  const apnsBody = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      badge: payload.badge ?? 1,
    },
    ...(payload.data ?? {}),
  });

  const host =
    process.env.APNS_SANDBOX === "true"
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";

  return new Promise<boolean>((resolve) => {
    const client = http2.connect(host);
    client.on("error", (err) => { lastError = `connection: ${err.message}`; console.error("[APNs] connection error:", err.message); resolve(false); });

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": process.env.APNS_BUNDLE_ID!,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
      "content-length": Buffer.byteLength(apnsBody),
    });

    let status = 0;
    let responseBody = "";

    req.on("response", (headers) => {
      status = headers[":status"] as number;
    });
    req.on("data", (chunk) => { responseBody += chunk; });
    req.on("end", () => {
      client.close();
      if (status !== 200) {
        lastError = `status=${status} ${responseBody}`;
        console.error(`[APNs] status=${status}`, responseBody);
      }
      resolve(status === 200);
    });
    req.on("error", (err) => {
      lastError = `request: ${err.message}`;
      console.error("[APNs] request error:", err.message);
      client.close();
      resolve(false);
    });

    req.write(apnsBody);
    req.end();
  });
}
