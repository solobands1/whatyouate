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
            {/* Near-clear glass body with only a very faint blue tinge. */}
            <radialGradient id="wyaa-orb" cx="48%" cy="46%" r="62%">
              <stop offset="0%" stopColor="#EAF3FF" />
              <stop offset="65%" stopColor="#DCEBFF" />
              <stop offset="100%" stopColor="#C6DEFF" />
            </radialGradient>
            {/* The coloured cat's-eye vane: denser blue in the middle, fading at the tips. */}
            <radialGradient id="wyaa-catseye" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#5E9BF2" stopOpacity="0.85" />
              <stop offset="70%" stopColor="#5E9BF2" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#5E9BF2" stopOpacity="0" />
            </radialGradient>
            {/* Outer glow. */}
            <radialGradient id="wyaa-glow" cx="50%" cy="50%" r="50%">
              <stop offset="55%" stopColor="#8FBCFF" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#8FBCFF" stopOpacity="0" />
            </radialGradient>
            {/* Soft blur so the vane reads as fluid light rather than a hard shape. */}
            <filter id="wyaa-soft" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.0" />
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
              <circle className="wyaa-ping" cx="20" cy="20" r="13.5" fill="none" stroke="#6FA8FF" strokeWidth="1.4" />
            )}

            {/* near-clear glass body, no border */}
            <circle cx="20" cy="20" r="13.5" fill="url(#wyaa-orb)" fillOpacity="0.28" />

            {/* swirling cat's-eye vanes, blurred and clipped inside the orb */}
            <g clipPath="url(#wyaa-clip)">
              <g filter="url(#wyaa-soft)">
                <path className="wyaa-catseye-1" d="M7 20 C11 13.5 29 13.5 33 20 C29 26.5 11 26.5 7 20 Z" fill="url(#wyaa-catseye)" opacity="0.65" />
                <path className="wyaa-catseye-2" d="M7 20 C11 13.5 29 13.5 33 20 C29 26.5 11 26.5 7 20 Z" fill="url(#wyaa-catseye)" opacity="0.4" />
              </g>
            </g>
          </g>
        </svg>
      </button>
    </div>
  );
}
