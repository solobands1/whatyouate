"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { LOCAL_MODE } from "../lib/config";
import Card from "./Card";

export default function LoginClient() {
  const router = useRouter();
  const {
    user,
    loading,
    signInWithEmailPassword,
    signUpWithEmailPassword,
    sendPasswordOtp,
    verifyPasswordOtp,
    updatePassword
  } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "reset">("signin");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const togglePassword = () => setShowPassword((prev) => !prev);

  const EyeIcon = ({ hidden }: { hidden: boolean }) => (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {hidden ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.5 10.5a2.5 2.5 0 0 0 3.5 3.5" />
          <path d="M6.5 6.5C4.2 8.2 2.7 10.4 2 12c2.1 4 6 7 10 7 2 0 4-.6 5.7-1.7" />
          <path d="M9.9 4.3A9.5 9.5 0 0 1 12 4c4 0 7.9 3 10 8-0.6 1.2-1.5 2.4-2.6 3.5" />
        </>
      ) : (
        <>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    const result = await signInWithEmailPassword(email.trim(), password);
    if (result.error) {
      setStatus("Couldn’t sign in. Check your details.");
      setSubmitting(false);
      return;
    }
    setStatus("");
    if (LOCAL_MODE) {
      router.replace("/");
    }
    // Keep submitting=true — navigation will unmount this component
  };

  const handleSignUp = async () => {
    if (!firstName.trim() || !lastName.trim() || !email || !password || !confirmPassword) {
      setStatus("Please fill out all fields.");
      return;
    }
    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const result = await signUpWithEmailPassword(email.trim(), password, {
      firstName: firstName.trim(),
      lastName: lastName.trim()
    });
    if (result.error) {
      console.error("SIGNUP ERROR:", result.error);
      setStatus(result.error);
      setSubmitting(false);
      return;
    }
    setStatus("");
    router.replace("/");
  };

  const handleSendCode = async () => {
    if (!email) {
      setStatus("Enter your email first.");
      return;
    }
    setSubmitting(true);
    const result = await sendPasswordOtp(email.trim());
    if (result.error) {
      setStatus("Couldn’t send code. Try again.");
      setSubmitting(false);
      return;
    }
    setStatus("Code sent. Check your email.");
    setSubmitting(false);
    setMode("reset");
  };

  const handleResetPassword = async () => {
    if (!email || !otpCode || !password) return;
    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const verify = await verifyPasswordOtp(email.trim(), otpCode.trim());
    if (verify.error) {
      setStatus("Invalid code. Try again.");
      setSubmitting(false);
      return;
    }
    const updated = await updatePassword(password);
    if (updated.error) {
      setStatus("Couldn’t update password.");
      setSubmitting(false);
      return;
    }
    setStatus("");
    router.replace("/");
  };

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-20 pt-10">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              WhatYouAt<span className="relative inline-block">e
                <span className="absolute -top-1 right-0 translate-x-[10px] text-[9px] font-semibold text-ink/60">
                  AI
                </span>
              </span>
            </h1>
            <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-semibold text-primary">
              Beta
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted/70">Take photos, get nudges, improve.</p>
        </header>

        <Card>
          {mode === "signin" && (
            <>
              <p className="text-sm text-ink/80">Sign in to continue.</p>
              <form onSubmit={handleSignIn} className="mt-4">
                <label className="text-xs text-muted/70">
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </label>
                <label className="mt-3 block text-xs text-muted/70">
                  Password
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      className="rounded-full border border-ink/10 p-2 text-ink/60"
                      onClick={togglePassword}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      <EyeIcon hidden={showPassword} />
                    </button>
                  </div>
                </label>
                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-4 w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {submitting ? "Signing in…" : "Sign in"}
                </button>
                <button
                  type="button"
                  className="mt-3 w-full rounded-xl border border-ink/10 px-5 py-3 text-sm font-semibold text-ink/80"
                  onClick={() => {
                    setMode("forgot");
                    setStatus("");
                  }}
                >
                  Forgot password
                </button>
                <button
                  type="button"
                  className="mt-3 w-full rounded-xl border border-ink/10 px-5 py-3 text-sm font-semibold text-ink/80"
                  onClick={() => {
                    setMode("signup");
                    setStatus("");
                  }}
                >
                  Create account
                </button>
              </form>
            </>
          )}

          {mode === "signup" && (
            <>
              <p className="text-sm text-ink/80">Create your account.</p>
              <div className="mt-4">
                <label className="text-xs text-muted/70">
                  First name
                  <input
                    type="text"
                    className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder="First name"
                    required
                  />
                </label>
                <label className="mt-3 block text-xs text-muted/70">
                  Last name
                  <input
                    type="text"
                    className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder="Last name"
                    required
                  />
                </label>
                <label className="mt-3 block text-xs text-muted/70">
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </label>
                <label className="mt-3 block text-xs text-muted/70">
                  Password
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      className="rounded-full border border-ink/10 p-2 text-ink/60"
                      onClick={togglePassword}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      <EyeIcon hidden={showPassword} />
                    </button>
                  </div>
                </label>
                <label className="mt-3 block text-xs text-muted/70">
                  Confirm password
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      className="rounded-full border border-ink/10 p-2 text-ink/60"
                      onClick={togglePassword}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      <EyeIcon hidden={showPassword} />
                    </button>
                  </div>
                </label>
              </div>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  className="w-full rounded-xl border border-ink/10 px-5 py-3 text-sm font-semibold text-ink/80"
                  onClick={() => {
                    setMode("signin");
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                  onClick={handleSignUp}
                  disabled={submitting}
                >
                  {submitting ? "Creating account…" : "Create account"}
                </button>
              </div>
            </>
          )}

          {mode === "forgot" && (
            <>
              <p className="text-sm text-ink/80">Reset your password.</p>
              <div className="mt-4">
                <label className="text-xs text-muted/70">
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                  />
                </label>
              </div>
              <button
                type="button"
                className="mt-4 w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleSendCode}
                disabled={submitting}
              >
                {submitting ? "Sending…" : "Send code"}
              </button>
              <button
                type="button"
                className="mt-3 w-full rounded-xl border border-ink/10 px-5 py-3 text-sm font-semibold text-ink/80"
                onClick={() => {
                  setMode("signin");
                  setStatus("");
                }}
              >
                Back to sign in
              </button>
            </>
          )}

          {mode === "reset" && (
            <>
              <p className="text-sm text-ink/80">Enter your code and new password.</p>
              <div className="mt-4">
                <label className="text-xs text-muted/70">
                  Code
                  <input
                    type="text"
                    className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value)}
                    placeholder="Enter code"
                  />
                </label>
                <label className="mt-3 block text-xs text-muted/70">
                  New password
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      className="rounded-full border border-ink/10 p-2 text-ink/60"
                      onClick={togglePassword}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      <EyeIcon hidden={showPassword} />
                    </button>
                  </div>
                </label>
                <label className="mt-3 block text-xs text-muted/70">
                  Confirm password
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      className="rounded-full border border-ink/10 p-2 text-ink/60"
                      onClick={togglePassword}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      <EyeIcon hidden={showPassword} />
                    </button>
                  </div>
                </label>
              </div>
              <button
                type="button"
                className="mt-4 w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                onClick={handleResetPassword}
                disabled={submitting}
              >
                {submitting ? "Saving…" : "Create new password"}
              </button>
            </>
          )}
          {status && <p className="mt-3 text-xs text-muted/70">{status}</p>}
        </Card>
      </div>
    </div>
  );
}
