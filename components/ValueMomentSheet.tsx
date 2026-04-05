"use client";

import { useEffect, useState } from "react";
import { openUpgradeModal } from "./UpgradeModal";

export const VALUE_MOMENT_EVENT = "wya_value_moment";
const SESSION_KEY = "wya_value_moment_seen";

interface ValueMomentPayload {
  mealCount: number;
  dayCount: number;
}

export function triggerValueMoment(payload: ValueMomentPayload) {
  if (typeof window === "undefined") return;
  if (sessionStorage.getItem(SESSION_KEY)) return;
  window.dispatchEvent(new CustomEvent(VALUE_MOMENT_EVENT, { detail: payload }));
}

export default function ValueMomentSheet() {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<ValueMomentPayload | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ValueMomentPayload>).detail;
      setPayload(detail);
      setOpen(true);
      sessionStorage.setItem(SESSION_KEY, "1");
    };
    window.addEventListener(VALUE_MOMENT_EVENT, handler);
    return () => window.removeEventListener(VALUE_MOMENT_EVENT, handler);
  }, []);

  if (!open || !payload) return null;

  const close = () => setOpen(false);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
        onClick={close}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md rounded-t-3xl bg-surface px-6 pb-10 pt-6 shadow-xl" style={{ left: "50%", transform: "translateX(-50%)", width: "100%" }}>
        {/* Handle */}
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-ink/15" />

        {/* Icon row */}
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
            <svg viewBox="0 0 20 20" className="h-5 w-5 text-primary" fill="currentColor">
              <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm.75 4.75a.75.75 0 00-1.5 0v3.5l-2 1.15a.75.75 0 00.75 1.3l2.38-1.37a.75.75 0 00.37-.65V6.75z" />
            </svg>
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted/50">
            Your patterns are ready
          </p>
        </div>

        <p className="text-base font-semibold text-ink">
          {payload.dayCount} days of data. {payload.mealCount} meals tracked.
        </p>
        <p className="mt-2 text-sm text-muted/70 leading-relaxed">
          We have spotted patterns in your micronutrients and weekly intake. Unlock Patterns to see where you are doing well and where there might be gaps.
        </p>

        <div className="mt-6 space-y-2.5">
          <button
            type="button"
            onClick={() => { close(); openUpgradeModal(); }}
            className="w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white transition active:opacity-80"
          >
            Unlock insights
          </button>
          <button
            type="button"
            onClick={close}
            className="w-full rounded-xl px-5 py-3 text-sm text-muted/60 transition active:opacity-60"
          >
            Maybe later
          </button>
        </div>
      </div>
    </>
  );
}
