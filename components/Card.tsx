import type { HTMLAttributes } from "react";

// The page background (#F8FAFC) sits 3-7 points away from the card white, which is
// invisible on the LCD panels in the iPhone 11 / XR / SE line. The hairline ring gives
// cards an edge on those screens while staying near-invisible on OLED, so the look is
// unchanged on newer devices. Rings are box-shadow based, so this costs zero layout.

export default function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-2xl bg-card p-4 shadow-card ring-1 ring-[#1F2937]/[0.07] animate-card-fade ${className}`} {...props} />
  );
}
