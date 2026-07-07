"use client";

import { useEffect, useMemo, useState } from "react";

// A one-time celebratory banner shown the first time a user reaches a milestone on the surface
// where it makes sense (a feature "opening up", or a "first X" moment). Per-key baseline logic
// means users who ALREADY passed a milestone before this shipped won't get a retroactive pop.

type CelebrationIcon = "unlock" | "spark";
type CelebrationEntry = { key: string; title: string; sub?: string; unlocked: boolean; icon?: CelebrationIcon };

function initKey(userId: string, key: string) { return `wya_unlock_init_${key}_${userId}`; }
function seenKey(userId: string, key: string) { return `wya_unlock_seen_${key}_${userId}`; }

// Returns the first entry that just became true and hasn't been celebrated yet. Records a
// baseline the first time each key is evaluated so pre-existing milestones stay silent.
export function useUnlockCelebration(
  userId: string | undefined,
  entries: CelebrationEntry[],
): { pending: CelebrationEntry | null; dismiss: () => void } {
  const [pending, setPending] = useState<CelebrationEntry | null>(null);
  const signature = useMemo(
    () => entries.map((e) => `${e.key}:${e.unlocked ? 1 : 0}`).join("|"),
    [entries],
  );

  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    for (const e of entries) {
      let firstEval = false;
      try {
        if (!localStorage.getItem(initKey(userId, e.key))) {
          firstEval = true;
          localStorage.setItem(initKey(userId, e.key), "true");
          if (e.unlocked) localStorage.setItem(seenKey(userId, e.key), "true");
        }
      } catch { /* ignore */ }
      if (firstEval) continue;
      try {
        if (e.unlocked && !localStorage.getItem(seenKey(userId, e.key))) {
          localStorage.setItem(seenKey(userId, e.key), "true"); // fire once
          setPending(e);
          return;
        }
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, signature]);

  return { pending, dismiss: () => setPending(null) };
}

export function UnlockCelebrationBanner({ title, sub, icon = "unlock", onDismiss }: { title: string; sub?: string; icon?: CelebrationIcon; onDismiss: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);
  return (
    <div
      role="status"
      className={`mb-4 flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.07] px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.10)] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${shown ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        {icon === "spark" ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.8 4.9L19 9.6l-4.2 2.9L15.5 18 12 15.2 8.5 18l.7-5.5L5 9.6l5.2-1.7L12 3z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {sub && <p className="text-[12px] leading-snug text-ink/60">{sub}</p>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink/40 transition active:opacity-60"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}
