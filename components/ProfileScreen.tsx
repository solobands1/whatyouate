"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Joyride, { STATUS, CallBackProps, type Step } from "react-joyride";
import { notifyProfileUpdated } from "../lib/dataEvents";
import type { ActivityLevel, GoalDirection, SupplementEntry, SupplementNutrient, Units, UserProfile } from "../lib/types";
import { suppLabel, suppName } from "../lib/types";
import { matchSupplementNutrients, NUTRIENT_UNITS, NUTRIENT_DISPLAY_NAMES } from "../lib/rda";
import { clearAllData, getProfile, saveProfile, saveDailySupplements, LOCAL_MODE } from "../lib/supabaseDb";
import { getDailySupplements, setDailySupplements, clearDailySuppsLoggedToday } from "../lib/foodCache";
import { clearMealsCache } from "../lib/supabaseDb";
import { notifyMealsUpdated } from "../lib/dataEvents";
import { supabase } from "../lib/supabaseClient";
import BottomNav from "./BottomNav";
import Card from "./Card";
import { useAuth } from "./AuthProvider";

const goals: { value: GoalDirection; label: string }[] = [
  { value: "gain", label: "Gain weight" },
  { value: "maintain", label: "Stay steady" },
  { value: "lose", label: "Lose weight" },
];

