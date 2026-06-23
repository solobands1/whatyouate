"use client";

import { useEffect, useRef, useState } from "react";

export default function WaterBar({ pct, displayCurrent, displayGoal }: {
  pct: number;
  displayCurrent: string;
  displayGoal: string;
}) {
  const fillPct = Math.max(0, Math.min(100, pct));
  const [animatedPct, setAnimatedPct] = useState(0);
  const [fillDuration, setFillDuration] = useState("3000ms");
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      // Double rAF: first frame renders width=0, second triggers the 3s transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimatedPct(fillPct));
      });
    } else {
      setFillDuration("2000ms");
      setAnimatedPct(fillPct);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillPct]);

  return (
    <div>
      {/* Drop icon + bar row */}
      <div className="flex items-center gap-2">
        <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
          <defs>
            <linearGradient id="wbar-drop" x1="0.35" y1="0" x2="0.65" y2="1">
              <stop offset="0%" stopColor="#BAD8FF" />
              <stop offset="45%" stopColor="#93C5FD" />
              <stop offset="100%" stopColor="#6FA8FF" />
            </linearGradient>
          </defs>
          <path d="M12 3C11.4 3 5 11 5 15.5a7 7 0 0 0 14 0C19 11 12.6 3 12 3z" fill="url(#wbar-drop)" />
          <ellipse cx="9.8" cy="13.5" rx="1.2" ry="2" fill="rgba(255,255,255,0.40)" transform="rotate(-20 9.8 13.5)" />
        </svg>
        {/* Horizontal bar */}
        <div className="relative flex-1 h-[13px] overflow-hidden rounded-full bg-primary/[0.06] border border-primary/15">
          <div
            className="absolute left-0 top-0 h-full transition-[width] ease-out"
            style={{ width: `${animatedPct}%`, transitionDuration: fillDuration }}
          >
            {fillPct > 0 && (
              <>
                <div
                  className="absolute inset-0"
                  style={{ background: "linear-gradient(180deg, rgba(196,228,255,0.52) 0%, rgba(111,168,255,0.62) 100%)" }}
                />
                {animatedPct < 99 && (
                  <div className="absolute right-0 top-0 h-full animate-ripple-x" style={{ width: 22 }}>
                    <svg width="22" height="100%" viewBox="0 0 22 13" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M2 0 C5 2.5, 0 5, 2 7.5 C5 10, 0 12, 2 13 L14 13 C12 12, 17 10, 14 7.5 C11 5, 18 2.5, 14 0 Z"
                        fill="rgba(196,228,255,0.38)"
                      />
                      <path
                        d="M14 0 C18 2.5, 11 5, 14 7.5 C17 10, 12 12, 14 13 L22 13 L22 0 Z"
                        fill="rgba(111,168,255,0.62)"
                      />
                    </svg>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Progress numbers below bar */}
      <div className="mt-1.5 flex items-center justify-end pl-[26px]">
        <p className="text-[10px] text-ink/65">
          {displayCurrent} <span className="text-ink/50">/ {displayGoal}</span>
        </p>
      </div>
    </div>
  );
}
