"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

export default function BottomNav({ current }: { current: "home" | "summary" | "profile" }) {
  const { user } = useAuth();
  const [showProfileBell, setShowProfileBell] = useState(false);

  useEffect(() => {
    if (!user) {
      setShowProfileBell(false);
      return;
    }
    const compute = () => {
      const updatedKey = `wya_profile_updated_${user.id}`;
      const openedKey = `wya_profile_prompt_opened_${user.id}`;
      const lastPromptKey = `wya_profile_prompt_last_${user.id}`;
      const updatedAt = Number(localStorage.getItem(updatedKey) ?? 0);
      if (!updatedAt) {
        setShowProfileBell(false);
        return;
      }
      const now = Date.now();
      const threeMonths = 90 * 24 * 60 * 60 * 1000;
      const due = now - updatedAt >= threeMonths;
      if (!due) {
        setShowProfileBell(false);
        return;
      }
      const lastPromptAt = Number(localStorage.getItem(lastPromptKey) ?? 0);
      if (lastPromptAt && now - lastPromptAt < threeMonths) {
        setShowProfileBell(false);
        return;
      }
      const openedAt = Number(localStorage.getItem(openedKey) ?? 0);
      if (!openedAt) {
        setShowProfileBell(true);
        return;
      }
      setShowProfileBell(false);
    };
    compute();
    const handler = () => compute();
    window.addEventListener("profile-prompt-opened", handler as EventListener);
    window.addEventListener("profile-updated", handler as EventListener);
    return () => {
      window.removeEventListener("profile-prompt-opened", handler as EventListener);
      window.removeEventListener("profile-updated", handler as EventListener);
    };
  }, [user]);

  const item = (href: string, label: string, key: string) => (
    <Link
      href={href}
      data-tour={key === "summary" ? "nav-summary" : key === "profile" ? "nav-profile" : undefined}
      className={`relative flex-1 rounded-xl px-3 py-2 text-center text-sm font-medium transition-colors ${
        current === key
          ? "bg-white text-ink shadow-[0_10px_20px_rgba(15,23,42,0.08)]"
          : "text-muted/70 hover:text-ink"
      }`}
      onClick={() => {
        if (key !== "profile" || !user || !showProfileBell) return;
        const openedKey = `wya_profile_prompt_opened_${user.id}`;
        const lastPromptKey = `wya_profile_prompt_last_${user.id}`;
        const now = Date.now();
        localStorage.setItem(openedKey, String(now));
        localStorage.setItem(lastPromptKey, String(now));
        setShowProfileBell(false);
        window.dispatchEvent(new CustomEvent("profile-prompt-opened"));
      }}
    >
      {label}
      {key === "profile" && showProfileBell && (
        <span className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-primary/40 bg-primary text-[9px] text-white animate-pulse shadow-[0_4px_10px_rgba(15,23,42,0.18)]">
          <svg
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" />
            <path d="M9 17a3 3 0 0 0 6 0" />
          </svg>
        </span>
      )}
    </Link>
  );

  return (
    <nav className="sticky bottom-0 left-0 right-0 border-t border-ink/5 bg-surface/95 backdrop-blur safe-bottom">
      <div className="mx-auto max-w-md px-4 py-3">
        <div className="flex gap-2 rounded-2xl bg-ink/5 p-1">
          {item("/", "Home", "home")}
          {item("/summary", "Summary", "summary")}
          {item("/profile", "Profile", "profile")}
        </div>
      </div>
    </nav>
  );
}
