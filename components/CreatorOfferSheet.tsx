"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import CreatorOffer from "./CreatorOffer";

const CREATOR_OFFER_EVENT = "wya_show_creator_offer";

type Offer = { code: string; name: string | null };

/** Shows the creator free month offer, from anywhere (used right after signing up with a code). */
export function openCreatorOffer(offer: Offer) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<Offer>(CREATOR_OFFER_EVENT, { detail: offer }));
  }
}

// Mounted beside the app rather than inside the signup screen: the app swaps to its loading splash
// the moment a new account exists, which would unmount anything shown there. It sits above every
// other layer, including onboarding.
export default function CreatorOfferSheet() {
  const { user } = useAuth();
  const [offer, setOffer] = useState<Offer | null>(null);

  useEffect(() => {
    const handler = (e: Event) => setOffer((e as CustomEvent<Offer>).detail);
    window.addEventListener(CREATOR_OFFER_EVENT, handler);
    return () => window.removeEventListener(CREATOR_OFFER_EVENT, handler);
  }, []);

  if (!offer || !user) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 px-5">
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white px-6 py-7 shadow-xl">
        <CreatorOffer userId={user.id} code={offer.code} name={offer.name} onDone={() => setOffer(null)} />
      </div>
    </div>
  );
}
