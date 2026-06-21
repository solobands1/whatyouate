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
            {/* Very pale blue sphere (almost as light as the food pills), with a slightly deeper rim for form. */}
            <radialGradient id="wyaa-orb" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#EAF3FF" />
              <stop offset="60%" stopColor="#DCEBFF" />
              <stop offset="100%" stopColor="#BCD7FF" />
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
                {/* ribbon 1 (baseline 18.5) — light-medium blue */}
                <path className="wyaa-sway-1" style={{ transformBox: "view-box", transformOrigin: "20px 18.5px" }} d="M20 18.5 Q9 17 -6 18.5" fill="none" stroke="#7FB0FF" strokeOpacity="0.85" strokeWidth="1.7" strokeLinecap="round" />
                <path className="wyaa-sway-2" style={{ transformBox: "view-box", transformOrigin: "20px 18.5px" }} d="M20 18.5 Q31 20 46 18.5" fill="none" stroke="#7FB0FF" strokeOpacity="0.85" strokeWidth="1.7" strokeLinecap="round" />

                {/* ribbon 2 (baseline 20) — deepest blue */}
                <path className="wyaa-sway-3" style={{ transformBox: "view-box", transformOrigin: "20px 20px" }} d="M20 20 Q9 21.5 -6 20" fill="none" stroke="#4F88E8" strokeOpacity="0.85" strokeWidth="1.8" strokeLinecap="round" />
                <path className="wyaa-sway-4" style={{ transformBox: "view-box", transformOrigin: "20px 20px" }} d="M20 20 Q31 18.5 46 20" fill="none" stroke="#4F88E8" strokeOpacity="0.85" strokeWidth="1.8" strokeLinecap="round" />

                {/* ribbon 3 (baseline 21.5) — mid blue */}
                <path className="wyaa-sway-5" style={{ transformBox: "view-box", transformOrigin: "20px 21.5px" }} d="M20 21.5 Q9 20 -6 21.5" fill="none" stroke="#5E9BF2" strokeOpacity="0.83" strokeWidth="1.7" strokeLinecap="round" />
                <path className="wyaa-sway-6" style={{ transformBox: "view-box", transformOrigin: "20px 21.5px" }} d="M20 21.5 Q31 23 46 21.5" fill="none" stroke="#5E9BF2" strokeOpacity="0.83" strokeWidth="1.7" strokeLinecap="round" />
              </g>
            </g>
          </g>
        </svg>
      </button>
    </div>
  );
}
