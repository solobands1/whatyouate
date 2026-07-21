"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { notificationPing } from "../lib/celebrate";

// A one-time celebratory banner shown the first time a user reaches a milestone on the surface
// where it makes sense (a feature "opening up", or a "first X" moment). Per-key baseline logic
// means users who ALREADY passed a milestone before this shipped won't get a retroactive pop.

type CelebrationIcon = "unlock" | "spark" | "flame";
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

export function UnlockCelebrationBanner({ title, sub, icon = "unlock", onDismiss, onClick }: { title: string; sub?: string; icon?: CelebrationIcon; onDismiss: () => void; onClick?: () => void }) {
  // enter → shown → exit. Slides down from the top on show and up off the top on dismiss,
  // like an iOS notification banner. Auto-dismisses after 10s.
  const [state, setState] = useState<"enter" | "shown" | "exit">("enter");
  const close = useCallback(() => {
    setState("exit");
    setTimeout(onDismiss, 340);
  }, [onDismiss]);
  // Play the notification ping once when the banner appears (empty deps so it never
  // repeats even if the caller passes an inline onDismiss that changes identity).
  useEffect(() => { notificationPing(); }, []);
  useEffect(() => {
    const r = requestAnimationFrame(() => setState("shown"));
    const t = setTimeout(close, 10000);
    return () => { cancelAnimationFrame(r); clearTimeout(t); };
  }, [close]);

  // Swipe up to dismiss. Uses native NON-passive touch listeners so touchmove can
  // preventDefault the page scroll behind the banner (React's onTouchMove is passive and
  // can't, and iOS WKWebView ignores touch-action:none here).
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const el = bannerRef.current;
    if (!el) return;
    let startY = 0;
    let dy = 0;
    const onStart = (e: TouchEvent) => { startY = e.touches[0].clientY; dy = 0; setDragging(true); };
    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      dy = Math.min(0, e.touches[0].clientY - startY);
      setDragY(dy);
    };
    const onEnd = () => { setDragging(false); if (dy < -40) closeRef.current(); setDragY(0); };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, []);

  if (typeof document === "undefined") return null;
  const visible = state === "shown";
  return createPortal(
    <div
      data-top-banner
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center px-3"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
    >
      <div
        ref={bannerRef}
        role="status"
        onClick={onClick ? () => { onClick(); close(); } : undefined}
        style={dragging ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
        className={`pointer-events-auto w-full max-w-md touch-none rounded-2xl border border-white/40 bg-white/80 px-4 pt-3 pb-2 shadow-[0_14px_36px_rgba(15,23,42,0.20)] backdrop-blur-xl transition-all duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${onClick ? "cursor-pointer" : ""} ${visible ? "translate-y-0 opacity-100" : "-translate-y-[160%] opacity-0"}`}
      >
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${icon === "flame" ? "bg-[rgba(249,115,22,0.12)]" : "bg-primary/15 text-primary"}`}>
            {icon === "flame" ? (
              <svg width="15" height="17" viewBox="0 0 13 15" aria-hidden="true">
                <defs>
                  <linearGradient id="banner-flame" x1="0" y1="15" x2="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#ea580c" /><stop offset="50%" stopColor="#f97316" /><stop offset="100%" stopColor="#fbbf24" /></linearGradient>
                  <linearGradient id="banner-flame-inner" x1="0" y1="12" x2="0" y2="7.5" gradientUnits="userSpaceOnUse"><stop offset="0%" stopColor="#fde68a" /><stop offset="100%" stopColor="#ffffff" stopOpacity="0.9" /></linearGradient>
                </defs>
                <path d="M6.5 0C6.5 0 4 3.5 4 6C4 6.5 4.1 7 4.3 7.4C3.5 6.6 3.2 5.5 3.2 5.5C1.8 7 1 8.8 1 11C1 13.2 3.5 15 6.5 15C9.5 15 12 13.2 12 11C12 8.2 9.5 5.5 9.5 5.5C9.5 7 8.8 8 8 8.5C8.2 8 8.3 7.4 8.3 6.8C8.3 4.2 6.5 0 6.5 0Z" fill="url(#banner-flame)" />
                <path d="M6.5 7.5C6.2 8.5 6 9.2 6 10C6 11.1 6.2 11.8 6.5 12C6.8 11.8 7 11.1 7 10C7 9.2 6.8 8.5 6.5 7.5Z" fill="url(#banner-flame-inner)" />
              </svg>
            ) : icon === "spark" ? (
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
