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
            {/* Dark glowing blue sphere: brighter mid, deep navy rim (the spherical vignette). */}
            <radialGradient id="wyaa-orb" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#3F6FC8" />
              <stop offset="58%" stopColor="#234FA8" />
              <stop offset="100%" stopColor="#0B1E47" />
            </radialGradient>
            {/* Luminous core bloom. */}
            <radialGradient id="wyaa-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
              <stop offset="35%" stopColor="#CFE6FF" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#CFE6FF" stopOpacity="0" />
            </radialGradient>
            {/* Outer glow. */}
            <radialGradient id="wyaa-glow" cx="50%" cy="50%" r="50%">
              <stop offset="55%" stopColor="#5E9BF2" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#5E9BF2" stopOpacity="0" />
            </radialGradient>
            {/* Soft blur so the ribbons read as glowing light rather than hard strokes. */}
            <filter id="wyaa-soft" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.1" />
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

            {/* dark glowing sphere */}
            <circle cx="20" cy="20" r="13.5" fill="url(#wyaa-orb)" />

            {/* looping light ribbons + core bloom, blurred and clipped inside the orb */}
            <g clipPath="url(#wyaa-clip)">
              <g filter="url(#wyaa-soft)">
                <ellipse className="wyaa-ring-1" cx="20" cy="20" rx="10.5" ry="5" fill="none" stroke="#A9D8FF" strokeOpacity="0.75" strokeWidth="3.1" />
                <ellipse className="wyaa-ring-2" cx="20" cy="20" rx="11" ry="4.5" fill="none" stroke="#79C4FF" strokeOpacity="0.6" strokeWidth="2.9" />
                <ellipse className="wyaa-ring-3" cx="20" cy="20" rx="9.5" ry="5.6" fill="none" stroke="#6FA8FF" strokeOpacity="0.55" strokeWidth="2.9" />
                {/* luminous core */}
                <circle className="wyaa-core-pulse" cx="20" cy="20" r="8.5" fill="url(#wyaa-core)" />
              </g>
            </g>
          </g>
        </svg>
      </button>
    </div>
  );
}
