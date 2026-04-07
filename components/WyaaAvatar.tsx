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
      <path d="M15 29.5 Q20 32.5 25 29.5" stroke="#1a3a60" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    ),
    happy: (
      <path d="M14 29 Q20 34 26 29" stroke="#1a3a60" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    ),
    excited: (
      <>
        <path d="M13 28.5 Q20 35.5 27 28.5" stroke="#1a3a60" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <ellipse cx="20" cy="32" rx="4" ry="2.2" fill="#1a3a60" opacity="0.10" />
      </>
    ),
    thinking: (
      <path d="M15.5 30.5 Q20 28.5 24.5 30.5" stroke="#1a3a60" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    ),
  };

  const eyebrows = {
    neutral: null,
    happy: null,
    excited: (
      <>
        <path d="M12.5 17.5 Q15.5 15 18.5 17" stroke="#1a3a60" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        <path d="M21.5 17 Q24.5 15 27.5 17.5" stroke="#1a3a60" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      </>
    ),
    thinking: (
      <>
        <path d="M12.5 18 Q15.5 16 18.5 17.5" stroke="#1a3a60" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        <path d="M21.5 17.5 Q25 16.5 27.5 18.5" stroke="#1a3a60" strokeWidth="1.1" strokeLinecap="round" fill="none" />
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
        {/* Crown — calyx leaves */}
        <path d="M14 13 C13 10 11 8 9 8 C11 9 13 11 14 13Z" fill="#4F88E8" opacity="0.8" />
        <path d="M19.5 12 C19.5 9 19.5 6.5 20.5 5 C21.5 6.5 21.5 9 21.5 12Z" fill="#4F88E8" opacity="0.8" />
        <path d="M26 13 C27 10 29 8 31 8 C29 9 27 11 26 13Z" fill="#4F88E8" opacity="0.8" />
        <path d="M17 13 C16 10.5 14.5 9 13 9 C15 10 16.5 11.5 17 13Z" fill="#4F88E8" opacity="0.55" />
        <path d="M23 13 C24 10.5 25.5 9 27 9 C25 10 23.5 11.5 23 13Z" fill="#4F88E8" opacity="0.55" />

        {/* Body */}
        <ellipse cx="20" cy="27.5" rx="16" ry="15" fill="#6FA8FF" />

        {/* Soft inner highlight */}
        <ellipse cx="13.5" cy="19.5" rx="5" ry="3.5" fill="#DDEBFF" opacity="0.55" />

        {/* Cheeks */}
        <ellipse cx="11.5" cy="28" rx="3" ry="2" fill="#FFB5C8" opacity="0.28" />
        <ellipse cx="28.5" cy="28" rx="3" ry="2" fill="#FFB5C8" opacity="0.28" />

        {/* Eyes — white sclera */}
        <circle cx="15" cy="24.5" r="3" fill="white" />
        <circle cx="25" cy="24.5" r="3" fill="white" />

        {/* Pupils — centered */}
        <circle cx="15" cy="25.2" r="1.5" fill="#1a3a60" />
        <circle cx="25" cy="25.2" r="1.5" fill="#1a3a60" />

        {/* Eye shine */}
        <circle cx="15.9" cy="24.2" r="0.75" fill="white" />
        <circle cx="25.9" cy="24.2" r="0.75" fill="white" />

        {/* Eyebrows */}
        {eyebrows[expression]}

        {/* Mouth */}
        {mouth[expression]}

        {/* Tiny arms */}
        <path d="M4.5 28.5 Q3.5 25.5 5.5 23.5" stroke="#4F88E8" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <path d="M35.5 28.5 Q36.5 25.5 34.5 23.5" stroke="#4F88E8" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      </svg>
    </button>
  );
}
