"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
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

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email || !password) return;
    const result = await signInWithEmailPassword(email.trim(), password);
    if (result.error) {
      setStatus("Couldn’t sign in. Check your details.");
      return;
    }
    setStatus("");
  };

  const handleSignUp = async () => {
    if (!email || !password) return;
    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }
    const result = await signUpWithEmailPassword(email.trim(), password, {
      firstName: firstName.trim(),
      lastName: lastName.trim()
    });
    if (result.error) {
      console.error("SIGNUP ERROR:", result.error);
      setStatus(result.error);
      return;
    }
    setStatus("Account created. You can sign in.");
    setMode("signin");
  };

  const handleSendCode = async () => {
    if (!email) {
      setStatus("Enter your email first.");
      return;
    }
    const result = await sendPasswordOtp(email.trim());
    if (result.error) {
      setStatus("Couldn’t send code. Try again.");
      return;
    }
    setStatus("Code sent. Check your email.");
    setMode("reset");
  };

  const handleResetPassword = async () => {
    if (!email || !otpCode || !password) return;
    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return;
    }
    const verify = await verifyPasswordOtp(email.trim(), otpCode.trim());
    if (verify.error) {
      setStatus("Invalid code. Try again.");
      return;
    }
    const updated = await updatePassword(password);
    if (updated.error) {
      setStatus("Couldn’t update password.");
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
                      className="text-xs font-semibold text-ink/60"
                      onClick={() => setShowPassword((prev) => !prev)}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>
                <button
                  type="submit"
                  className="mt-4 w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white"
                >
                  Sign in
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
                    />
                    <button
                      type="button"
                      className="text-xs font-semibold text-ink/60"
                      onClick={() => setShowPassword((prev) => !prev)}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>
                <label className="mt-3 block text-xs text-muted/70">
                  Confirm password
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="••••••••"
                  />
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
                  className="w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white"
                  onClick={handleSignUp}
                >
                  Create account
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
                className="mt-4 w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white"
                onClick={handleSendCode}
              >
                Send code
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
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                  />
                </label>
                <label className="mt-3 block text-xs text-muted/70">
                  Confirm password
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="••••••••"
                  />
                </label>
              </div>
              <button
                type="button"
                className="mt-4 w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white"
                onClick={handleResetPassword}
              >
                Create new password
              </button>
            </>
          )}
          {status && <p className="mt-3 text-xs text-muted/70">{status}</p>}
        </Card>
      </div>
    </div>
  );
}
