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
            {/* Glowing blue sphere: bright mid, medium-blue rim (kept fairly light). */}
            <radialGradient id="wyaa-orb" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#6E97DE" />
              <stop offset="58%" stopColor="#4D77CE" />
              <stop offset="100%" stopColor="#3056A8" />
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

            {/* 3 center-anchored ribbons; each is two halves that pivot around the
                center so the middle stays put and the ends wave. Core bloom behind. */}
            <g clipPath="url(#wyaa-clip)">
              <g filter="url(#wyaa-soft)">
                {/* core bloom sits behind the ribbons */}
                <circle className="wyaa-core-pulse" cx="20" cy="20" r="6.5" fill="url(#wyaa-core)" />

                {/* ribbon 1 (baseline 17.5) */}
                <path className="wyaa-sway-1" style={{ transformBox: "view-box", transformOrigin: "20px 17.5px" }} d="M20 17.5 Q8 14.5 -6 17.5" fill="none" stroke="#BCE0FF" strokeOpacity="0.7" strokeWidth="1.9" strokeLinecap="round" />
                <path className="wyaa-sway-2" style={{ transformBox: "view-box", transformOrigin: "20px 17.5px" }} d="M20 17.5 Q32 20.5 46 17.5" fill="none" stroke="#BCE0FF" strokeOpacity="0.7" strokeWidth="1.9" strokeLinecap="round" />

                {/* ribbon 2 (baseline 20) */}
                <path className="wyaa-sway-3" style={{ transformBox: "view-box", transformOrigin: "20px 20px" }} d="M20 20 Q8 23 -6 20" fill="none" stroke="#79C4FF" strokeOpacity="0.64" strokeWidth="2" strokeLinecap="round" />
                <path className="wyaa-sway-4" style={{ transformBox: "view-box", transformOrigin: "20px 20px" }} d="M20 20 Q32 17 46 20" fill="none" stroke="#79C4FF" strokeOpacity="0.64" strokeWidth="2" strokeLinecap="round" />

                {/* ribbon 3 (baseline 22.5) */}
                <path className="wyaa-sway-5" style={{ transformBox: "view-box", transformOrigin: "20px 22.5px" }} d="M20 22.5 Q8 19.5 -6 22.5" fill="none" stroke="#A9D8FF" strokeOpacity="0.6" strokeWidth="1.8" strokeLinecap="round" />
                <path className="wyaa-sway-6" style={{ transformBox: "view-box", transformOrigin: "20px 22.5px" }} d="M20 22.5 Q32 25.5 46 22.5" fill="none" stroke="#A9D8FF" strokeOpacity="0.6" strokeWidth="1.8" strokeLinecap="round" />
              </g>
            </g>
          </g>
        </svg>
      </button>
    </div>
  );
}
