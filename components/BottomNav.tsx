"use client";

import Link from "next/link";

export default function BottomNav({ current }: { current: "home" | "summary" | "profile" }) {
  const item = (href: string, label: string, key: string) => (
    <Link
      href={href}
      data-tour={key === "summary" ? "nav-summary" : undefined}
      className={`relative flex-1 rounded-xl px-3 py-2 text-center text-sm font-medium transition-colors ${
        current === key
          ? "bg-white text-ink shadow-[0_10px_20px_rgba(15,23,42,0.08)]"
          : "text-muted/70 hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <nav className="sticky bottom-0 left-0 right-0 border-t border-ink/5 bg-surface/95 backdrop-blur safe-bottom">
      <div className="mx-auto max-w-md px-4 py-3">
        <div className="flex gap-2 rounded-2xl bg-ink/5 p-1">
          {item("/", "Home", "home")}
          {item("/summary", "Insights", "summary")}
          {item("/summary/insights", "Patterns", "profile")}
        </div>
      </div>
    </nav>
  );
}
