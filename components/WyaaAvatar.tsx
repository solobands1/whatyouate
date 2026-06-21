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
            {/* Glowing blue sphere: brighter mid, deeper (but not black) blue rim. */}
            <radialGradient id="wyaa-orb" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4E7AD0" />
              <stop offset="58%" stopColor="#3460BC" />
              <stop offset="100%" stopColor="#1C3D80" />
            </radialGradient>
            {/* Luminous core bloom. */}
            <radialGradient id="wyaa-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
              <stop offset="38%" stopColor="#CFE6FF" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#CFE6FF" stopOpacity="0" />
            </radialGradient>
            {/* Outer glow. */}
            <radialGradient id="wyaa-glow" cx="50%" cy="50%" r="50%">
              <stop offset="55%" stopColor="#5E9BF2" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#5E9BF2" stopOpacity="0" />
            </radialGradient>
            {/* Light blur: ribbons stay fairly defined but not stark. */}
            <filter id="wyaa-soft" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="0.6" />
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

            {/* glowing sphere */}
            <circle cx="20" cy="20" r="13.5" fill="url(#wyaa-orb)" />

            {/* horizontal waving light ribbons + core bloom, blurred and clipped inside */}
            <g clipPath="url(#wyaa-clip)">
              <g filter="url(#wyaa-soft)">
                {/* core bloom sits behind the ribbons */}
                <circle className="wyaa-core-pulse" cx="20" cy="20" r="6.5" fill="url(#wyaa-core)" />
                <path className="wyaa-rib-a" d="M-8 14 Q2 11.8 12 14 Q22 16.2 32 14 Q42 11.8 52 14" fill="none" stroke="#BCE0FF" strokeOpacity="0.7" strokeWidth="1.9" strokeLinecap="round" />
                <path className="wyaa-rib-b" d="M-8 17.5 Q2 19.9 12 17.5 Q22 15.1 32 17.5 Q42 19.9 52 17.5" fill="none" stroke="#93CFFF" strokeOpacity="0.65" strokeWidth="1.8" strokeLinecap="round" />
                <path className="wyaa-rib-c" d="M-8 20 Q2 16.8 12 20 Q22 23.2 32 20 Q42 16.8 52 20" fill="none" stroke="#79C4FF" strokeOpacity="0.62" strokeWidth="2" strokeLinecap="round" />
                <path className="wyaa-rib-d" d="M-8 22.5 Q2 24.9 12 22.5 Q22 20.1 32 22.5 Q42 24.9 52 22.5" fill="none" stroke="#8FBCFF" strokeOpacity="0.6" strokeWidth="1.8" strokeLinecap="round" />
                <path className="wyaa-rib-e" d="M-8 26 Q2 23.6 12 26 Q22 28.4 32 26 Q42 23.6 52 26" fill="none" stroke="#A9D8FF" strokeOpacity="0.58" strokeWidth="1.8" strokeLinecap="round" />
              </g>
            </g>
          </g>
        </svg>
      </button>
    </div>
  );
}
