"use client";

import { useEffect, useState } from "react";

export default function BetaLandingPage() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installAvailable, setInstallAvailable] = useState(false);
  const [unlockedMessage, setUnlockedMessage] = useState("");

  const betaPassword = process.env.NEXT_PUBLIC_BETA_PASSWORD ?? "";
  useEffect(() => {
    const handler = (event: any) => {
      event.preventDefault();
      setInstallPrompt(event);
      setInstallAvailable(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => {
      setInstallPrompt(null);
      setInstallAvailable(false);
    });
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleUnlock = () => {
    if (!betaPassword || password.trim() !== betaPassword) {
      setError("Incorrect password.");
      setUnlockedMessage("");
      setUnlocked(false);
      return;
    }
    setError("");
    setUnlocked(true);
    setUnlockedMessage("Unlocked. You can install the web app now.");
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    setInstallAvailable(false);
  };

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center px-6 pb-20 pt-14 text-center">
        <div className="inline-flex items-center rounded-full bg-primary/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
          Beta
        </div>
        <h1 className="mt-4 text-3xl font-semibold text-ink">
          WhatYouAt<span className="relative inline-block">
            e
            <span className="absolute -top-1 right-0 translate-x-[10px] text-[11px] font-semibold text-ink/60">
              AI
            </span>
          </span>
        </h1>
        <p className="mt-2 text-sm text-muted/70">
          Take photos, get nudges, improve.
        </p>

        <div className="mt-8 flex flex-col items-center">
          <div className="h-24 w-24 overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-sm">
            <img src="/icon-512.png" alt="App icon" className="h-full w-full object-cover" />
          </div>
        </div>

        <div className="mt-6 w-full space-y-3">
          <button
            type="button"
            onClick={handleInstall}
            disabled={!installAvailable || !unlocked}
            className={`block w-full rounded-xl px-4 py-3 text-sm font-semibold transition ${
              installAvailable && unlocked
                ? "bg-ink text-white hover:bg-ink/90"
                : "bg-ink/30 text-white/70"
            }`}
          >
            Install Web App
          </button>
          <p className="text-[11px] text-muted/60">
            On iPhone: Share → Add to Home Screen.
          </p>
        </div>

        <div className="mt-6 w-full">
          <label className="block text-left text-[11px] font-semibold uppercase tracking-wide text-muted/60">
            Input password to unlock beta download
          </label>
          <div className="mt-2 flex gap-2">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 focus:outline-none"
              placeholder="Password"
            />
            <button
              type="button"
              onClick={handleUnlock}
              className="rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-white transition hover:bg-ink/90"
            >
              Unlock
            </button>
          </div>
          {error && <p className="mt-2 text-left text-[11px] text-red-500">{error}</p>}
          {unlockedMessage && (
            <p className="mt-2 text-left text-[11px] text-emerald-600">{unlockedMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}
