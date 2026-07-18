"use client";

import { useEffect, useRef, useState } from "react";

interface WheelOption {
  value: string;
  label: string;
}

const ITEM_H = 44;
const VISIBLE = 5;
const PAD = (ITEM_H * (VISIBLE - 1)) / 2;

/**
 * A bottom-sheet scroll wheel. The trigger shows a placeholder until a value is
 * chosen, but the wheel opens pre-positioned at `defaultValue` so it isn't a long
 * scroll from the top — something a native <select> can't do (it opens on the
 * selected value). Scroll to center a value, tap Done.
 */
export default function WheelPicker({
  value,
  onChange,
  options,
  placeholder,
  title,
  defaultValue,
}: {
  value: string;
  onChange: (v: string) => void;
  options: WheelOption[];
  placeholder: string;
  title: string;
  defaultValue: string;
}) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    const target = value || defaultValue;
    const idx = Math.max(0, options.findIndex((o) => o.value === target));
    requestAnimationFrame(() => { el.scrollTop = idx * ITEM_H; });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = () => {
    const el = listRef.current;
    if (el) {
      const idx = Math.min(options.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)));
      onChange(options[idx].value);
    }
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-xl border border-ink/10 bg-surface px-3 py-3 text-sm text-ink active:opacity-80"
      >
        <span className={selected ? "" : "text-muted/50"}>{selected ? selected.label : placeholder}</span>
        <svg className="h-4 w-4 shrink-0 text-muted/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end" onClick={() => setOpen(false)}>
          <style>{`@keyframes wheel-up { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative w-full rounded-t-2xl bg-white"
            style={{ animation: "wheel-up 0.24s ease-out", paddingBottom: "env(safe-area-inset-bottom)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-ink/5 px-4 py-3">
              <button type="button" className="text-sm text-muted/60 active:opacity-60" onClick={() => setOpen(false)}>Cancel</button>
              <p className="text-sm font-semibold text-ink">{title}</p>
              <button type="button" className="text-sm font-semibold text-primary active:opacity-60" onClick={done}>Done</button>
            </div>
            <div className="relative overflow-hidden" style={{ height: ITEM_H * VISIBLE }}>
              {/* iOS-style center selection band — subtle gray pill behind the numbers */}
              <div className="pointer-events-none absolute inset-x-3 top-1/2 z-0 -translate-y-1/2 rounded-lg bg-ink/[0.06]" style={{ height: ITEM_H }} />
              <div
                ref={listRef}
                className="relative z-10 h-full overflow-y-auto overscroll-contain [scroll-snap-type:y_proximity] [-webkit-overflow-scrolling:touch]"
                style={{ paddingTop: PAD, paddingBottom: PAD }}
              >
                {options.map((o) => (
                  <div
                    key={o.value}
                    className="flex items-center justify-center text-[19px] font-medium text-ink [scroll-snap-align:center]"
                    style={{ height: ITEM_H }}
                  >
                    {o.label}
                  </div>
                ))}
              </div>
              {/* top + bottom fades so numbers dissolve at the edges like the native wheel */}
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-white to-transparent" style={{ height: PAD }} />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-white to-transparent" style={{ height: PAD }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
