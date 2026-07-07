"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A one-time celebratory banner shown the first time a user reaches a milestone on the surface
// where it makes sense (a feature "opening up", or a "first X" moment). Per-key baseline logic
// means users who ALREADY passed a milestone before this shipped won't get a retroactive pop.

type CelebrationIcon = "unlock" | "spark";
type CelebrationEntry = { key: string; title: string; sub?: string; unlocked: boolean; icon?: CelebrationIcon };

// Per-key state in localStorage: absent | "armed" (seen while locked) | "done" (celebrated or
// baselined). A celebration only fires on a locked→unlocked transition we actually witnessed,
// so a key must be "armed" (seen locked) first. First-ever eval while already unlocked is
// treated as pre-existing and baselined to "done" (no retroactive pop).
function celKey(userId: string, key: string) { return `wya_cel_${key}_${userId}`; }

// Returns the first armed entry that just became unlocked and hasn't been celebrated yet.
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
      try {
        const k = celKey(userId, e.key);
        const cur = localStorage.getItem(k);
        if (!cur) {
          // First eval on this surface: arm if locked, baseline if already unlocked.
          localStorage.setItem(k, e.unlocked ? "done" : "armed");
          continue;
        }
        if (cur === "armed" && e.unlocked) {
          localStorage.setItem(k, "done"); // fire once
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
  // enter → shown → exit. Slides down from the top on show and up off the top on dismiss,
  // like an iOS notification banner. Auto-dismisses after 10s.
  const [state, setState] = useState<"enter" | "shown" | "exit">("enter");
  const close = useCallback(() => {
    setState("exit");
    setTimeout(onDismiss, 340);
  }, [onDismiss]);
  useEffect(() => {
    const r = requestAnimationFrame(() => setState("shown"));
    const t = setTimeout(close, 10000);
    return () => { cancelAnimationFrame(r); clearTimeout(t); };
  }, [close]);

  // Swipe up to dismiss: follow the finger upward, and close if flicked past a threshold.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const onTouchStart = (e: React.TouchEvent) => { startYRef.current = e.touches[0].clientY; setDragging(true); };
  const onTouchMove = (e: React.TouchEvent) => { setDragY(Math.min(0, e.touches[0].clientY - startYRef.current)); };
  const onTouchEnd = () => {
    setDragging(false);
    if (dragY < -40) close();
    setDragY(0);
  };

  if (typeof document === "undefined") return null;
  const visible = state === "shown";
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center px-3"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
    >
      <div
        role="status"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={dragging ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
        className={`pointer-events-auto w-full max-w-md rounded-2xl border border-white/40 bg-white/80 px-4 pt-3 pb-2 shadow-[0_14px_36px_rgba(15,23,42,0.20)] backdrop-blur-xl transition-all duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${visible ? "translate-y-0 opacity-100" : "-translate-y-[160%] opacity-0"}`}
      >
        <div className="flex items-center gap-3">
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
        </div>
        {/* Grabber — swipe up to dismiss. */}
        <div className="mx-auto mt-1.5 h-1 w-9 rounded-full bg-ink/15" />
      </div>
    </div>,
    document.body,
  );
}
