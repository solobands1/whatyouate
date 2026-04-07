"use client";

export type WyaaExpression = "neutral" | "happy" | "excited" | "thinking";

interface WyaaAvatarProps {
  expression?: WyaaExpression;
  isNew?: boolean;
  size?: number;
  onClick?: () => void;
  className?: string;
}

export default function WyaaAvatar({
  isNew = false,
  size = 36,
  onClick,
  className = "",
}: WyaaAvatarProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 transition active:opacity-70 ${isNew ? "animate-wyaa-bounce" : "animate-wyaa-float"} ${className}`}
      aria-label="About your AI coach"
      style={{ background: "none", border: "none", padding: 0 }}
    >
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="wyaa-bg" cx="38%" cy="32%" r="65%">
            <stop offset="0%" stopColor="#A8C8FF" />
            <stop offset="55%" stopColor="#6FA8FF" />
            <stop offset="100%" stopColor="#5182E8" />
          </radialGradient>
          <radialGradient id="wyaa-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Base circle */}
        <circle cx="20" cy="20" r="19" fill="url(#wyaa-bg)" />

        {/* Inner glow */}
        <circle cx="20" cy="20" r="19" fill="url(#wyaa-glow)" />

        {/* Subtle top-left highlight */}
        <ellipse cx="13.5" cy="12" rx="7" ry="5" fill="white" opacity="0.18" />

        {/* 4-point sparkle */}
        <g transform="translate(20, 20)">
          {/* Main vertical */}
          <path d="M0 -7.5 C0.9 -3 0.9 3 0 7.5 C-0.9 3 -0.9 -3 0 -7.5Z" fill="white" opacity="0.95" />
          {/* Main horizontal */}
          <path d="M-7.5 0 C-3 0.9 3 0.9 7.5 0 C3 -0.9 -3 -0.9 -7.5 0Z" fill="white" opacity="0.95" />
          {/* Thin diagonal arms */}
          <path d="M-3.8 -3.8 C-1 -1 1 1 3.8 3.8" stroke="white" strokeWidth="0.9" strokeLinecap="round" opacity="0.4" />
          <path d="M3.8 -3.8 C1 -1 -1 1 -3.8 3.8" stroke="white" strokeWidth="0.9" strokeLinecap="round" opacity="0.4" />
          {/* Center */}
          <circle r="1.4" fill="white" />
        </g>
      </svg>
    </button>
  );
}