export default function ProfileScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, signOut } = useAuth();
  const profileExistsRef = useRef(false);
  const [mounted, setMounted] = useState(false);

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
  const [freeformFocus, setFreeformFocus] = useState("");
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | "">("");
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [units, setUnits] = useState<Units>("imperial");
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [savingName, setSavingName] = useState(false);
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
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [dailySupplements, setDailySupplementsState] = useState<SupplementEntry[]>([]);
  const [newSuppInput, setNewSuppInput] = useState("");
  const [newSuppDose, setNewSuppDose] = useState("");
  const [newSuppUnit, setNewSuppUnit] = useState("mg");
  const [suppMatchHint, setSuppMatchHint] = useState<string | null>(null);
  const [suppLookingUp, setSuppLookingUp] = useState(false);
  const suppLookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showMultiSuppModal, setShowMultiSuppModal] = useState(false);
  const [multiSuppName, setMultiSuppName] = useState("");
  const [multiSuppNutrients, setMultiSuppNutrients] = useState<Record<string, { dose: string; unit: string; pct: string; mode: "dose" | "pct" }>>({});
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
      window.setTimeout(() => setRunProfileTour(true), 150);
    }
    getProfile(user.id)
      .then((data) => {
        if (data) {
          profileExistsRef.current = true;
          const meta = (user as { user_metadata?: Record<string, string> }).user_metadata ?? {};
          setFirstName(data.firstName || meta.first_name || "");
          setLastName(data.lastName || meta.last_name || "");
          setSex(data.sex ?? "prefer_not");
          setGoalDirection(data.goalDirection ?? "maintain");
          setBodyPriority(data.bodyPriority ?? "");
          setFreeformFocus(data.freeformFocus ?? "");
          setActivityLevel(data.activityLevel ?? "");
          setDietaryRestrictions(data.dietaryRestrictions ?? []);
          setUnits(data.units ?? "imperial");

          if ((data.units ?? "imperial") === "imperial") {
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
              const lb = Math.round(kg * 2.20462 * 10) / 10;
              setWeight(String(Math.round(lb)));
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

          // Seed localStorage from Supabase so supplements survive cache clears
          const supps = data.dailySupplements ?? [];
          setDailySupplements(user.id, supps);
          setDailySupplementsState(supps);
        } else {
          profileExistsRef.current = false;
          const meta = (user as { user_metadata?: Record<string, string> }).user_metadata ?? {};
          setFirstName(meta.first_name ?? "");
          setLastName(meta.last_name ?? "");
          setDailySupplementsState(getDailySupplements(user.id));
        }
      })
      .catch(() => {
        setLoadError("Couldn’t load profile.");
        setDailySupplementsState(getDailySupplements(user.id));
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

  useEffect(() => {
    document.body.style.overflow = showMultiSuppModal ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [showMultiSuppModal]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted">
        Loading…
      </div>
    );
  }

  if (!user) return null;

  const profileTourSteps = [
    {
      target: '[data-tour="profile-header"]',
      content: "Fill out your profile, then head back to Home to log your first meal or workout to get started.",
      disableBeacon: true,
      placement: "bottom" as const,
    }
  ] as Step[];

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

  const saveNamesOnly = async (first: string, last: string) => {
    if (!user) return;
    const trimFirst = first.trim() || null;
    const trimLast = last.trim() || null;
    if (!LOCAL_MODE) {
      if (profileExistsRef.current) {
        await supabase.from("profiles").update({ first_name: trimFirst, last_name: trimLast }).eq("user_id", user.id);
      } else {
        await supabase.from("profiles").insert({ user_id: user.id, first_name: trimFirst, last_name: trimLast });
        profileExistsRef.current = true;
      }
    }
    setFirstName(first.trim());
    setLastName(last.trim());
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
        parsedWeightKg = lb > 0 ? Math.round((lb / 2.20462) * 10) / 10 : null;
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
        freeform_focus: freeformFocus || null,
        activity_level: activityLevel || null,
        dietary_restrictions: dietaryRestrictions,
        units
      };

      if (!LOCAL_MODE) {
        if (profileExistsRef.current) {
          const { error } = await supabase.from("profiles").update(payload).eq("user_id", user.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("profiles").insert(payload);
          if (error) throw error;
        }
      } else {
        await saveProfile(user.id, {
          id: user.id,
          firstName: payload.first_name ?? undefined,
          lastName: payload.last_name ?? undefined,
          height: payload.height ?? null,
          weight: payload.weight ?? null,
          age: payload.age ?? null,
          sex,
          goalDirection,
          bodyPriority: payload.body_priority ?? "",
          freeformFocus: payload.freeform_focus ?? "",
          activityLevel: (activityLevel || undefined) as ActivityLevel | undefined,
          dietaryRestrictions,
          units
        });
        profileExistsRef.current = true;
      }

      const freshProfile = await getProfile(user.id);
      if (freshProfile) {
        profileExistsRef.current = true;
        setFirstName(freshProfile.firstName ?? "");
        setLastName(freshProfile.lastName ?? "");
        setSex(freshProfile.sex ?? "prefer_not");
        setGoalDirection(freshProfile.goalDirection ?? "maintain");
        setBodyPriority(freshProfile.bodyPriority ?? "");
        setFreeformFocus(freshProfile.freeformFocus ?? "");
        setActivityLevel(freshProfile.activityLevel ?? "");
        setDietaryRestrictions(freshProfile.dietaryRestrictions ?? []);
        setUnits(freshProfile.units ?? "imperial");

        if ((freshProfile.units ?? "imperial") === "imperial") {
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
            const lb = Math.round(kg * 2.20462 * 10) / 10;
            setWeight(String(Math.round(lb)));
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

      if (user) {
        localStorage.setItem(`wya_profile_updated_${user.id}`, String(Date.now()));
        localStorage.removeItem(`wya_profile_prompt_opened_${user.id}`);
        localStorage.removeItem(`wya_profile_prompt_last_${user.id}`);
      }
      notifyProfileUpdated();
      setShowSavedToast(true);
      setTimeout(() => setShowSavedToast(false), 1800);
    } catch {
      setStatus("Couldn’t save.");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    await clearAllData(user.id);

    // Clear all localStorage keys for this user
    const keysToRemove = [
      `wya_daily_supps_${user.id}`,
      `wya_profile_updated_${user.id}`,
      `wya_profile_prompt_opened_${user.id}`,
      `wya_profile_prompt_last_${user.id}`,
      `wya_profile_prompt_sim_${user.id}`,
      `wya_walkthrough_${user.id}`,
      `wya_walkthrough_active_${user.id}`,
      `wya_walkthrough_stage_${user.id}`,
      `wya_walkthrough_gate_${user.id}`,
      `wya_walkthrough_profile_${user.id}`,
      `wya_nudge_view_count_${user.id}`,
    ];
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    clearDailySuppsLoggedToday(user.id);
    // Clear shared food caches (not user-specific, but tied to their logged foods)
    localStorage.removeItem("wya_food_cache_v1");
    localStorage.removeItem("wya_food_text_cache_v1");
    clearMealsCache(user.id);
    notifyMealsUpdated();

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
    setActivityLevel("");
    setDietaryRestrictions([]);
    setUnits("imperial");
    setDailySupplementsState([]);
    setStatus("All data cleared.");
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    router.replace("/login");
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    if (LOCAL_MODE) {
      await clearAllData(user.id);
      try {
        const usersRaw = localStorage.getItem("wya_local_users");
        const users = usersRaw ? (JSON.parse(usersRaw) as Array<{ id: string }>) : [];
        const filtered = users.filter((entry) => entry.id !== user.id);
        localStorage.setItem("wya_local_users", JSON.stringify(filtered));
        localStorage.removeItem("wya_local_session");
        localStorage.removeItem(`wya_walkthrough_${user.id}`);
        localStorage.removeItem(`wya_walkthrough_active_${user.id}`);
        localStorage.removeItem(`wya_walkthrough_stage_${user.id}`);
        localStorage.removeItem(`wya_walkthrough_gate_${user.id}`);
        localStorage.removeItem(`wya_walkthrough_profile_${user.id}`);
        localStorage.removeItem(`wya_profile_updated_${user.id}`);
        localStorage.removeItem(`wya_profile_prompt_opened_${user.id}`);
        localStorage.removeItem(`wya_profile_prompt_last_${user.id}`);
        localStorage.removeItem(`wya_nudge_view_count_${user.id}`);
      } catch {
        localStorage.removeItem("wya_local_users");
        localStorage.removeItem("wya_local_session");
      }
      await signOut();
      router.replace("/login");
      return;
    }
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

  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-24 pt-8">
        {mounted && (
          <Joyride
            steps={profileTourSteps}
            run={runProfileTour}
            continuous
            showSkipButton
            hideCloseButton
            disableOverlayClose
            callback={handleProfileTour}
            locale={{
              skip: "Skip",
              back: "Back",
              last: "Done",
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
        )}
        <header className="mb-4" data-tour="profile-header">
          <button
            type="button"
            className="mb-3 flex items-center gap-1 text-xs font-medium text-muted/60 hover:text-ink transition"
            onClick={() => router.push("/")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </button>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-ink">Profile</h1>
              <div className="mt-1 flex items-center gap-1.5">
                <p className="text-sm text-muted/70">
                  {[firstName, lastName].filter(Boolean).join(" ") || "Set name"}
                </p>
                <button
                  type="button"
                  aria-label="Edit name"
                  className="flex h-5 w-5 items-center justify-center rounded-full border border-ink/10 text-muted/50 hover:border-ink/20 hover:text-muted/80 transition"
                  onClick={() => {
                    setEditFirstName(firstName);
                    setEditLastName(lastName);
                    setEditingName(true);
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-ink/10 px-2.5 py-0.5 text-[10px] font-medium text-muted/60"
                  onClick={() => {
                    if (!user) return;
                    localStorage.removeItem(`wya_walkthrough_${user.id}`);
                    localStorage.removeItem(`wya_walkthrough_active_${user.id}`);
                    localStorage.removeItem(`wya_walkthrough_stage_${user.id}`);
                    localStorage.removeItem(`wya_walkthrough_gate_${user.id}`);
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
          <div className="mt-0 border-t-0 pt-0">
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
            <div className="mt-7 grid grid-cols-2 gap-x-5 gap-y-5">
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
            </div>
            <div className="mt-5">
              <p className="text-[11px] text-muted/70 mb-1.5">Sex</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: "male", label: "Male" },
                  { value: "female", label: "Female" },
                  { value: "other", label: "Other" },
                  { value: "prefer_not", label: "Rather not say" }
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${
                      sex === option.value
                        ? "border-primary/30 bg-primary/10 text-ink/80"
                        : "border-ink/10 text-muted/70"
                    }`}
                    onClick={() => setSex(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
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
            <div className="mt-2 grid grid-cols-3 gap-2">
              {goals.map(({ value, label }) => (
                <button
                  key={value}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${
                    goalDirection === value || (goalDirection === "balance" && value === "maintain")
                      ? "border-primary/30 bg-primary/10 text-ink/80"
                      : "border-ink/10 text-muted/70"
                  }`}
                  onClick={() => setGoalDirection(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </label>

          <div className="mt-8 border-t border-ink/5 pt-7">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/70">
              Activity level
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([
                { value: "sedentary", label: "Not very active" },
                { value: "lightly_active", label: "Lightly active" },
                { value: "moderately_active", label: "Moderately active" },
                { value: "very_active", label: "Very active" }
              ] as const).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${
                    activityLevel === option.value
                      ? "border-primary/30 bg-primary/10 text-ink/80"
                      : "border-ink/10 text-muted/70"
                  }`}
                  onClick={() => setActivityLevel(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-8 border-t border-ink/5 pt-7">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/70">
              Foods I avoid
            </p>
            <p className="mt-1 text-[11px] text-muted/60">Select all that apply · nudges won't suggest these.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                "Vegetarian",
                "Vegan",
                "No dairy",
                "No gluten",
                "No nuts",
                "No shellfish",
                "No pork",
                "Halal",
                "Kosher"
              ].map((restriction) => {
                const active = dietaryRestrictions.includes(restriction);
                return (
                  <button
                    key={restriction}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      active
                        ? "border-primary/30 bg-primary/10 text-ink/80"
                        : "border-ink/10 text-muted/60"
                    }`}
                    onClick={() =>
                      setDietaryRestrictions((prev) =>
                        active ? prev.filter((r) => r !== restriction) : [...prev, restriction]
                      )
                    }
                  >
                    {restriction}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="mt-6 block text-xs text-muted/70">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/70">
              What are you working toward? (optional)
            </span>
            <input
              type="text"
              className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
              value={freeformFocus}
              onChange={(event) => setFreeformFocus(event.target.value)}
              placeholder="e.g. building strength, more energy, longevity"
            />
          </label>

          <label className="mt-8 block border-t border-ink/5 pt-7 text-xs text-muted/70">
            <span className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/70">
                Your eating habits (optional)
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
            <textarea
              rows={3}
              className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm resize-none"
              value={bodyPriority}
              onChange={(event) => setBodyPriority(event.target.value)}
              placeholder="e.g. I meal prep Sundays, I eat late at night, I skip breakfast"
            />
          </label>

          <label className="mt-8 block border-t border-ink/5 pt-7 text-xs text-muted/70">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/70">Daily supplements</span>
            <p className="mt-1 text-[11px] text-muted/60">Added automatically every day in the background. Add a dose to track against recommended daily amounts.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {dailySupplements.map((entry, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/5 px-3 py-1 text-xs text-ink/80"
                >
                  {suppLabel(entry)}
                  <button
                    type="button"
                    className="text-ink/40 transition hover:text-ink/70"
                    onClick={(e) => {
                      e.stopPropagation();
                      const updated = dailySupplements.filter((_, i) => i !== idx);
                      setDailySupplementsState(updated);
                      if (user) { setDailySupplements(user.id, updated); saveDailySupplements(user.id, updated).then(() => notifyProfileUpdated()).catch(() => {}); }
                    }}
                    aria-label={`Remove ${suppName(entry)}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              <input
                type="text"
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                placeholder="e.g. Vitamin D"
                value={newSuppInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setNewSuppInput(val);
                  // Clear any pending lookup
                  if (suppLookupTimer.current) clearTimeout(suppLookupTimer.current);
                  if (val.trim().length < 2) { setSuppMatchHint(null); return; }
                  // Show keyword-based hint immediately
                  const matched = matchSupplementNutrients(val.trim());
                  setSuppMatchHint(matched.length ? `Tracks: ${matched.join(", ")}` : null);
                  // Debounce AI lookup — fires 800ms after user stops typing
                  suppLookupTimer.current = setTimeout(async () => {
                    setSuppLookingUp(true);
                    try {
                      const res = await fetch("/api/analyze-supplement", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: val.trim() }),
                      });
                      if (!res.ok) return;
                      const data = await res.json();
                      if (data.dose) {
                        setNewSuppDose(String(data.dose));
                        setNewSuppUnit(data.unit ?? "mg");
                      }
                      const reMatched = matchSupplementNutrients(val.trim());
                      const canonMatched = data.canonical_name ? matchSupplementNutrients(data.canonical_name) : [];
                      const allMatched = [...new Set([...reMatched, ...canonMatched])];
                      setSuppMatchHint(allMatched.length ? `Tracks: ${allMatched.join(", ")}` : "Not recognized for tracking");
                    } catch {
                      // silently fail — hint stays as keyword match
                    } finally {
                      setSuppLookingUp(false);
                    }
                  }, 800);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const name = newSuppInput.trim();
                  if (!name) return;
                  const dose = parseFloat(newSuppDose);
                  const entry: SupplementEntry = !isNaN(dose) && dose > 0
                    ? { name, dose, unit: newSuppUnit }
                    : name;
                  const updated = [...dailySupplements, entry];
                  setDailySupplementsState(updated);
                  if (user) { setDailySupplements(user.id, updated); saveDailySupplements(user.id, updated).then(() => notifyProfileUpdated()).catch(() => {}); }
                  setNewSuppInput(""); setNewSuppDose(""); setSuppMatchHint(null);
                }}
              />
              {(suppMatchHint || suppLookingUp) && (
                <div className="-mt-0.5 flex items-center gap-2">
                  <p className={`text-[11px] ${suppLookingUp ? "text-muted/40" : suppMatchHint?.startsWith("Tracks") ? "text-primary/70" : "text-muted/50"}`}>
                    {suppLookingUp ? "Looking up..." : suppMatchHint}
                  </p>
                  {!suppLookingUp && suppMatchHint === "Not recognized for tracking" && (
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-primary/80 underline"
                      onClick={() => {
                        setMultiSuppName(newSuppInput.trim());
                        setMultiSuppNutrients({});
                        setShowMultiSuppModal(true);
                      }}
                    >
                      Add nutrients manually
                    </button>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  className="min-w-0 flex-1 rounded-xl border border-ink/10 px-3 py-2 text-sm"
                  placeholder="dose (if available)"
                  value={newSuppDose}
                  onChange={(e) => setNewSuppDose(e.target.value)}
                />
                <select
                  className="rounded-full border border-ink/10 bg-white px-3 py-2 text-sm text-ink/70"
                  value={newSuppUnit}
                  onChange={(e) => setNewSuppUnit(e.target.value)}
                >
                  {["mg", "mcg", "IU", "g", "mL"].map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded-xl bg-ink/5 px-4 py-2 text-sm font-semibold text-ink/70 transition hover:bg-ink/10"
                  onClick={() => {
                    const name = newSuppInput.trim();
                    if (!name) return;
                    const dose = parseFloat(newSuppDose);
                    const entry: SupplementEntry = !isNaN(dose) && dose > 0
                      ? { name, dose, unit: newSuppUnit }
                      : name;
                    const updated = [...dailySupplements, entry];
                    setDailySupplementsState(updated);
                    if (user) { setDailySupplements(user.id, updated); saveDailySupplements(user.id, updated).then(() => notifyProfileUpdated()).catch(() => {}); }
                    setNewSuppInput(""); setNewSuppDose(""); setSuppMatchHint(null);
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </label>

          <div className="mt-8 border-t border-ink/5 pt-7">
          <button
            className="w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] ring-1 ring-white/40 transition-colors hover:bg-primary/90 disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {status && <p className="mt-2 text-xs text-muted">{status}</p>}
          </div>
        </Card>

        <Card className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted/60">Account</p>
          <button
            className="mt-3 w-full rounded-xl bg-ink/5 px-4 py-2.5 text-xs font-semibold text-ink/80 disabled:opacity-50"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Log out"}
          </button>
        </Card>

        <div className="mt-8 px-1">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-red-200/60" />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-red-400/60">Danger zone</p>
            <div className="h-px flex-1 bg-red-200/60" />
          </div>
          <div className="mt-4 space-y-3">
            <button
              className="w-full rounded-xl border border-red-200/60 px-4 py-2.5 text-xs font-semibold text-red-400/80 transition active:opacity-60"
              onClick={() => setShowClearConfirm(true)}
            >
              Clear all data and start fresh
            </button>
            <button
              className="w-full rounded-xl border border-red-200/60 px-4 py-2.5 text-xs font-semibold text-red-400/80 transition active:opacity-60"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete account
            </button>
          </div>

          {/* Clear data confirm */}
          {showClearConfirm && (
            <div className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-6 sm:items-center sm:pb-0" onClick={() => setShowClearConfirm(false)}>
              <div className="absolute inset-0 bg-black/30" />
              <div className="relative w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-base font-semibold text-ink">Clear all data?</h2>
                <p className="mt-1.5 text-sm text-muted/60">This will remove all your meals, profile, and history. This cannot be undone.</p>
                <div className="mt-5 flex gap-3">
                  <button
                    type="button"
                    className="flex-1 rounded-xl border border-ink/10 py-3 text-sm font-medium text-ink/60 transition active:opacity-60"
                    onClick={() => setShowClearConfirm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-xl bg-red-500 py-3 text-sm font-semibold text-white transition active:opacity-80"
                    onClick={() => { setShowClearConfirm(false); handleClear(); }}
                  >
                    Clear data
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Delete account confirm */}
          {showDeleteConfirm && (
            <div className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-6 sm:items-center sm:pb-0" onClick={() => setShowDeleteConfirm(false)}>
              <div className="absolute inset-0 bg-black/30" />
              <div className="relative w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-base font-semibold text-ink">Delete account?</h2>
                <p className="mt-1.5 text-sm text-muted/60">Your account and all data will be permanently deleted. This cannot be undone.</p>
                <div className="mt-5 flex gap-3">
                  <button
                    type="button"
                    className="flex-1 rounded-xl border border-ink/10 py-3 text-sm font-medium text-ink/60 transition active:opacity-60"
                    onClick={() => setShowDeleteConfirm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-xl bg-red-500 py-3 text-sm font-semibold text-white transition active:opacity-80"
                    onClick={() => { setShowDeleteConfirm(false); handleDeleteAccount(); }}
                  >
                    Delete account
                  </button>
                </div>
              </div>
            </div>
          )}
          <p className="mt-5 text-center text-[11px] text-muted/40">
            <a href="/privacy" className="underline underline-offset-2 hover:text-muted/60">
              Privacy Policy and Terms of Use
            </a>
          </p>
        </div>
      </div>

      <BottomNav current="none" />

      {editingName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <p className="text-sm font-semibold text-ink">Edit name</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-[11px] text-muted/70">
                First name
                <input
                  className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  placeholder="First"
                  autoFocus
                />
              </label>
              <label className="text-[11px] text-muted/70">
                Last name
                <input
                  className="mt-1 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  placeholder="Last"
                />
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl border border-ink/10 py-2 text-xs font-medium text-muted/70"
                onClick={() => setEditingName(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-primary py-2 text-xs font-semibold text-white disabled:opacity-50"
                disabled={savingName}
                onClick={async () => {
                  setSavingName(true);
                  await saveNamesOnly(editFirstName, editLastName);
                  setSavingName(false);
                  setEditingName(false);
                }}
              >
                {savingName ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showGoalInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-ink">Goal direction</p>
                <p className="mt-2 text-sm text-muted/70">
                  This sets a gentle direction for your ranges and nudges. It’s not a strict plan, just
                  a soft bias based on what you want. Everything is tuned to help improve nutrients and
                  how you feel over time while moving toward your direction.
                </p>
                <div className="mt-3 space-y-2 text-xs text-muted/70">
                  <p>
                    <span className="font-semibold text-ink/70">Gain weight:</span> nudge intake and protein upward over time to support steady growth.
                  </p>
                  <p>
                    <span className="font-semibold text-ink/70">Stay steady:</span> keep intake close to your current pattern with gentle nudges for balance.
                  </p>
                  <p>
                    <span className="font-semibold text-ink/70">Lose weight:</span> nudge intake slightly lower over time while keeping protein steady.
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
                <p className="text-sm font-semibold text-ink">Anything else?</p>
                <p className="mt-2 text-sm text-muted/70">
                  Use this to share anything that doesn't fit the other fields, like a specific focus area, a health condition, or how you typically eat. It helps keep nudges more aligned with your life.
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

      {showSavedToast && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-5">
          <div className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-white shadow-lg">
            Saved
          </div>
        </div>
      )}

      {showMultiSuppModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink">{multiSuppName || "Supplement"}</h2>
            <p className="mt-1 text-xs text-muted/60">Tap a nutrient to enter the amount from the label.</p>
            <div className="mt-4 space-y-2 max-h-[55vh] overflow-y-auto">
              {Object.entries(NUTRIENT_DISPLAY_NAMES).map(([key, displayName]) => {
                const entry = multiSuppNutrients[key];
                const isOpen = !!entry;
                const defaultUnit = NUTRIENT_UNITS[key] ?? "mg";
                return (
                  <div key={key} className="rounded-xl border border-ink/10 overflow-hidden">
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between px-4 py-3 text-left transition ${isOpen ? "bg-primary/5" : "bg-white hover:bg-ink/5"}`}
                      onClick={() => {
                        setMultiSuppNutrients((prev) => {
                          if (prev[key]) {
                            const next = { ...prev };
                            delete next[key];
                            return next;
                          }
                          return { ...prev, [key]: { dose: "", unit: defaultUnit, pct: "", mode: "dose" as const } };
                        });
                      }}
                    >
                      <span className="text-sm font-medium text-ink/80">{displayName}</span>
                      <span className={`text-xs font-semibold ${isOpen ? "text-primary/70" : "text-ink/30"}`}>
                        {isOpen ? (entry.dose || entry.pct ? `${entry.mode === "pct" ? entry.pct + "% DV" : entry.dose + " " + entry.unit}` : "") : "+"}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-ink/5 px-4 py-3 space-y-2">
                        <div className="flex gap-2 text-[11px] font-semibold">
                          <button
                            type="button"
                            className={`rounded-full px-3 py-1 transition ${entry.mode === "dose" ? "bg-primary/15 text-primary/80" : "bg-ink/5 text-ink/50"}`}
                            onClick={() => setMultiSuppNutrients((prev) => ({ ...prev, [key]: { ...prev[key], mode: "dose" } }))}
                          >
                            Dose
                          </button>
                          <button
                            type="button"
                            className={`rounded-full px-3 py-1 transition ${entry.mode === "pct" ? "bg-primary/15 text-primary/80" : "bg-ink/5 text-ink/50"}`}
                            onClick={() => setMultiSuppNutrients((prev) => ({ ...prev, [key]: { ...prev[key], mode: "pct" } }))}
                          >
                            % Daily Value
                          </button>
                        </div>
                        {entry.mode === "dose" ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="Amount"
                              className="min-w-0 flex-1 rounded-xl border border-ink/10 px-3 py-2 text-sm"
                              value={entry.dose}
                              onChange={(e) => setMultiSuppNutrients((prev) => ({ ...prev, [key]: { ...prev[key], dose: e.target.value } }))}
                            />
                            <select
                              className="rounded-full border border-ink/10 bg-white px-3 py-2 text-sm text-ink/70"
                              value={entry.unit}
                              onChange={(e) => setMultiSuppNutrients((prev) => ({ ...prev, [key]: { ...prev[key], unit: e.target.value } }))}
                            >
                              {["mg", "mcg", "IU", "g", "mL"].map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="% DV"
                              className="w-24 rounded-xl border border-ink/10 px-3 py-2 text-sm"
                              value={entry.pct}
                              onChange={(e) => setMultiSuppNutrients((prev) => ({ ...prev, [key]: { ...prev[key], pct: e.target.value } }))}
                            />
                            <span className="text-sm text-muted/60">% of daily value</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-xl border border-ink/10 px-4 py-3 text-sm font-semibold text-ink/70 transition hover:bg-ink/5"
                onClick={() => { setShowMultiSuppModal(false); setMultiSuppNutrients({}); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary/90"
                onClick={() => {
                  const name = multiSuppName;
                  if (!name) return;
                  // Build nutrients array from filled entries
                  const nutrients: SupplementNutrient[] = Object.entries(multiSuppNutrients)
                    .filter(([, v]) => v.mode === "dose" ? parseFloat(v.dose) > 0 : parseFloat(v.pct) > 0)
                    .map(([key, v]) => {
                      if (v.mode === "pct") {
                        // Convert % DV to absolute dose using RDA as reference
                        const pct = parseFloat(v.pct) / 100;
                        return { nutrient: key, dose: pct, unit: "ratio" };
                      }
                      return { nutrient: key, dose: parseFloat(v.dose), unit: v.unit };
                    });
                  const entry: SupplementEntry = nutrients.length > 0
                    ? { name, nutrients }
                    : name;
                  const updated = [...dailySupplements, entry];
                  setDailySupplementsState(updated);
                  if (user) { setDailySupplements(user.id, updated); saveDailySupplements(user.id, updated).then(() => notifyProfileUpdated()).catch(() => {}); }
                  setNewSuppInput(""); setSuppMatchHint(null);
                  setShowMultiSuppModal(false); setMultiSuppNutrients({});
                }}
              >
                Add supplement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
