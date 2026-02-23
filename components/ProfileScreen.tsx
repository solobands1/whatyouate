"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Joyride, { STATUS, CallBackProps, type Step } from "react-joyride";
import type { GoalDirection, Units, UserProfile } from "../lib/types";
import { clearAllData, exportAllData, getProfile } from "../lib/supabaseDb";
import { supabase } from "../lib/supabaseClient";
import BottomNav from "./BottomNav";
import Card from "./Card";
import { useAuth } from "./AuthProvider";

const goals: GoalDirection[] = ["gain", "maintain", "balance", "lose"];

export default function ProfileScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, signOut } = useAuth();
  const profileExistsRef = useRef(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [weight, setWeight] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<UserProfile["sex"]>("prefer_not");
  const [goalDirection, setGoalDirection] = useState<GoalDirection>("maintain");
  const [bodyPriority, setBodyPriority] = useState("");
  const [units, setUnits] = useState<Units>("metric");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runProfileTour, setRunProfileTour] = useState(false);
  const [showGoalInfo, setShowGoalInfo] = useState(false);
  const [showBodyInfo, setShowBodyInfo] = useState(false);
  const [showProfilePrompt, setShowProfilePrompt] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [showFeedbackToast, setShowFeedbackToast] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    setLoadError(null);
    const walkthroughKey = `wya_walkthrough_profile_${user.id}`;
    if (localStorage.getItem(walkthroughKey)) {
      const timer = window.setTimeout(() => setRunProfileTour(true), 150);
      return () => window.clearTimeout(timer);
    }
    getProfile(user.id)
      .then((data) => {
        if (data) {
          profileExistsRef.current = true;
          setFirstName(data.firstName ?? "");
          setLastName(data.lastName ?? "");
          setSex(data.sex ?? "prefer_not");
          setGoalDirection(data.goalDirection ?? "maintain");
          setBodyPriority(data.bodyPriority ?? "");
          setUnits(data.units ?? "metric");

          if ((data.units ?? "metric") === "imperial") {
            const cm = data.height ?? null;
            if (cm != null) {
              const inchesTotal = cm / 2.54;
              const ft = Math.floor(inchesTotal / 12);
              const inch = Math.round(inchesTotal % 12);
              setHeightFt(String(ft));
              setHeightIn(String(inch));
              setHeightCm("");
            } else {
              setHeightFt("");
              setHeightIn("");
              setHeightCm("");
            }

            const kg = data.weight ?? null;
            if (kg != null) {
              const lb = Math.round(kg * 2.20462);
              setWeight(String(lb));
            } else {
              setWeight("");
            }
          } else {
            setHeightCm(data.height != null ? String(data.height) : "");
            setHeightFt("");
            setHeightIn("");
            setWeight(data.weight != null ? String(data.weight) : "");
          }

          setAge(data.age != null ? String(data.age) : "");
        } else {
          profileExistsRef.current = false;
          const meta = (user as { user_metadata?: Record<string, string> }).user_metadata ?? {};
          setFirstName(meta.first_name ?? "");
          setLastName(meta.last_name ?? "");
        }
      })
      .catch(() => {
        setLoadError("Couldn’t load profile.");
      });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (searchParams.get("simulateProfilePrompt") !== "1") return;
    const updatedKey = `wya_profile_updated_${user.id}`;
    const openedKey = `wya_profile_prompt_opened_${user.id}`;
    const lastPromptKey = `wya_profile_prompt_last_${user.id}`;
    const simulateKey = `wya_profile_prompt_sim_${user.id}`;
    const ninetyOneDays = 91 * 24 * 60 * 60 * 1000;
    localStorage.setItem(updatedKey, String(Date.now() - ninetyOneDays));
    localStorage.removeItem(openedKey);
    localStorage.removeItem(lastPromptKey);
    localStorage.setItem(simulateKey, "true");
  }, [user, searchParams]);

  useEffect(() => {
    if (!user) return;
    const updatedKey = `wya_profile_updated_${user.id}`;
    const openedKey = `wya_profile_prompt_opened_${user.id}`;
    const lastPromptKey = `wya_profile_prompt_last_${user.id}`;
    const updatedAt = Number(localStorage.getItem(updatedKey) ?? 0);
    if (!updatedAt) return;
    const now = Date.now();
    const threeMonths = 90 * 24 * 60 * 60 * 1000;
    const due = now - updatedAt >= threeMonths;
    if (!due) return;
    const lastPromptAt = Number(localStorage.getItem(lastPromptKey) ?? 0);
    if (lastPromptAt && now - lastPromptAt < threeMonths) return;
    const openedAt = Number(localStorage.getItem(openedKey) ?? 0);
    if (openedAt) {
      const twentyFourHours = 24 * 60 * 60 * 1000;
      if (now - openedAt < twentyFourHours) {
        setShowProfilePrompt(true);
      }
    }
  }, [user]);

  useEffect(() => {
    const handler = () => {
      setShowProfilePrompt(true);
    };
    window.addEventListener("profile-prompt-opened", handler as EventListener);
    return () => window.removeEventListener("profile-prompt-opened", handler as EventListener);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted">
        Loading…
      </div>
    );
  }

  if (!user) return null;

  const profileTourSteps: Step[] = [
    {
      target: '[data-tour="feedback-button"]',
      content: "Send feedback any time. It helps us improve."
    },
    {
      target: '[data-tour="profile-header"]',
      content: "Fill out your profile then take your first food photo or log your first workout to get started!"
    }
  ];

  const handleProfileTour = (data: CallBackProps) => {
    const finished = data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED;
    if (!finished || !user) return;
    localStorage.removeItem(`wya_walkthrough_profile_${user.id}`);
    setRunProfileTour(false);
  };

  const parseInteger = (value: string) => {
    if (!value.trim()) return null;
    const num = Number.parseInt(value, 10);
    return Number.isFinite(num) ? num : null;
  };

  const handleSave = async () => {
    if (!user) return;
    try {
      setSaving(true);
      const parsedAge = parseInteger(age);

      let parsedHeightCm: number | null = null;
      let parsedWeightKg: number | null = null;

      if (units === "metric") {
        parsedHeightCm = parseInteger(heightCm);
        parsedWeightKg = parseInteger(weight);
      } else {
        const ft = parseInteger(heightFt) ?? 0;
        const inch = parseInteger(heightIn) ?? 0;
        const totalIn = ft * 12 + inch;
        parsedHeightCm = totalIn > 0 ? Math.round(totalIn * 2.54) : null;

        const lb = parseInteger(weight) ?? 0;
        parsedWeightKg = lb > 0 ? Math.round(lb / 2.20462) : null;
      }

      const payload = {
        user_id: user.id,
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        height: parsedHeightCm ?? null,
        weight: parsedWeightKg ?? null,
        age: parsedAge ?? null,
        sex,
        goal_direction: goalDirection,
        body_priority: bodyPriority || null,
        units
      };

      if (profileExistsRef.current) {
        const { error } = await supabase.from("profiles").update(payload).eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("profiles").insert(payload);
        if (error) throw error;
      }

      const freshProfile = await getProfile(user.id);
      if (freshProfile) {
        profileExistsRef.current = true;
        setFirstName(freshProfile.firstName ?? "");
        setLastName(freshProfile.lastName ?? "");
        setSex(freshProfile.sex ?? "prefer_not");
        setGoalDirection(freshProfile.goalDirection ?? "maintain");
        setBodyPriority(freshProfile.bodyPriority ?? "");
        setUnits(freshProfile.units ?? "metric");

        if ((freshProfile.units ?? "metric") === "imperial") {
          const cm = freshProfile.height ?? null;
          if (cm != null) {
            const inchesTotal = cm / 2.54;
            const ft = Math.floor(inchesTotal / 12);
            const inch = Math.round(inchesTotal % 12);
            setHeightFt(String(ft));
            setHeightIn(String(inch));
            setHeightCm("");
          } else {
            setHeightFt("");
            setHeightIn("");
            setHeightCm("");
          }

          const kg = freshProfile.weight ?? null;
          if (kg != null) {
            const lb = Math.round(kg * 2.20462);
            setWeight(String(lb));
          } else {
            setWeight("");
          }
        } else {
          setHeightCm(freshProfile.height != null ? String(freshProfile.height) : "");
          setHeightFt("");
          setHeightIn("");
          setWeight(freshProfile.weight != null ? String(freshProfile.weight) : "");
        }

        setAge(freshProfile.age != null ? String(freshProfile.age) : "");
      }

      setStatus("Saved.");
      if (user) {
        localStorage.setItem(`wya_profile_updated_${user.id}`, String(Date.now()));
        localStorage.removeItem(`wya_profile_prompt_opened_${user.id}`);
        localStorage.removeItem(`wya_profile_prompt_last_${user.id}`);
      }
      window.dispatchEvent(new CustomEvent("profile-updated"));
      setTimeout(() => {
        setStatus(null);
      }, 1500);
    } catch {
      setStatus("Couldn’t save.");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    const data = await exportAllData(user.id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "what-you-ate-export.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = async () => {
    if (!confirm("Clear all data? This cannot be undone.")) return;
    await clearAllData(user.id);
    profileExistsRef.current = false;
    setFirstName("");
    setLastName("");
    setHeightCm("");
    setHeightFt("");
    setHeightIn("");
    setWeight("");
    setAge("");
    setSex("prefer_not");
    setGoalDirection("maintain");
    setBodyPriority("");
    setUnits("metric");
    setStatus("All data cleared.");
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  const handleDeleteAccount = async () => {
    if (!confirm("Delete your account and all data? This cannot be undone.")) return;
    if (!user) return;
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      setStatus("Couldn’t delete account.");
      return;
    }
    const response = await fetch("/api/delete-account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ userId: user.id })
    });
    if (!response.ok) {
      setStatus("Couldn’t delete account.");
      return;
    }
    await signOut();
    router.replace("/login");
  };

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 pt-8">
        <Joyride
          steps={profileTourSteps}
          run={runProfileTour}
          continuous
          showSkipButton
          hideCloseButton
          scrollToFirstStep
          callback={handleProfileTour}
          locale={{
            skip: "Skip",
            last: "Done",
            back: "Back",
            close: "Skip"
          }}
          styles={{
            options: {
              primaryColor: "#6FA8FF",
              textColor: "#1F2937",
              backgroundColor: "#FFFFFF",
              arrowColor: "#FFFFFF"
            },
            buttonClose: {
              display: "none"
            },
            buttonSkip: {
              display: "block"
            }
          }}
        />
        <header className="mb-4" data-tour="profile-header">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-ink">Profile</h1>
              <p className="mt-1 text-sm text-muted/70">
                {[firstName, lastName].filter(Boolean).join(" ") || "Profile"}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-ink/10 px-2.5 py-0.5 text-[10px] font-medium text-muted/60"
                  onClick={() => {
                    if (!user) return;
                    localStorage.removeItem(`wya_walkthrough_${user.id}`);
                    router.push("/");
                  }}
                >
                  Walkthrough
                </button>
                <button
                  type="button"
                  data-tour="feedback-button"
                  className="rounded-full bg-primary px-3 py-1 text-[10px] font-semibold text-white transition hover:bg-primary/90"
                  onClick={() => setShowFeedback(true)}
                >
                  Send Feedback
                </button>
              </div>
              <span className="text-[10px] text-muted/60">Share a quick suggestion</span>
            </div>
          </div>
          {loadError && <p className="mt-2 text-xs text-muted/70">{loadError}</p>}
        </header>

        <Card className="mt-4">
          <div>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted/70">Body</p>
              <div className="inline-flex rounded-full border border-ink/10 bg-ink/5 p-0.5 text-[10px]">
                {(["metric", "imperial"] as Units[]).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    className={`rounded-full px-2.5 py-0.5 font-medium ${
                      units === unit ? "bg-white text-ink" : "text-muted/60"
                    }`}
                    onClick={() => {
                      if (unit === units) return;

                      if (unit === "imperial") {
                        const cmVal = parseInt(heightCm || "0", 10);
                        if (!isNaN(cmVal) && cmVal > 0) {
                          const inchesTotal = cmVal / 2.54;
                          const ft = Math.floor(inchesTotal / 12);
                          const inch = Math.round(inchesTotal % 12);
                          setHeightFt(String(ft));
                          setHeightIn(String(inch));
                        }

                        const kgVal = parseInt(weight || "0", 10);
                        if (!isNaN(kgVal) && kgVal > 0) {
                          setWeight(String(Math.round(kgVal * 2.20462)));
                        }
                      } else {
                        const ftVal = parseInt(heightFt || "0", 10);
                        const inVal = parseInt(heightIn || "0", 10);
                        const totalIn = ftVal * 12 + inVal;

                        if (totalIn > 0) {
                          setHeightCm(String(Math.round(totalIn * 2.54)));
                        }

                        const lbVal = parseInt(weight || "0", 10);
                        if (!isNaN(lbVal) && lbVal > 0) {
                          setWeight(String(Math.round(lbVal / 2.20462)));
                        }
                      }

                      setUnits(unit);
                    }}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-7 grid grid-cols-2 gap-x-5 gap-y-7">
              <label className="text-[11px] text-muted/70">
                Height {units === "metric" ? "(cm)" : "(ft + in)"}
                {units === "metric" ? (
                  <input
                    inputMode="numeric"
                    className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                    value={heightCm}
                    onChange={(event) => {
                      const raw = event.target.value.replace(/[^0-9]/g, "");
                      const cleaned = raw.replace(/^0+(?=\d)/, "");
                      setHeightCm(cleaned);
                    }}
                    placeholder="cm"
                  />
                ) : (
                  <div className="mt-1 flex gap-2">
                    <input
                      inputMode="numeric"
                      className="w-[45%] rounded-xl border border-ink/10 px-3 py-2 text-sm"
                      value={heightFt}
                      onChange={(event) => {
                        const raw = event.target.value.replace(/[^0-9]/g, "");
                        let cleaned = raw.replace(/^0+(?=\d)/, "");
                        let num = parseInt(cleaned || "0", 10);

                        if (num > 8) num = 8;
                        if (num < 0) num = 0;

                        setHeightFt(String(num));
                      }}
                      placeholder="ft"
                    />
                    <input
                      inputMode="numeric"
                      className="w-[55%] rounded-xl border border-ink/10 px-3 py-2 text-sm"
                      value={heightIn}
                      onChange={(event) => {
                        const raw = event.target.value.replace(/[^0-9]/g, "");
                        let cleaned = raw.replace(/^0+(?=\d)/, "");
                        let num = parseInt(cleaned || "0", 10);

                        if (num > 11) num = 11;
                        if (num < 0) num = 0;

                        setHeightIn(String(num));
                      }}
                      placeholder="in"
                    />
                  </div>
                )}
              </label>
              <label className="text-[11px] text-muted/70">
                Weight ({units === "metric" ? "kg" : "lb"})
                <input
                  inputMode="numeric"
                  className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                  value={weight}
                  onChange={(event) => {
                    const raw = event.target.value.replace(/[^0-9]/g, "");
                    const cleaned = raw.replace(/^0+(?=\d)/, "");
                    setWeight(cleaned);
                  }}
                  placeholder={units === "metric" ? "kg" : "lb"}
                />
              </label>
              <label className="text-[11px] text-muted/70">
                Age
                <input
                  inputMode="numeric"
                  className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                  value={age}
                  onChange={(event) => {
                    const raw = event.target.value.replace(/[^0-9]/g, "");
                    const cleaned = raw.replace(/^0+(?=\d)/, "");
                    setAge(cleaned);
                  }}
                  placeholder="Age"
                />
              </label>
              <label className="text-[11px] text-muted/70">
                Sex
                <select
                  className="mt-1 w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-sm"
                  value={sex}
                  onChange={(event) => setSex(event.target.value as UserProfile["sex"])}
                >
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                  <option value="prefer_not">Prefer not</option>
                </select>
              </label>
            </div>
          </div>

          <label className="mt-8 block border-t border-ink/5 pt-7 text-xs text-muted/70">
            <span className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/70">
                Goal direction
              </span>
              <button
                type="button"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-ink/10 text-[10px] font-semibold text-ink/60"
                onClick={() => setShowGoalInfo(true)}
                aria-label="About goal direction"
              >
                i
              </button>
            </span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {goals.map((goal) => (
                <button
                  key={goal}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${
                    goalDirection === goal ? "border-primary/30 bg-primary/10 text-ink/80" : "border-ink/10 text-muted/70"
                  }`}
                  onClick={() => setGoalDirection(goal)}
                  type="button"
                >
                  {goal}
                </button>
              ))}
            </div>
          </label>

          <label className="mt-8 block border-t border-ink/5 pt-7 text-xs text-muted/70">
            <span className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/70">
                Focus area (optional)
              </span>
              <button
                type="button"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-ink/10 text-[10px] font-semibold text-ink/60"
                onClick={() => setShowBodyInfo(true)}
                aria-label="About body focus"
              >
                i
              </button>
            </span>
            <input
              type="text"
              className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              value={bodyPriority}
              onChange={(event) => setBodyPriority(event.target.value)}
              placeholder="e.g., lose belly fat, feel better, gain muscle"
            />
          </label>

          <button
            className="mt-7 w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] ring-1 ring-white/40 transition-colors hover:bg-primary/90"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {status && <p className="mt-2 text-xs text-muted">{status}</p>}
        </Card>

        <Card className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Advanced</p>
          <button
            className="mt-3 w-full rounded-xl bg-ink/5 px-4 py-2.5 text-xs font-semibold text-ink/80"
            onClick={handleSignOut}
          >
            Log out
          </button>
          <button
            className="mt-3 w-full rounded-xl bg-ink/5 px-4 py-2.5 text-xs font-semibold text-ink/80"
            onClick={handleExport}
          >
            Export JSON
          </button>
          <button
            className="mt-3 w-full rounded-xl border border-ink/10 px-4 py-2.5 text-xs font-semibold text-muted/70"
            onClick={handleClear}
          >
            Clear All Data - Start Fresh
          </button>
          <button
            className="mt-3 w-full rounded-xl border border-ink/10 px-4 py-2.5 text-xs font-semibold text-muted/70"
            onClick={handleDeleteAccount}
          >
            Delete account
          </button>
        </Card>
      </div>

      <BottomNav current="profile" />

      {showGoalInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-ink">Goal direction</p>
                <p className="mt-2 text-sm text-muted/70">
                  This sets a gentle direction for your ranges and nudges. It’s not a strict plan—just
                  a soft bias based on what you want. Everything is tuned to help improve nutrients and
                  how you feel over time while moving toward your direction.
                </p>
                <div className="mt-3 space-y-2 text-xs text-muted/70">
                  <p>
                    <span className="font-semibold text-ink/70">Gain:</span> nudge upward over time,
                    with slightly higher intake and protein.
                  </p>
                  <p>
                    <span className="font-semibold text-ink/70">Maintain:</span> keep intake close to
                    your current pattern with small adjustments for balance.
                  </p>
                  <p>
                    <span className="font-semibold text-ink/70">Balance:</span> aim to build strength
                    while staying near your current weight.
                  </p>
                  <p>
                    <span className="font-semibold text-ink/70">Lose:</span> nudge downward over time,
                    with slightly lower intake.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="text-sm font-semibold text-ink/60"
                onClick={() => setShowGoalInfo(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {showBodyInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-ink">Body focus</p>
                <p className="mt-2 text-sm text-muted/70">
                  This is free‑form. Use it to capture what matters to you—performance, body areas,
                  energy, or how you want to feel. It helps keep nudges aligned with your intent.
                </p>
              </div>
              <button
                type="button"
                className="text-sm font-semibold text-ink/60"
                onClick={() => setShowBodyInfo(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {showProfilePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-ink">Profile update</p>
                <p className="mt-2 text-sm text-muted/70">
                  It’s been about 3 months since your profile was updated. Refresh any details so
                  your goals and nudges stay aligned.
                </p>
              </div>
              <button
                type="button"
                className="text-sm font-semibold text-ink/60"
                onClick={() => {
                  setShowProfilePrompt(false);
                  if (!user) return;
                  const simulateKey = `wya_profile_prompt_sim_${user.id}`;
                  if (localStorage.getItem(simulateKey)) {
                    localStorage.removeItem(simulateKey);
                    localStorage.setItem(`wya_profile_updated_${user.id}`, String(Date.now()));
                    localStorage.removeItem(`wya_profile_prompt_opened_${user.id}`);
                    localStorage.removeItem(`wya_profile_prompt_last_${user.id}`);
                  }
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showFeedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink">Send feedback</h2>
            <p className="mt-2 text-sm text-muted/70">
              Share what feels off, what you want improved, or any ideas for new features.
            </p>
            <textarea
              className="mt-4 h-28 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink/90"
              placeholder="Type your feedback here..."
              value={feedbackText}
              onChange={(event) => setFeedbackText(event.target.value)}
            />
            {feedbackError && <p className="mt-2 text-xs text-muted/70">{feedbackError}</p>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => {
                  setShowFeedback(false);
                  setFeedbackStatus("idle");
                  setFeedbackText("");
                  setFeedbackError(null);
                }}
                disabled={feedbackStatus === "sending"}
              >
                Close
              </button>
              <button
                type="button"
                className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white transition hover:bg-primary/90"
                disabled={feedbackStatus === "sending" || feedbackText.trim().length === 0}
                onClick={async () => {
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
                        name: [firstName, lastName].filter(Boolean).join(" ")
                      })
                    });
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({}));
                      setFeedbackError(data?.error ?? "Failed to send feedback");
                      setFeedbackStatus("idle");
                      return;
                    }
                    setFeedbackStatus("sent");
                    setShowFeedback(false);
                    setFeedbackText("");
                    setShowFeedbackToast(true);
                    setTimeout(() => setShowFeedbackToast(false), 1800);
                  } catch {
                    setFeedbackError("Failed to send feedback");
                    setFeedbackStatus("idle");
                  }
                }}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {showFeedbackToast && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-5">
          <div className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white shadow-lg">
            Thanks for the feedback!
          </div>
        </div>
      )}
    </div>
  );
}
