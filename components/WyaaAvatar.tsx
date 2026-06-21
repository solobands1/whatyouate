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
            {/* Glassy base gradient from the app's soft + ring blues. */}
            <linearGradient id="wyaa-orb" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#DDEBFF" />
              <stop offset="100%" stopColor="#BBD4FF" />
            </linearGradient>
            {/* Drifting colour blobs, only the app blues: primary, primary.dark, ring. */}
            <radialGradient id="wyaa-b1" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#6FA8FF" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#6FA8FF" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="wyaa-b2" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4F88E8" stopOpacity="1" />
              <stop offset="100%" stopColor="#4F88E8" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="wyaa-b3" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#6FA8FF" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#6FA8FF" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="wyaa-b4" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#BBD4FF" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#BBD4FF" stopOpacity="0" />
            </radialGradient>
            {/* Outer glow. */}
            <radialGradient id="wyaa-glow" cx="50%" cy="50%" r="50%">
              <stop offset="55%" stopColor="#6FA8FF" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#6FA8FF" stopOpacity="0" />
            </radialGradient>
            {/* Blur so the blobs melt into a smooth gradient, but defined enough that the colour shift reads. */}
            <filter id="wyaa-soft" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="1.4" />
            </filter>
            {/* Living edge: animated turbulence displaces the silhouette so its bumps
                slowly travel around the circumference and morph, making it feel alive. */}
            <filter id="wyaa-wobble" x="-25%" y="-25%" width="150%" height="150%">
              <feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="2" seed="4" result="n">
                <animate attributeName="baseFrequency" dur="16s" values="0.012;0.02;0.014;0.012" repeatCount="indefinite" />
                <animate attributeName="seed" dur="22s" values="0;7;0" repeatCount="indefinite" />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <clipPath id="wyaa-clip">
              <circle cx="20" cy="20" r="13.5" />
            </clipPath>
          </defs>

          <g className="wyaa-breathe">
            {/* attention pulse when there's something new */}
            {isNew && (
              <circle className="wyaa-ping" cx="20" cy="20" r="13.5" fill="none" stroke="#6FA8FF" strokeWidth="1.4" />
            )}

            {/* body + inner color field, displaced by the wobble filter for a living, morphing edge */}
            <g filter="url(#wyaa-wobble)">
              {/* clean base orb */}
              <circle cx="20" cy="20" r="13.5" fill="url(#wyaa-orb)" />

              {/* drifting colour blobs, heavily blurred and clipped to the circle;
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
          </g>
        </svg>
      </button>
    </div>
  );
}
