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
    neutral: (
      <path d="M15 30 Q20 33 25 30" stroke="#1e1b4b" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    ),
    happy: (
      <path d="M14 29 Q20 35 26 29" stroke="#1e1b4b" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    ),
    excited: (
      <>
        <path d="M13 28 Q20 36 27 28" stroke="#1e1b4b" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <ellipse cx="20" cy="32" rx="4.5" ry="2.5" fill="#1e1b4b" opacity="0.12" />
      </>
    ),
    thinking: (
      <path d="M15 31 Q20 28.5 25 31" stroke="#1e1b4b" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    ),
  };

  const eyebrows = {
    neutral: null,
    happy: null,
    excited: (
      <>
        <path d="M12.5 17 Q15.5 14.5 18.5 16.5" stroke="#1e1b4b" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        <path d="M21.5 16.5 Q24.5 14.5 27.5 17" stroke="#1e1b4b" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      </>
    ),
    thinking: (
      <>
        <path d="M12.5 17.5 Q15.5 15.5 18.5 17" stroke="#1e1b4b" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        <path d="M21.5 17 Q24.5 15.5 27.5 17.5" stroke="#1e1b4b" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      </>
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
        {/* Crown — blueberry calyx */}
        <path d="M14 12 C13 9 11 7 9 7 C11 8 13 10 14 12Z" fill="#4338CA" opacity="0.7" />
        <path d="M19 11 C19 8 19 5.5 20 4 C21 5.5 21 8 21 11Z" fill="#4338CA" opacity="0.7" />
        <path d="M26 12 C27 9 29 7 31 7 C29 8 27 10 26 12Z" fill="#4338CA" opacity="0.7" />
        <path d="M17 12 C16 9.5 14.5 8 13 8 C15 9 16.5 10.5 17 12Z" fill="#4338CA" opacity="0.5" />
        <path d="M23 12 C24 9.5 25.5 8 27 8 C25 9 23.5 10.5 23 12Z" fill="#4338CA" opacity="0.5" />

        {/* Body */}
        <ellipse cx="20" cy="27" rx="16.5" ry="15.5" fill="#6366F1" />

        {/* Highlight */}
        <ellipse cx="13" cy="19" rx="5.5" ry="4" fill="#A5B4FC" opacity="0.45" />

        {/* Eyes */}
        <circle cx="15" cy="25" r="3" fill="white" />
        <circle cx="25" cy="25" r="3" fill="white" />
        <circle cx="15.7" cy="25.6" r="1.5" fill="#1e1b4b" />
        <circle cx="25.7" cy="25.6" r="1.5" fill="#1e1b4b" />
        {/* Eye shine */}
        <circle cx="16.5" cy="24.6" r="0.65" fill="white" />
        <circle cx="26.5" cy="24.6" r="0.65" fill="white" />

        {/* Eyebrows */}
        {eyebrows[expression]}

        {/* Mouth */}
        {mouth[expression]}

        {/* Tiny arms */}
        <path d="M4 28 Q3 25 5 23" stroke="#4F46E5" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <path d="M36 28 Q37 25 35 23" stroke="#4F46E5" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      </svg>
    </button>
  );
}
