import type { HTMLAttributes } from "react";

export default function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-2xl bg-card p-4 shadow-card opacity-0 animate-card-fade ${className}`} {...props} />
  );
}
