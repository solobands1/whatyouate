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
    <div className={`relative inline-flex shrink-0 flex-col items-center ${className}`} style={{ width: size, height: size + 8 }}>
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 transition active:opacity-70 ${isNew ? "animate-wyaa-bounce" : "animate-wyaa-float"}`}
      aria-label="About your AI coach"
      style={{ background: "none", border: "none", padding: 0 }}
    >
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          {/* lighter body, round at the top, dissolving toward the bottom like a soft wisp */}
          <linearGradient id="wyaa-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#A4C6FF" />
            <stop offset="60%" stopColor="#A4C6FF" />
            <stop offset="88%" stopColor="#A4C6FF" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#A4C6FF" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* round-top body fading toward the bottom */}
        <circle cx="20" cy="17.5" r="14" fill="url(#wyaa-body)" />

        {/* glossy top highlight */}
        <ellipse cx="14.3" cy="10.5" rx="4" ry="2.4" fill="#FFFFFF" opacity="0.12" />

        {/* eyes — rounder whites with soft pupils + a catchlight, looking around + blinking */}
        <g className="wyaa-look">
          <g className="wyaa-blink">
            <ellipse cx="15.6" cy="16.4" rx="2.6" ry="2.9" fill="#FFFFFF" />
            <ellipse cx="24.4" cy="16.4" rx="2.6" ry="2.9" fill="#FFFFFF" />
            <circle cx="15.6" cy="16.7" r="1.1" fill="#3D5C99" />
            <circle cx="24.4" cy="16.7" r="1.1" fill="#3D5C99" />
            <circle cx="15.2" cy="16.2" r="0.42" fill="#FFFFFF" />
            <circle cx="24" cy="16.2" r="0.42" fill="#FFFFFF" />
          </g>
        </g>
      </svg>
    </button>
    <div
      className={isNew ? "" : "animate-wyaa-shadow"}
      style={{
        position: "absolute",
        bottom: 0,
        left: "50%",
        width: size * 0.55,
        height: 4,
        borderRadius: 9999,
        background: "rgba(111,168,255,0.38)",
        filter: "blur(3px)",
        transformOrigin: "center",
      }}
    />
    </div>
  );
}
