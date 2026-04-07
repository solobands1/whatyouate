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
      aria-label="About Wyaa"
      style={{ background: "none", border: "none", padding: 0 }}
    >
      <svg width={size} height={size} viewBox="0 0 40 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Calyx crown */}
        <path d="M14 13 C13 10 11 8 9 8 C11 9 13 11 14 13Z" fill="#4F88E8" opacity="0.9" />
        <path d="M19.5 12 C19.5 9 19.5 6.5 20.5 5 C21.5 6.5 21.5 9 21.5 12Z" fill="#4F88E8" opacity="0.9" />
        <path d="M26 13 C27 10 29 8 31 8 C29 9 27 11 26 13Z" fill="#4F88E8" opacity="0.9" />
        <path d="M17 13 C16 10.5 14.5 9 13 9 C15 10 16.5 11.5 17 13Z" fill="#4F88E8" opacity="0.6" />
        <path d="M23 13 C24 10.5 25.5 9 27 9 C25 10 23.5 11.5 23 13Z" fill="#4F88E8" opacity="0.6" />

        {/* Body */}
        <ellipse cx="20" cy="27" rx="16" ry="15" fill="#6FA8FF" />

        {/* Inner depth — subtle darker base */}
        <ellipse cx="20" cy="30" rx="12" ry="10" fill="#4F88E8" opacity="0.18" />

        {/* Highlight — top-left glow */}
        <ellipse cx="13" cy="19" rx="6" ry="4.5" fill="#DDEBFF" opacity="0.65" />

        {/* AI sparkle — 4-point star, center of body */}
        <g transform="translate(20, 27)">
          {/* Vertical bar */}
          <path d="M0 -6 C0.6 -2.5 0.6 2.5 0 6" fill="#DDEBFF" opacity="0.95" />
          {/* Horizontal bar */}
          <path d="M-6 0 C-2.5 0.6 2.5 0.6 6 0" fill="#DDEBFF" opacity="0.95" />
          {/* Diagonal thin arms */}
          <path d="M-3.2 -3.2 C-0.8 -0.8 0.8 0.8 3.2 3.2" stroke="#DDEBFF" strokeWidth="0.7" strokeLinecap="round" opacity="0.5" />
          <path d="M3.2 -3.2 C0.8 -0.8 -0.8 0.8 -3.2 3.2" stroke="#DDEBFF" strokeWidth="0.7" strokeLinecap="round" opacity="0.5" />
          {/* Center dot */}
          <circle cx="0" cy="0" r="1.2" fill="white" opacity="0.9" />
        </g>
      </svg>
    </button>
  );
}
