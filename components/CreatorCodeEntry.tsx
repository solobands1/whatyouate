"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";
import { useReferral } from "../hooks/useReferral";
import { creatorNameForCode, normalizeCode, redeemCreatorCode } from "../lib/referral";
import { openCreatorOffer } from "./CreatorOfferSheet";

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const REASONS: Record<string, string> = {
  unknown_code: "We couldn't find that code.",
  inactive_code: "That code isn't active anymore.",
  own_code: "You can't use your own code.",
  existing_account: "Creator codes only work in your first 7 days.",
  already_redeemed: "Your account already has a creator code.",
};

/**
 * In Profile's Subscription card: shows the creator code this account joined with, or lets a new
 * account (first 7 days) add one it skipped at signup. Hidden for subscribers.
 */
export default function CreatorCodeEntry({ isPro }: { isPro: boolean }) {
  const { user } = useAuth();
  const referral = useReferral();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!user) return null;
  if (referral) {
    return <p className="mt-3 text-xs text-muted/60">Creator code: <span className="font-semibold text-ink/70">{referral}</span></p>;
  }
  const isNew = Date.now() - new Date(user.created_at).getTime() < WINDOW_MS;
  if (isPro || !isNew) return null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 text-xs font-semibold text-primary transition active:opacity-60">
        Have a creator code?
      </button>
    );
  }

  const apply = async () => {
    if (code.length < 3 || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await redeemCreatorCode(code, user.id);
    if (result.ok) {
      const name = await creatorNameForCode(code).catch(() => null);
      openCreatorOffer({ code, name, atSignup: false });
    } else {
      setMessage(REASONS[result.reason] ?? "Couldn't add that code. Try again in a moment.");
    }
    setBusy(false);
  };

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            placeholder="Creator code"
            className="w-full rounded-xl border border-ink/10 bg-white px-4 py-2.5 pr-16 text-sm font-semibold tracking-[0.06em] text-ink placeholder:font-normal placeholder:tracking-normal placeholder:text-muted/55 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                const text = normalizeCode(await navigator.clipboard.readText());
                if (text) setCode(text);
              } catch {}
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition active:opacity-60"
          >
            Paste
          </button>
        </div>
        <button
          type="button"
          onClick={apply}
          disabled={code.length < 3 || busy}
          className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-white transition active:opacity-80 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {message && <p className="mt-1.5 text-xs text-red-500/80">{message}</p>}
    </div>
  );
}
