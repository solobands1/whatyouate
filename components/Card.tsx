import type { HTMLAttributes } from "react";

// Deliberately borderless. The page background sits only a few points off the card white,
// which is hard to resolve on the LCD panels in the iPhone 11 / XR / SE line — a hairline
// ring was tried and removed because it cost more in cleanliness than it bought in
// legibility for a shrinking device segment. Revisit alongside dark mode, where the whole
// palette gets reconsidered and contrast can be solved properly for both themes.

export default function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-2xl bg-card p-4 shadow-card animate-card-fade ${className}`} {...props} />
  );
}
