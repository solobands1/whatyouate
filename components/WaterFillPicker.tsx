"use client";

import { useRef, useState } from "react";

const ML_PER_OZ = 29.5735;

// Snap a raw millilitre value to a clean increment in whichever unit is on screen — 100 ml,
// or 8 oz (a large glass) — so the readout is always a round, approximate number.
function snapMl(rawMl: number, unit: "ml" | "oz"): number {
  if (unit === "oz") {
    const oz = Math.round(rawMl / ML_PER_OZ / 8) * 8;
    return Math.round(oz * ML_PER_OZ);
  }
  return Math.round(rawMl / 100) * 100;
}

// A drag-to-fill water estimate. Full bar = 2x the daily goal, with the goal marked at the
// midpoint for reference; drag past it for a big day. Approximate by design.
export default function WaterFillPicker({
  goalMl,
  initialUnit,
  onSubmit,
  onSkip,
}: {
  goalMl: number;
  initialUnit: "ml" | "oz";
  onSubmit: (ml: number) => void;
  onSkip: () => void;
}) {
  const maxMl = Math.max(goalMl * 2, 1000);
  const [unit, setUnit] = useState<"ml" | "oz">(initialUnit);
  const [valueMl, setValueMl] = useState(() => snapMl(goalMl, initialUnit)); // start at the goal
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const frac = Math.max(0, Math.min(1, valueMl / maxMl));
  const display = unit === "oz" ? Math.round(valueMl / ML_PER_OZ) : valueMl;

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setValueMl(snapMl(f * maxMl, unit));
  };

  const switchUnit = (next: "ml" | "oz") => {
    if (next === unit) return;
    setUnit(next);
    setValueMl((v) => snapMl(v, next)); // re-snap to the new grid so the number stays clean
  };

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Yesterday&apos;s Water</h2>
          <p className="mt-0.5 text-[12.5px] text-ink/55">Drag to about how much you drank.</p>
        </div>
        <div className="flex shrink-0 rounded-full bg-ink/[0.06] p-0.5 text-[11px] font-semibold">
          {(["ml", "oz"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => switchUnit(u)}
              className={`rounded-full px-2.5 py-1 transition ${unit === u ? "bg-white text-primary shadow-sm" : "text-ink/45"}`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {/* Live readout */}
      <div className="mt-6 flex items-end justify-center gap-2">
        <svg width="26" height="30" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="mb-1 shrink-0">
          <defs>
            <linearGradient id="wfp-drop" x1="0.35" y1="0" x2="0.65" y2="1">
              <stop offset="0%" stopColor="#BAD8FF" /><stop offset="45%" stopColor="#93C5FD" /><stop offset="100%" stopColor="#6FA8FF" />
            </linearGradient>
          </defs>
          <path d="M12 3C11.4 3 5 11 5 15.5a7 7 0 0 0 14 0C19 11 12.6 3 12 3z" fill="url(#wfp-drop)" />
        </svg>
        <span className="text-[2.6rem] font-bold leading-none tracking-tight text-ink tabular-nums">{display.toLocaleString()}</span>
        <span className="mb-1 text-sm font-semibold text-ink/50">{unit}</span>
      </div>

      {/* Goal marker + drag bar */}
      <div className="mt-6">
        <div className="relative mb-1 h-3">
          <span
            className="absolute -translate-x-1/2 text-[9px] font-semibold uppercase tracking-wide text-primary/55"
            style={{ left: "50%" }}
          >
            Goal
          </span>
        </div>
        <div
          ref={trackRef}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); setFromClientX(e.clientX); }}
          onPointerMove={(e) => { if (dragging) setFromClientX(e.clientX); }}
          onPointerUp={(e) => { setDragging(false); try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ } }}
          onPointerCancel={() => setDragging(false)}
          className="relative flex h-9 cursor-pointer touch-none select-none items-center"
        >
          {/* Track + fill */}
          <div className="absolute inset-x-0 top-1/2 h-4 -translate-y-1/2 overflow-hidden rounded-full border border-primary/15 bg-primary/[0.07]">
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${frac * 100}%`, background: "linear-gradient(180deg, rgba(196,228,255,0.7) 0%, rgba(111,168,255,0.8) 100%)" }}
            />
          </div>
          {/* Goal tick at the midpoint */}
          <div className="pointer-events-none absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/35" style={{ left: "50%" }} />
          {/* Knob */}
          <div
            className={`pointer-events-none absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-primary shadow-[0_3px_10px_rgba(111,168,255,0.55)] transition-transform ${dragging ? "scale-110" : ""}`}
            style={{ left: `${frac * 100}%` }}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => onSubmit(valueMl)}
        className="mt-7 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
      >
        Save
      </button>
      <button
        type="button"
        onClick={onSkip}
        className="mt-2 w-full rounded-xl py-2 text-sm font-medium text-ink/45 transition active:opacity-60"
      >
        Skip
      </button>
    </div>
  );
}
