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
          {/* translucent glowing orb: lit from the upper-left, soft translucent rim */}
          <radialGradient id="wyaa-orb" cx="42%" cy="35%" r="72%">
            <stop offset="0%" stopColor="#E4EEFF" />
            <stop offset="42%" stopColor="#9CC0FF" />
            <stop offset="84%" stopColor="#6FA8FF" />
            <stop offset="100%" stopColor="#6FA8FF" stopOpacity="0.45" />
          </radialGradient>
          {/* soft outer halo */}
          <radialGradient id="wyaa-halo" cx="50%" cy="50%" r="50%">
            <stop offset="48%" stopColor="#7FB0FF" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#7FB0FF" stopOpacity="0" />
          </radialGradient>
          {/* faint inner-bottom glow for the translucent feel */}
          <radialGradient id="wyaa-underglow" cx="50%" cy="78%" r="42%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* glow halo */}
        <circle cx="20" cy="20" r="20" fill="url(#wyaa-halo)" />

        {/* the orb */}
        <circle cx="20" cy="20" r="16.5" fill="url(#wyaa-orb)" />

        {/* soft light pooling at the bottom (the see-through, glowing quality) */}
        <circle cx="20" cy="20" r="16.5" fill="url(#wyaa-underglow)" />

        {/* glossy top-left highlight */}
        <ellipse cx="14" cy="12.5" rx="6" ry="3.8" fill="#FFFFFF" opacity="0.3" />

        {/* friendly eyes — soft white ovals */}
        <ellipse cx="15.3" cy="18.6" rx="2.3" ry="3.4" fill="#FFFFFF" />
        <ellipse cx="24.7" cy="18.6" rx="2.3" ry="3.4" fill="#FFFFFF" />
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
