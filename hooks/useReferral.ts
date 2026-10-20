import { useEffect, useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { cachedReferral, fetchReferral, redeemPendingCode, REFERRAL_EVENT } from "../lib/referral";

/** The creator code the signed-in account joined with, or null. */
export function useReferral(): string | null {
  const { user } = useAuth();
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setCode(null);
      return;
    }
    const uid = user.id;
    let live = true;
    setCode(cachedReferral(uid));
    redeemPendingCode(uid, user.user_metadata?.creator_code)
      .catch(() => {})
      .then(() => fetchReferral(uid))
      .then((c) => { if (live) setCode(c); })
      .catch(() => {});
    const onUpdate = (e: Event) => setCode((e as CustomEvent<string>).detail ?? cachedReferral(uid));
    window.addEventListener(REFERRAL_EVENT, onUpdate);
    return () => {
      live = false;
      window.removeEventListener(REFERRAL_EVENT, onUpdate);
    };
  }, [user?.id]);

  return code;
}
