"use client";

import { useEffect, useState } from "react";

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
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);

  // Random, calm glances: it rests, then occasionally drifts to a new spot (often
  // back to center). Randomly timed so it never reads as a fixed pattern.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setGaze(Math.random() < 0.42
          ? { x: 0, y: 0 }
          : { x: (Math.random() * 2 - 1) * 1.7, y: (Math.random() * 2 - 1) * 1.2 });
        loop();
      }, 1600 + Math.random() * 3200);
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  // Occasional blink at random intervals.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let t: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setBlink(true);
        t2 = setTimeout(() => setBlink(false), 130);
        loop();
      }, 2800 + Math.random() * 4200);
    };
    loop();
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, []);

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
            <stop offset="0%" stopColor="#8FBCFF" />
            <stop offset="50%" stopColor="#6FA8FF" />
            <stop offset="85%" stopColor="#6FA8FF" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#6FA8FF" stopOpacity="0.18" />
          </linearGradient>
        </defs>

        {/* round-top body fading toward the bottom */}
        <circle cx="20" cy="17.5" r="14" fill="url(#wyaa-body)" />

        {/* glossy top highlight */}
        <ellipse cx="14.3" cy="10.5" rx="4" ry="2.4" fill="#FFFFFF" opacity="0.12" />

        {/* eyes — soft round white eyes; glance + blink at random, organic intervals */}
        <g style={{ transform: `translate(${gaze.x}px, ${gaze.y}px)`, transition: "transform 0.8s ease-in-out" }}>
          <g style={{ transform: blink ? "scaleY(0.1)" : "scaleY(1)", transformOrigin: "center", transformBox: "fill-box", transition: "transform 90ms ease-in-out" }}>
            <ellipse cx="15.6" cy="16.4" rx="2.2" ry="3.3" fill="#FFFFFF" />
            <ellipse cx="24.4" cy="16.4" rx="2.2" ry="3.3" fill="#FFFFFF" />
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
