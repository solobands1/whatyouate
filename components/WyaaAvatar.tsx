"use client";

import { useEffect, useState } from "react";

export type WyaaExpression = "neutral" | "happy" | "excited" | "thinking";

interface WyaaAvatarProps {
  expression?: WyaaExpression;
  isNew?: boolean;
  size?: number;
  onClick?: () => void;
  className?: string;
  // "out" = hover up off the page (and stay off); "in" = hover back down into place.
  fly?: "in" | "out" | null;
}

export default function WyaaAvatar({
  isNew = false,
  size = 36,
  onClick,
  className = "",
  fly = null,
}: WyaaAvatarProps) {
  // When flying in, drop the fly class after it lands so the calm float resumes.
  const [flyInDone, setFlyInDone] = useState(false);
  useEffect(() => {
    setFlyInDone(false);
    if (fly === "in") {
      const t = setTimeout(() => setFlyInDone(true), 620);
      return () => clearTimeout(t);
    }
  }, [fly]);
  const flyClass = fly === "out" ? "wyaa-fly-out" : fly === "in" && !flyInDone ? "wyaa-fly-in" : null;

  return (
    <div className={`relative inline-flex shrink-0 items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex shrink-0 transition active:opacity-80 ${flyClass ? flyClass : "animate-wyaa-float"}`}
        aria-label="About your AI coach"
        style={{ background: "none", border: "none", padding: 0 }}
      >
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            {/* Clean base gradient for the orb. */}
            <linearGradient id="wyaa-orb" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#C2DBFF" />
              <stop offset="100%" stopColor="#7FB0FF" />
            </linearGradient>
            {/* Soft colour blobs in different blue hues that drift to form a living gradient. */}
            <radialGradient id="wyaa-b1" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#9AD8FF" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#9AD8FF" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="wyaa-b2" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#3F79DE" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#3F79DE" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="wyaa-b3" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#6FA8FF" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#6FA8FF" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="wyaa-b4" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#A9C4FF" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#A9C4FF" stopOpacity="0" />
            </radialGradient>
            {/* Outer glow. */}
            <radialGradient id="wyaa-glow" cx="50%" cy="50%" r="50%">
              <stop offset="55%" stopColor="#6FA8FF" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#6FA8FF" stopOpacity="0" />
            </radialGradient>
            {/* Heavy blur so the blobs melt into a smooth, modern gradient field. */}
            <filter id="wyaa-soft" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="2.2" />
            </filter>
            <clipPath id="wyaa-clip">
              <circle cx="20" cy="20" r="13.5" />
            </clipPath>
          </defs>

          <g className="wyaa-breathe">
            {/* soft outer glow */}
            <circle className="wyaa-glow-pulse" cx="20" cy="20" r="19" fill="url(#wyaa-glow)" />

            {/* attention pulse when there's something new */}
            {isNew && (
              <circle className="wyaa-ping" cx="20" cy="20" r="13.5" fill="none" stroke="#7FB6FF" strokeWidth="1.4" />
            )}

            {/* clean base orb */}
            <circle cx="20" cy="20" r="13.5" fill="url(#wyaa-orb)" />

            {/* drifting colour blobs, heavily blurred and clipped to a crisp circle;
                the whole field also slowly rotates so it feels alive */}
            <g clipPath="url(#wyaa-clip)">
              <g className="wyaa-mesh-spin">
                <g filter="url(#wyaa-soft)">
                  <circle className="wyaa-mesh-1" cx="14" cy="14.5" r="11" fill="url(#wyaa-b1)" />
                  <circle className="wyaa-mesh-2" cx="27" cy="24" r="12" fill="url(#wyaa-b2)" />
                  <circle className="wyaa-mesh-3" cx="21" cy="26" r="10" fill="url(#wyaa-b3)" />
                  <circle className="wyaa-mesh-4" cx="13" cy="25" r="9" fill="url(#wyaa-b4)" />
                </g>
              </g>
            </g>
          </g>
        </svg>
      </button>
    </div>
  );
}
