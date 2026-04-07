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
  expression = "neutral",
  isNew = false,
  size = 36,
  onClick,
  className = "",
}: WyaaAvatarProps) {
  const mouth = {
    // gentle smile
    neutral: (
      <path d="M15.5 29.5 Q20 32.5 24.5 29.5" stroke="#1a3a60" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    ),
    // fuller smile
    happy: (
      <path d="M14 28.5 Q20 34 26 28.5" stroke="#1a3a60" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    ),
    // big open smile
    excited: (
      <>
        <path d="M13.5 27.5 Q20 35 26.5 27.5" stroke="#1a3a60" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <ellipse cx="20" cy="31.5" rx="4" ry="2.2" fill="#1a3a60" opacity="0.10" />
      </>
    ),
    // same gentle smile — attentive but always warm
    thinking: (
      <path d="M15.5 29.5 Q20 32.5 24.5 29.5" stroke="#1a3a60" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    ),
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 transition active:opacity-70 ${isNew ? "animate-wyaa-bounce" : "animate-wyaa-float"} ${className}`}
      aria-label="About Wyaa"
      style={{ background: "none", border: "none", padding: 0 }}
    >
      <svg width={size} height={size} viewBox="0 0 40 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Crown — calyx leaves */}
        <path d="M14 13 C13 10 11 8 9 8 C11 9 13 11 14 13Z" fill="#4F88E8" opacity="0.8" />
        <path d="M19.5 12 C19.5 9 19.5 6.5 20.5 5 C21.5 6.5 21.5 9 21.5 12Z" fill="#4F88E8" opacity="0.8" />
        <path d="M26 13 C27 10 29 8 31 8 C29 9 27 11 26 13Z" fill="#4F88E8" opacity="0.8" />
        <path d="M17 13 C16 10.5 14.5 9 13 9 C15 10 16.5 11.5 17 13Z" fill="#4F88E8" opacity="0.55" />
        <path d="M23 13 C24 10.5 25.5 9 27 9 C25 10 23.5 11.5 23 13Z" fill="#4F88E8" opacity="0.55" />

        {/* Body */}
        <ellipse cx="20" cy="27" rx="16" ry="15" fill="#6FA8FF" />

        {/* Soft highlight */}
        <ellipse cx="13.5" cy="19" rx="5" ry="3.5" fill="#DDEBFF" opacity="0.6" />

        {/* Cheeks */}
        <ellipse cx="11" cy="28" rx="3.2" ry="2" fill="#FFB5C8" opacity="0.32" />
        <ellipse cx="29" cy="28" rx="3.2" ry="2" fill="#FFB5C8" opacity="0.32" />

        {/* Eyes — larger, higher, wider apart */}
        <circle cx="14.5" cy="23.5" r="3.2" fill="white" />
        <circle cx="25.5" cy="23.5" r="3.2" fill="white" />

        {/* Pupils — centered */}
        <circle cx="14.5" cy="24.2" r="1.6" fill="#1a3a60" />
        <circle cx="25.5" cy="24.2" r="1.6" fill="#1a3a60" />

        {/* Eye shine */}
        <circle cx="15.5" cy="23.1" r="0.85" fill="white" />
        <circle cx="26.5" cy="23.1" r="0.85" fill="white" />

        {/* Mouth */}
        {mouth[expression]}

        {/* Tiny arms */}
        <path d="M4.5 28.5 Q3.5 25.5 5.5 23.5" stroke="#4F88E8" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <path d="M35.5 28.5 Q36.5 25.5 34.5 23.5" stroke="#4F88E8" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      </svg>
    </button>
  );
}
