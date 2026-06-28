import type { CSSProperties } from "react";

// Unified card/section entrance: fade + rise together, staggered by index. Sets
// animation:"none" so it overrides Card's built-in quick fade (the two fighting is
// what reads as a "jolt"). Reduced-motion is honored globally in globals.css, where
// transition/animation durations collapse to instant.
export function riseIn(ready: boolean, i = 0): CSSProperties {
  return {
    opacity: ready ? 1 : 0,
    transform: ready ? "translateY(0)" : "translateY(16px)",
    transition: `opacity 700ms ease ${i * 150}ms, transform 850ms cubic-bezier(0.22,1,0.36,1) ${i * 150}ms`,
    animation: "none",
  };
}
