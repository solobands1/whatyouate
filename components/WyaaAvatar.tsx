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
  const [gaze, setGaze] = useState({ x: 0, y: 0, dur: 0.8 });
  const [blink, setBlink] = useState(false);
  const [wander, setWander] = useState({ x: 0, dur: 1.4 });

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

  // On load it sits calmly for a beat, then "notices" you and bounces up and
  // down, then settles back to the calm float. Random variant + slight delay so
  // each load feels a little different. Skipped when it's flying in (the fly is
  // its entrance in that case).
  const [popClass, setPopClass] = useState("");
  const [entering, setEntering] = useState(false);
  useEffect(() => {
    if (fly) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const variants = ["wyaa-pop-1", "wyaa-pop-3"];
    let end: ReturnType<typeof setTimeout>;
    const start = setTimeout(() => {
      setPopClass(variants[Math.floor(Math.random() * variants.length)]);
      setEntering(true);
      end = setTimeout(() => setEntering(false), 1100);
    }, 500 + Math.random() * 350);
    return () => { clearTimeout(start); clearTimeout(end); };
  }, []);

  // Random, calm glances: it rests, then occasionally drifts to a new spot (often
  // back to center). Randomly timed so it never reads as a fixed pattern.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setGaze(Math.random() < 0.42
          ? { x: 0, y: 0, dur: 0.7 + Math.random() * 0.6 } // gentle settle back to center
          : { x: (Math.random() * 2 - 1) * 1.7, y: (Math.random() * 2 - 1) * 1.2, dur: 0.28 + Math.random() * 0.95 }); // some quick darts, some slow drifts
        loop();
      }, 1600 + Math.random() * 3200);
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  // Occasionally the whole body wanders a little to one side, then drifts back
  // to center. Not constant, random side + distance + timing so it never reads
  // as a fixed "left then back" pattern.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const reach = size * 0.075;
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    const loop = () => {
      t1 = setTimeout(() => {
        if (Math.random() < 0.6) {
          const offset = (Math.random() < 0.5 ? -1 : 1) * (reach * 0.45 + Math.random() * reach * 0.55);
          setWander({ x: offset, dur: 1.1 + Math.random() * 1.1 });
          t2 = setTimeout(() => setWander({ x: 0, dur: 1.0 + Math.random() * 1.2 }), 1400 + Math.random() * 2000);
        }
        loop();
      }, 5000 + Math.random() * 6500);
    };
    loop();
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [size]);

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
    <div className={`relative inline-flex shrink-0 flex-col items-center ${className}`} style={{ width: size, height: size + 8, transform: `translateX(${wander.x}px)`, transition: `transform ${wander.dur}s ease-in-out` }}>
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 transition active:opacity-70 ${flyClass ? flyClass : entering && popClass ? popClass : isNew ? "animate-wyaa-bounce" : "animate-wyaa-float"}`}
      aria-label="About your AI coach"
      style={{ background: "none", border: "none", padding: 0 }}
    >
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          {/* lighter body, round at the top, dissolving toward the bottom like a soft wisp */}
          <linearGradient id="wyaa-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#A6CDFF" />
            <stop offset="50%" stopColor="#83B6FF" />
            <stop offset="85%" stopColor="#83B6FF" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#83B6FF" stopOpacity="0.16" />
          </linearGradient>
        </defs>

        {/* app-icon style rounded square (squircle) body, fading toward the bottom */}
        <rect x="6" y="3.5" width="28" height="28" rx="9.5" fill="url(#wyaa-body)" />

        {/* glossy top highlight */}
        <ellipse cx="14.3" cy="10.5" rx="4" ry="2.4" fill="#FFFFFF" opacity="0.12" />

        {/* eyes — soft round white eyes; glance + blink at random, organic intervals */}
        <g style={{ transform: `translate(${gaze.x}px, ${gaze.y}px)`, transition: `transform ${gaze.dur}s ease-in-out` }}>
          <g style={{ transform: blink ? "scaleY(0.1)" : "scaleY(1)", transformOrigin: "center", transformBox: "fill-box", transition: "transform 90ms ease-in-out" }}>
            <ellipse cx="15.6" cy="16.4" rx="2.2" ry="3.3" fill="#FFFFFF" />
            <ellipse cx="24.4" cy="16.4" rx="2.2" ry="3.3" fill="#FFFFFF" />
          </g>
        </g>
      </svg>
    </button>
    {/* Hidden while it's off the page so no orphan shadow is left behind. */}
    {!flyClass && (
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
    )}
    </div>
  );
}
