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
            <stop offset="0%" stopColor="#EAF2FF" />
            <stop offset="38%" stopColor="#BCD6FF" />
            <stop offset="74%" stopColor="#A8CBFF" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#A8CBFF" stopOpacity="0" />
          </linearGradient>
          {/* soft halo */}
          <radialGradient id="wyaa-halo" cx="50%" cy="42%" r="55%">
            <stop offset="42%" stopColor="#B6D2FF" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#B6D2FF" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* halo */}
        <ellipse cx="20" cy="17" rx="18" ry="19" fill="url(#wyaa-halo)" />

        {/* round-top body fading toward the bottom */}
        <circle cx="20" cy="17.5" r="14" fill="url(#wyaa-body)" />

        {/* glossy top highlight */}
        <ellipse cx="14.5" cy="10.5" rx="5.5" ry="3.4" fill="#FFFFFF" opacity="0.35" />

        {/* friendly eyes — soft white ovals */}
        <ellipse cx="15.6" cy="16.4" rx="2.2" ry="3.3" fill="#FFFFFF" />
        <ellipse cx="24.4" cy="16.4" rx="2.2" ry="3.3" fill="#FFFFFF" />
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
