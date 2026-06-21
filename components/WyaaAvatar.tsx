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
            {/* Spherical blue body: bright off-centre core fading to a deeper blue edge. */}
            <radialGradient id="wyaa-orb" cx="42%" cy="36%" r="68%">
              <stop offset="0%" stopColor="#EAF3FF" />
              <stop offset="32%" stopColor="#A6CCFF" />
              <stop offset="66%" stopColor="#6FA8FF" />
              <stop offset="100%" stopColor="#3F79DE" />
            </radialGradient>
            {/* Soft inner light wisps that drift around inside the orb. */}
            <radialGradient id="wyaa-wisp" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#E4F0FF" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#E4F0FF" stopOpacity="0" />
            </radialGradient>
            {/* Outer glow. */}
            <radialGradient id="wyaa-glow" cx="50%" cy="50%" r="50%">
              <stop offset="55%" stopColor="#6FA8FF" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#6FA8FF" stopOpacity="0" />
            </radialGradient>
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

            {/* main orb */}
            <circle cx="20" cy="20" r="13.5" fill="url(#wyaa-orb)" />

            {/* drifting inner light, clipped inside the orb */}
            <g clipPath="url(#wyaa-clip)">
              <circle className="wyaa-wisp-a" cx="15" cy="16" r="9" fill="url(#wyaa-wisp)" />
              <circle className="wyaa-wisp-b" cx="26" cy="24" r="8" fill="url(#wyaa-wisp)" />
              <circle className="wyaa-wisp-c" cx="20" cy="27" r="7" fill="url(#wyaa-wisp)" />
            </g>

            {/* specular highlight */}
            <ellipse cx="15" cy="13" rx="4.4" ry="2.9" fill="#FFFFFF" opacity="0.4" />

            {/* faint rim light */}
            <circle cx="20" cy="20" r="13.2" fill="none" stroke="#EAF3FF" strokeOpacity="0.22" strokeWidth="0.6" />
          </g>
        </svg>
      </button>
    </div>
  );
}
