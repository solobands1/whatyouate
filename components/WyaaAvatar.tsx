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
            {/* Near-clear body with only a faint blue tinge, like a water droplet. */}
            <radialGradient id="wyaa-orb" cx="48%" cy="46%" r="62%">
              <stop offset="0%" stopColor="#E2EEFF" />
              <stop offset="62%" stopColor="#C2DBFF" />
              <stop offset="100%" stopColor="#A6C8FF" />
            </radialGradient>
            {/* Inner blobs that flow inside: soft blue tones (not white) plus a slightly deeper blue for gentle depth, kept low-opacity so it stays clear/glassy. */}
            <radialGradient id="wyaa-blob-light" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#C6DEFF" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#C6DEFF" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="wyaa-blob-bright" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#DCEBFF" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#DCEBFF" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="wyaa-blob-deep" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#5E96EE" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#5E96EE" stopOpacity="0" />
            </radialGradient>
            {/* Outer glow. */}
            <radialGradient id="wyaa-glow" cx="50%" cy="50%" r="50%">
              <stop offset="55%" stopColor="#8FBCFF" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#8FBCFF" stopOpacity="0" />
            </radialGradient>
            {/* Soft blur so the blobs blend like plasma rather than hard circles. */}
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
              <circle className="wyaa-ping" cx="20" cy="20" r="13.5" fill="none" stroke="#6FA8FF" strokeWidth="1.4" />
            )}

            {/* near-clear body, faint blue tinge */}
            <circle cx="20" cy="20" r="13.5" fill="url(#wyaa-orb)" fillOpacity="0.32" />

            {/* flowing inner blobs, blurred and clipped inside the orb */}
            <g clipPath="url(#wyaa-clip)">
              <g filter="url(#wyaa-soft)">
                <circle className="wyaa-blob-1" cx="14" cy="15" r="9.5" fill="url(#wyaa-blob-light)" />
                <circle className="wyaa-blob-2" cx="26" cy="24" r="9" fill="url(#wyaa-blob-deep)" />
                <circle className="wyaa-blob-3" cx="21" cy="22" r="7" fill="url(#wyaa-blob-bright)" />
                <circle className="wyaa-blob-4" cx="25" cy="14" r="7.5" fill="url(#wyaa-blob-light)" />
              </g>
            </g>

            {/* rim that defines the clear bubble's edge */}
            <circle cx="20" cy="20" r="13.2" fill="none" stroke="#8FB8FF" strokeOpacity="0.45" strokeWidth="0.8" />
          </g>
        </svg>
      </button>
    </div>
  );
}
