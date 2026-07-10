// Server-side Pro entitlement check (RevenueCat) plus the always-unlimited
// allowlist, shared by the cron routes so the logic lives in exactly one place.
// (Previously copy-pasted into each cron, and the reminder cron was missing the
// allowlist entirely — this consolidation fixes that.)

export const UNLIMITED_USER_IDS = new Set<string>([
  "4ef35614-32ec-4a17-b410-f4c31437c1bc", // Dillon
  "b2d6d7a6-a147-4dfb-9750-375d070cccbf", // Andrea
  "973c0886-cd6f-4813-8a3c-4ded80bfa09c", // Apple review demo
]);

// True if the user has an active paid "pro" entitlement in RevenueCat (or is on
// the allowlist). Note this is the PAID check only — free-trial eligibility is a
// separate, meal-derived check (see isTrialEligible in ./trial). Callers OR the two.
export async function checkProEntitlement(userId: string): Promise<boolean> {
  if (UNLIMITED_USER_IDS.has(userId)) return true;
  try {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.REVENUECAT_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    if (!res.ok) return false;
    const data = await res.json();
    const entitlement = data.subscriber?.entitlements?.pro;
    if (!entitlement) return false;
    const expires = entitlement.expires_date;
    if (!expires) return true;
    return new Date(expires) > new Date();
  } catch {
    return false;
  }
}
