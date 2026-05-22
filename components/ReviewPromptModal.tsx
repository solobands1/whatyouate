"use client";

import { useEffect, useState } from "react";
import { AppReview } from "@capawesome/capacitor-app-review";
import { useAuth } from "./AuthProvider";
import { useAppData } from "./AppDataProvider";
import {
  recordReviewShown,
  recordReviewResponse,
  markPromptDone,
  type PromptKey,
} from "../lib/reviewPrompt";

export const REVIEW_EVENT = "wya_show_review";

export function openReviewPrompt(key: PromptKey | null = null) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(REVIEW_EVENT, { detail: { key } }));
  }
}

export default function ReviewPromptModal() {
  const { user } = useAuth();
  const { profile } = useAppData();
  const [open, setOpen] = useState(false);
  const [promptKey, setPromptKey] = useState<PromptKey | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const key = (e as CustomEvent<{ key: PromptKey | null }>).detail?.key ?? null;
      setPromptKey(key);
      setOpen(true);
      setShowFeedback(false);
      setFeedbackText("");
      setFeedbackStatus("idle");
      setFeedbackError(null);
      recordReviewShown();
      if (key) markPromptDone(key);
    };
    window.addEventListener(REVIEW_EVENT, handler);
    return () => window.removeEventListener(REVIEW_EVENT, handler);
  }, []);

  if (!open && !showFeedback) return null;

  const firstName = profile?.firstName ?? "";
  const lastName  = profile?.lastName  ?? "";
  const name = [firstName, lastName].filter(Boolean).join(" ");

  const handleYes = async () => {
    setOpen(false);
    recordReviewResponse("yes");
    try { await AppReview.requestReview(); } catch { /* no-op on web */ }
  };

  const handleNo = () => {
    setOpen(false);
    setShowFeedback(true);
  };

  const handleFeedbackSubmit = async () => {
    if (!user) return;
    setFeedbackStatus("sending");
    setFeedbackError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: feedbackText.trim(),
          userId: user.id,
          email: user.email ?? null,
          name,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFeedbackError(data?.error ?? "Failed to send feedback");
        setFeedbackStatus("idle");
        return;
      }
      setFeedbackStatus("sent");
      recordReviewResponse("no");
      setTimeout(() => { setShowFeedback(false); setFeedbackText(""); setFeedbackStatus("idle"); }, 2000);
    } catch {
      setFeedbackError("Failed to send feedback");
      setFeedbackStatus("idle");
    }
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <button
              type="button"
              className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-ink/8 text-ink/40"
              onClick={() => setOpen(false)}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
            <div className="flex flex-col items-center text-center">
              <div className="mb-3 h-12 w-12 overflow-hidden rounded-[14px] border border-ink/10 shadow-sm">
                <img src="/icon-512.png" alt="WhatYouAte" className="h-full w-full object-cover" />
              </div>
              <h2 className="text-lg font-semibold text-ink">Are You Enjoying WhatYouAte?</h2>
              <p className="mt-1.5 text-sm text-muted/70">We'd love to know how it's going for you.</p>
              <div className="mt-5 flex w-full flex-col gap-2.5">
                <button
                  type="button"
                  className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white transition active:opacity-80"
                  onClick={handleYes}
                >
                  Yes, I love it!
                </button>
                <button
                  type="button"
                  className="w-full rounded-xl border border-ink/10 bg-white py-3 text-sm font-semibold text-ink/70 transition active:opacity-80"
                  onClick={handleNo}
                >
                  Not really
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showFeedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink">Tell Us What's Going On</h2>
            <p className="mt-2 text-sm text-muted/70">
              We're sorry to hear that. Share what feels off and we'll do our best to make it better.
            </p>
            <textarea
              className="mt-4 h-28 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink/90"
              placeholder="What could we improve?"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
            />
            {feedbackError && <p className="mt-2 text-xs text-muted/70">{feedbackError}</p>}
            {feedbackStatus === "sent" && (
              <p className="mt-2 text-xs text-primary">Thanks for your feedback!</p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => { setShowFeedback(false); setFeedbackText(""); setFeedbackStatus("idle"); setFeedbackError(null); }}
                disabled={feedbackStatus === "sending"}
              >
                Close
              </button>
              <button
                type="button"
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
                disabled={feedbackStatus === "sending" || feedbackText.trim().length === 0}
                onClick={handleFeedbackSubmit}
              >
                {feedbackStatus === "sending" ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
