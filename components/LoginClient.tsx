"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { LOCAL_MODE } from "../lib/config";

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
      setStatus("Couldn't sign in. Check your details.");
      setSubmitting(false);
      return;
    }
    setStatus("");
    if (LOCAL_MODE) router.replace("/");
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
      setStatus(result.error);
      setSubmitting(false);
      return;
    }
    setStatus("");
    router.replace("/");
  };

  const handleSendCode = async () => {
    if (!email) { setStatus("Enter your email first."); return; }
    setSubmitting(true);
    const result = await sendPasswordOtp(email.trim());
    if (result.error) {
      setStatus("Couldn't send code. Try again.");
      setSubmitting(false);
      return;
    }
    setStatus("Code sent. Check your email.");
    setSubmitting(false);
    setMode("reset");
  };

  const handleResetPassword = async () => {
    if (!email || !otpCode || !password) return;
    if (password !== confirmPassword) { setStatus("Passwords do not match."); return; }
    setSubmitting(true);
    const verify = await verifyPasswordOtp(email.trim(), otpCode.trim());
    if (verify.error) { setStatus("Invalid code. Try again."); setSubmitting(false); return; }
    const updated = await updatePassword(password);
    if (updated.error) { setStatus("Couldn't update password."); setSubmitting(false); return; }
    setStatus("");
    router.replace("/");
  };

  const inputClass = "w-full rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink placeholder:text-muted/40 focus:outline-none focus:ring-1 focus:ring-primary/30";

  const EyeToggle = () => (
    <button
      type="button"
      className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/30 transition active:opacity-60"
      onClick={() => setShowPassword((v) => !v)}
      aria-label={showPassword ? "Hide password" : "Show password"}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {showPassword ? (
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
    </button>
  );

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <div className="mx-auto flex w-full max-w-sm flex-col px-6 flex-1 justify-start pt-16 pb-24">

        {/* Branding */}
        {(mode === "signin" || mode === "forgot") && (
          <div className="flex flex-col items-center mb-10">
            <div className="h-16 w-16 overflow-hidden rounded-2xl border border-ink/10 shadow-sm mb-4">
              <img src="/icon-512.png" alt="WhatYouAte" className="h-full w-full object-cover" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              WhatYouAt<span className="relative inline-block">e
                <span className="absolute -top-1 right-0 translate-x-[10px] text-[9px] font-semibold text-ink/50">AI</span>
              </span>
            </h1>
            <p className="mt-1.5 text-sm text-muted/60">
              {mode === "forgot" ? "We'll send you a reset code." : "Eat Confidently | Feel Better"}
            </p>
          </div>
        )}

        {/* Sign in */}
        {mode === "signin" && (
          <form onSubmit={handleSignIn} className="flex flex-col gap-3">
            <input
              type="email"
              autoComplete="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
            />
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
              />
              <EyeToggle />
            </div>
            {status && <p className="text-xs text-red-500/80">{status}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="mt-1 w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-50"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              className="w-full rounded-xl border border-ink/10 py-3.5 text-sm font-semibold text-ink/70 transition active:opacity-60"
              onClick={() => { setMode("signup"); setStatus(""); }}
            >
              Create account
            </button>
            <button
              type="button"
              className="mt-1 text-center text-xs text-muted/50 underline underline-offset-2 transition active:opacity-60"
              onClick={() => { setMode("forgot"); setStatus(""); }}
            >
              Forgot password?
            </button>
          </form>
        )}

        {/* Sign up */}
        {mode === "signup" && (
          <>
            <div className="mb-7">
              <button
                type="button"
                className="mb-5 flex items-center gap-1.5 text-xs text-muted/50 transition active:opacity-60"
                onClick={() => { setMode("signin"); setStatus(""); }}
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 12L6 8l4-4" />
                </svg>
                Back
              </button>
              <div>
                <h2 className="text-xl font-semibold text-ink">Create account</h2>
                <p className="mt-1 text-sm text-muted/60">Start Your Free Trial!</p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <input
                  type="text"
                  className={inputClass}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                />
                <input
                  type="text"
                  className={inputClass}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                />
              </div>
              <input
                type="email"
                autoComplete="email"
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
              />
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className={inputClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                />
                <EyeToggle />
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className={inputClass}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                />
                <EyeToggle />
              </div>
              {status && <p className="text-xs text-red-500/80">{status}</p>}
              <button
                type="button"
                className="mt-1 w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-50"
                onClick={handleSignUp}
                disabled={submitting}
              >
                {submitting ? "Creating account…" : "Create account"}
              </button>
              <p className="text-center text-[11px] text-muted/40 leading-relaxed">
                By creating an account you agree to our{" "}
                <a href="/privacy" className="underline underline-offset-2">
                  Privacy Policy and Terms of Use
                </a>
              </p>
            </div>
          </>
        )}

        {/* Forgot password */}
        {mode === "forgot" && (
          <div className="flex flex-col gap-3">
            <input
              type="email"
              autoComplete="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
            />
            {status && <p className="text-xs text-muted/60">{status}</p>}
            <button
              type="button"
              className="mt-1 w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-50"
              onClick={handleSendCode}
              disabled={submitting}
            >
              {submitting ? "Sending…" : "Send reset code"}
            </button>
            <button
              type="button"
              className="w-full rounded-xl border border-ink/10 py-3.5 text-sm font-semibold text-ink/70 transition active:opacity-60"
              onClick={() => { setMode("signin"); setStatus(""); }}
            >
              Back to sign in
            </button>
          </div>
        )}

        {/* Reset password */}
        {mode === "reset" && (
          <>
            <div className="mb-7">
              <h2 className="text-xl font-semibold text-ink">New password</h2>
              <p className="mt-1 text-sm text-muted/60">Enter the code we sent to {email}.</p>
            </div>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                className={inputClass}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="Reset code"
              />
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className={inputClass}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                />
                <EyeToggle />
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className={inputClass}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                />
                <EyeToggle />
              </div>
              {status && <p className="text-xs text-red-500/80">{status}</p>}
              <button
                type="button"
                className="mt-1 w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-50"
                onClick={handleResetPassword}
                disabled={submitting}
              >
                {submitting ? "Saving…" : "Set new password"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
