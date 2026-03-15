import type { HTMLAttributes } from "react";

export default function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-2xl bg-card p-4 shadow-card animate-card-fade ${className}`} {...props} />
  );
}
