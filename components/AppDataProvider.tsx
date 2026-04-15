"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { MealLog, UserProfile, WorkoutSession } from "../lib/types";
import { useAuth } from "./AuthProvider";
import { getProfile, listMeals, listWorkouts, listNudges, getFeelLogs, updateMeal, saveStreak } from "../lib/supabaseDb";
import type { FeelLog } from "../lib/supabaseDb";
import { dayKeyFromTs, todayKey } from "../lib/utils";
import { computeStreakFromMeals } from "../lib/digestEngine";
import { MEALS_UPDATED_EVENT, NUDGES_UPDATED_EVENT, PROFILE_UPDATED_EVENT, WORKOUTS_UPDATED_EVENT, notifyMealsFailed } from "../lib/dataEvents";
import { safeFallbackAnalysis } from "../lib/ai/schema";
import { seedTextCacheFromMeals } from "../lib/foodCache";

// Module-level flag so AuthGate can check data has loaded at least once
// (survives client-side navigation, resets on full page reload)
export let _dataEverLoaded = false;

export type NudgeRow = { id: string; type?: string; message: string; created_at: string };

type AppDataContextValue = {
  profile: UserProfile | null;
  meals: MealLog[];
  workouts: WorkoutSession[];
  nudges: NudgeRow[];
  nudgesLoaded: boolean;
  feelLogs: FeelLog[];
  loading: boolean;
  setMeals: React.Dispatch<React.SetStateAction<MealLog[]>>;
  setWorkouts: React.Dispatch<React.SetStateAction<WorkoutSession[]>>;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  reload: () => void;
};

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [nudges, setNudges] = useState<NudgeRow[]>([]);
  const [nudgesLoaded, setNudgesLoaded] = useState(false);
  const [feelLogs, setFeelLogs] = useState<FeelLog[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadNudges = useCallback(async (userId: string) => {
    try {
      const nudgesData = await listNudges(userId, 100);
      if (!mountedRef.current) return;
      setNudges(nudgesData as NudgeRow[]);
      setNudgesLoaded(true);
    } catch {
      if (mountedRef.current) setNudgesLoaded(true);
    }
  }, []);

  const load = useCallback(async (userId: string, isInitial = false) => {
    try {
      const [profileData, mealsData, workoutsData, feelLogsData] = await Promise.all([
        getProfile(userId),
        listMeals(userId, 120),
        listWorkouts(userId, 50),
        getFeelLogs(userId, 50),
      ]);
      if (!mountedRef.current) return;

      // Seed quick-add text cache from history in case localStorage was cleared
      seedTextCacheFromMeals(mealsData);

      // Recover meals stuck in "processing" (e.g. tab closed mid-analysis)
      const STUCK_MS = 5 * 60 * 1000;
      const now = Date.now();
      const stuck = mealsData.filter(
        (m) => m.status === "processing" && now - m.ts > STUCK_MS
      );
      let finalMeals = mealsData;
      if (stuck.length > 0) {
        await Promise.all(
          stuck.map((m) =>
            updateMeal(m.id, safeFallbackAnalysis(), undefined, userId, "failed").catch(() => {})
          )
        );
        const refreshed = await listMeals(userId, 120);
        if (mountedRef.current) finalMeals = refreshed;
        notifyMealsFailed(stuck.length);
      }

      if (!mountedRef.current) return;

      // Sync streak — update persisted value if user has logged today
      let resolvedProfile = profileData ?? null;
      if (profileData && userId) {
        const todayStr = todayKey();
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = todayKey(yesterdayDate);
        const storedStreak = profileData.streak ?? 0;
        const storedLastDate = profileData.streakLastDate ?? "";
        const hasLoggedToday = finalMeals.some(
          (m) => m.analysisJson?.source !== "supplement" && m.status !== "failed" && dayKeyFromTs(m.ts) === todayStr
        );
        // Always recompute from meals to catch cases where persisted streak drifted low
        const computedStreak = computeStreakFromMeals(finalMeals);
        if (hasLoggedToday && storedLastDate !== todayStr) {
          let newStreak: number;
          if (storedLastDate === "") {
            // First time persisting — bootstrap from computed history
            newStreak = computedStreak;
          } else {
            const incrementedStreak = storedLastDate === yesterdayStr ? storedStreak + 1 : 1;
            // Take the higher of incremented vs recomputed (fixes dev-phase drift)
            newStreak = Math.max(incrementedStreak, computedStreak);
          }
          resolvedProfile = { ...profileData, streak: newStreak, streakLastDate: todayStr };
          saveStreak(userId, newStreak, todayStr).catch(() => {});
        } else if (hasLoggedToday && storedLastDate === todayStr && computedStreak > storedStreak) {
          // Already updated today but computed is higher — backfill once
          resolvedProfile = { ...profileData, streak: computedStreak };
          saveStreak(userId, computedStreak, todayStr).catch(() => {});
        } else if (!hasLoggedToday && storedLastDate < yesterdayStr && storedLastDate !== "" && storedStreak > 0) {
          // Streak broken — reset stored value so it doesn't show stale count
          resolvedProfile = { ...profileData, streak: 0 };
          saveStreak(userId, 0, storedLastDate).catch(() => {});
        }
      }

      setProfile(resolvedProfile);
      setMeals(finalMeals);
      setWorkouts(workoutsData);
      setFeelLogs(feelLogsData);
    } catch {
      // silently fail — screens handle empty state gracefully
    } finally {
      if (mountedRef.current && isInitial) {
        _dataEverLoaded = true;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    load(user.id, true);
    loadNudges(user.id);
  }, [user, load, loadNudges]);

  useEffect(() => {
    if (!user) return;
    // Background refresh — no loading spinner, just update state silently
    const handler = () => load(user.id, false);
    const nudgeHandler = () => loadNudges(user.id);
    window.addEventListener(MEALS_UPDATED_EVENT, handler);
    window.addEventListener(WORKOUTS_UPDATED_EVENT, handler);
    window.addEventListener(PROFILE_UPDATED_EVENT, handler);
    window.addEventListener(NUDGES_UPDATED_EVENT, nudgeHandler);
    return () => {
      window.removeEventListener(MEALS_UPDATED_EVENT, handler);
      window.removeEventListener(WORKOUTS_UPDATED_EVENT, handler);
      window.removeEventListener(PROFILE_UPDATED_EVENT, handler);
      window.removeEventListener(NUDGES_UPDATED_EVENT, nudgeHandler);
    };
  }, [user, load, loadNudges]);

  const reload = useCallback(() => {
    if (user) load(user.id, false);
  }, [user, load]);

  return (
    <AppDataContext.Provider
      value={{ profile, meals, workouts, nudges, nudgesLoaded, feelLogs, loading, setMeals, setWorkouts, setProfile, reload }}
    >
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
