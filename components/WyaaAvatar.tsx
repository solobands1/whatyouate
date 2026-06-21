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
            {/* Even, matte blue body (no glossy hot spot) so the moving blobs are what reads. */}
            <radialGradient id="wyaa-orb" cx="48%" cy="46%" r="62%">
              <stop offset="0%" stopColor="#7FB0FF" />
              <stop offset="62%" stopColor="#6098F0" />
              <stop offset="100%" stopColor="#3F79DE" />
            </radialGradient>
            {/* Inner blobs that flow inside: a light tone, a bright tone, and a deeper blue for depth. */}
            <radialGradient id="wyaa-blob-light" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#CFE4FF" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#CFE4FF" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="wyaa-blob-bright" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#EAF3FF" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#EAF3FF" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="wyaa-blob-deep" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#2F62C8" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#2F62C8" stopOpacity="0" />
            </radialGradient>
            {/* Outer glow. */}
            <radialGradient id="wyaa-glow" cx="50%" cy="50%" r="50%">
              <stop offset="55%" stopColor="#6FA8FF" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#6FA8FF" stopOpacity="0" />
            </radialGradient>
            {/* Soft blur so the blobs blend like plasma rather than hard circles. */}
            <filter id="wyaa-soft" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.3" />
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

            {/* matte body */}
            <circle cx="20" cy="20" r="13.5" fill="url(#wyaa-orb)" />

            {/* flowing inner blobs, blurred and clipped inside the orb */}
            <g clipPath="url(#wyaa-clip)">
              <g filter="url(#wyaa-soft)">
                <circle className="wyaa-blob-1" cx="14.5" cy="15" r="8.5" fill="url(#wyaa-blob-light)" />
                <circle className="wyaa-blob-2" cx="26" cy="24" r="8" fill="url(#wyaa-blob-deep)" />
                <circle className="wyaa-blob-3" cx="21" cy="22" r="6" fill="url(#wyaa-blob-bright)" />
                <circle className="wyaa-blob-4" cx="24" cy="14" r="6.5" fill="url(#wyaa-blob-light)" />
              </g>
            </g>

            {/* very faint rim light to seat the sphere */}
            <circle cx="20" cy="20" r="13.2" fill="none" stroke="#BCDAFF" strokeOpacity="0.18" strokeWidth="0.6" />
          </g>
        </svg>
      </button>
    </div>
  );
}
