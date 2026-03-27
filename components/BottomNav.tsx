"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function checkUnseen() {
  const nudgeTs = parseInt(localStorage.getItem("wya_nudge_ts") ?? "0");
  const seenTs = parseInt(localStorage.getItem("wya_nudge_seen_ts") ?? "0");
  return nudgeTs > seenTs;
}

export default function BottomNav({ current }: { current: "home" | "summary" | "profile" }) {
  const [hasUnseenNudge, setHasUnseenNudge] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setHasUnseenNudge(checkUnseen());
    const handler = () => setHasUnseenNudge(checkUnseen());
    window.addEventListener("wya_nudge_update", handler);
    return () => window.removeEventListener("wya_nudge_update", handler);
  }, []);

  const item = (href: string, label: string, key: string) => {
    const showBell = key === "summary" && hasUnseenNudge;
    const isActive = current === key;
    return (
      <button
        data-tour={key === "summary" ? "nav-summary" : undefined}
        className={`relative flex-1 rounded-xl px-3 py-2 text-center text-sm font-medium transition-colors ${
          isActive
            ? "bg-white text-ink shadow-[0_10px_20px_rgba(15,23,42,0.08)]"
            : "text-muted/70"
        }`}
        onPointerDown={() => { if (!isActive) router.push(href); }}
      >
        {label}
        {showBell && (
          <span className="absolute right-2 top-1.5 flex h-2 w-2 items-center justify-center rounded-full bg-primary" />
        )}
      </button>
    );
  };

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
