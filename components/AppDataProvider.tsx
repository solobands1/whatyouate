"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { MealLog, UserProfile, WorkoutSession } from "../lib/types";
import { useAuth } from "./AuthProvider";
import { getProfile, listMeals, listWorkouts, listNudges, getFeelLogs, getWeightLogs, updateMeal, saveStreak, saveStreakSaver, saveTimezoneOffset, fetchReflections, fetchHabitHistory, fetchWaterLogs, fetchHabitState } from "../lib/supabaseDb";
import type { FeelLog, WeightLog } from "../lib/supabaseDb";
import type { ReflectionEntry, HabitHistoryEntry, HabitState } from "../lib/habitState";
import { dayKeyFromTs, todayKey } from "../lib/utils";
import { computeStreakFromMeals } from "../lib/digestEngine";
import { EMPTY_STREAK_SAVER, rescueAvailable } from "../lib/streakSaver";
import { MEALS_UPDATED_EVENT, NUDGES_UPDATED_EVENT, PROFILE_UPDATED_EVENT, WORKOUTS_UPDATED_EVENT, notifyMealsFailed } from "../lib/dataEvents";
import { safeFallbackAnalysis } from "../lib/ai/schema";
import { seedTextCacheFromMeals, migrateTextCacheKeys } from "../lib/foodCache";
import { initializePurchases } from "../lib/purchases";

// Module-level flag so AuthGate can check data has loaded at least once
// (survives client-side navigation, resets on full page reload)
export let _dataEverLoaded = false;

function pruneNudgeSnapshots() {
  try {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith("wya_nudge_snapshot_")) continue;
      // Key format: wya_nudge_snapshot_YYYY-WW  (e.g. 2026-15)
      // Parse the date from the week key — use Sunday of that ISO week
      const weekPart = key.replace("wya_nudge_snapshot_", "");
      const [year, week] = weekPart.split("-").map(Number);
      if (!year || !week) { localStorage.removeItem(key); continue; }
      // Jan 4 is always in week 1; compute start of that week
      const jan4 = new Date(year, 0, 4);
      const startOfWeek1 = new Date(jan4);
      startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
      const weekStart = new Date(startOfWeek1);
      weekStart.setDate(startOfWeek1.getDate() + (week - 1) * 7);
      if (weekStart.getTime() < cutoff) localStorage.removeItem(key);
    }
  } catch {
    // localStorage unavailable — no-op
  }
}

export type NudgeRow = { id: string; type?: string; message: string; created_at: string; why?: string | null; action?: string | null };
export type { WeightLog };

type AppDataContextValue = {
  profile: UserProfile | null;
  meals: MealLog[];
  workouts: WorkoutSession[];
  nudges: NudgeRow[];
  nudgesLoaded: boolean;
  feelLogs: FeelLog[];
  weightLogs: WeightLog[];
  reflections: ReflectionEntry[];
  habitHistory: HabitHistoryEntry[];
  waterLogs: Record<string, number>;
  habitState: HabitState | null;
  loading: boolean;
  profileResolved: boolean;
  setMeals: React.Dispatch<React.SetStateAction<MealLog[]>>;
  setWorkouts: React.Dispatch<React.SetStateAction<WorkoutSession[]>>;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  setWeightLogs: React.Dispatch<React.SetStateAction<WeightLog[]>>;
  setWaterLogs: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setHabitState: React.Dispatch<React.SetStateAction<HabitState | null>>;
  reload: () => void;
};

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);

// Retry a fetch a couple of times with backoff. Flaky connections drop requests
// intermittently; without this a single dropped query fails the whole load.
async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutSession[]>([]);
  const [nudges, setNudges] = useState<NudgeRow[]>([]);
  const [nudgesLoaded, setNudgesLoaded] = useState(false);
  const [feelLogs, setFeelLogs] = useState<FeelLog[]>([]);
  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [reflections, setReflections] = useState<ReflectionEntry[]>([]);
  const [habitHistory, setHabitHistory] = useState<HabitHistoryEntry[]>([]);
  const [waterLogs, setWaterLogs] = useState<Record<string, number>>({});
  const [habitState, setHabitState] = useState<HabitState | null>(null);
  const [loading, setLoading] = useState(true);
  // True only once getProfile has actually returned (even to null). Distinguishes a
  // genuinely new user (no profile) from a load that failed/timed out — so onboarding
  // never shows (and can't overwrite a real profile) just because the load didn't complete.
  const [profileResolved, setProfileResolved] = useState(false);
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

  const loadMealsOnly = useCallback(async (userId: string) => {
    try {
      const mealsData = await listMeals(userId, 400);
      if (!mountedRef.current) return;
      seedTextCacheFromMeals(mealsData);
      setMeals(mealsData);
    } catch {
      // silently fail
    }
  }, []);

  const load = useCallback(async (userId: string, isInitial = false) => {
    try {
      const settled = await Promise.allSettled([
        withRetry(() => getProfile(userId)),
        withRetry(() => listMeals(userId, 400)),
        withRetry(() => listWorkouts(userId, 50)),
        withRetry(() => getFeelLogs(userId, 50)),
        withRetry(() => getWeightLogs(userId, 60)),
        withRetry(() => fetchReflections(userId)),
        withRetry(() => fetchHabitHistory(userId)),
        withRetry(() => fetchWaterLogs(userId)),
        withRetry(() => fetchHabitState(userId)),
      ]);
      if (!mountedRef.current) return;

      // A dropped query (flaky connection) must not blank the whole app — use whatever
      // resolved. Crucially, only treat the profile as "resolved" if its query actually
      // came back, so a failed load never masquerades as "new user → onboarding".
      const profileData = settled[0].status === "fulfilled" ? settled[0].value : null;
      const mealsData = settled[1].status === "fulfilled" ? settled[1].value : [];
      const workoutsData = settled[2].status === "fulfilled" ? settled[2].value : [];
      const feelLogsData = settled[3].status === "fulfilled" ? settled[3].value : [];
      const weightLogsData = settled[4].status === "fulfilled" ? settled[4].value : [];
      const reflectionsData = settled[5].status === "fulfilled" ? settled[5].value : [];
      const habitHistoryData = settled[6].status === "fulfilled" ? settled[6].value : [];
      const waterLogsData = settled[7].status === "fulfilled" ? settled[7].value : {};
      const habitStateData = settled[8].status === "fulfilled" ? settled[8].value : null;
      if (settled[0].status === "fulfilled") setProfileResolved(true);

      // Normalize existing text cache keys (one-time migration, idempotent)
      migrateTextCacheKeys();
      // Seed quick-add text cache from history in case localStorage was cleared
      seedTextCacheFromMeals(mealsData);
      // Prune stale nudge snapshot keys (older than 7 days) to avoid localStorage bloat
      pruneNudgeSnapshots();

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

      // Sync streak — the persisted value is the source of truth for the pill. Keep it in step
      // with logging, and when a single day is missed within the weekly cap, freeze it instead
      // of resetting to zero (see lib/streakSaver).
      let resolvedProfile = profileData ?? null;
      if (profileData && userId) {
        const todayStr = todayKey();
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = todayKey(yesterdayDate);
        const dayBeforeDate = new Date();
        dayBeforeDate.setDate(dayBeforeDate.getDate() - 2);
        const dayBeforeStr = todayKey(dayBeforeDate);
        const storedStreak = profileData.streak ?? 0;
        const storedLastDate = profileData.streakLastDate ?? "";
        const realDayKeys = new Set(
          finalMeals
            .filter((m) => m.analysisJson?.source !== "supplement" && m.status !== "failed")
            .map((m) => dayKeyFromTs(m.ts))
        );
        const hasLoggedToday = realDayKeys.has(todayStr);

        // Freeze state, persisted on the profile (durable + consistent across devices).
        const saver = profileData.streakSaver ?? EMPTY_STREAK_SAVER;
        const forgiven = new Set(saver.forgiven);
        let rescueLast = saver.rescueLast;
        let saverChanged = false;

        // Reconcile: any forgiven day that's since been logged for real (e.g. the user backfilled
        // it) is no longer frozen — drop it, and if the weekly rescue was spent on it, release the
        // rescue so backfilling never costs the free pass.
        for (const day of [...forgiven]) {
          if (realDayKeys.has(day)) {
            forgiven.delete(day);
            saverChanged = true;
            if (rescueLast === day) rescueLast = null;
          }
        }

        // Recompute (bridging frozen days) to catch cases where the persisted value drifted low
        const computedStreak = computeStreakFromMeals(finalMeals, forgiven);
        if (hasLoggedToday && storedLastDate !== todayStr) {
          let newStreak: number;
          if (storedLastDate === "") {
            // First time persisting — bootstrap from computed history
            newStreak = computedStreak;
          } else {
            // Consecutive if the last credit was yesterday, or yesterday is a frozen bridge.
            const consecutive = storedLastDate === yesterdayStr || forgiven.has(yesterdayStr);
            const incrementedStreak = consecutive ? storedStreak + 1 : 1;
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
          // A day was missed. Freeze a single slip within the weekly cap; otherwise it breaks.
          const singleSlip =
            storedLastDate === dayBeforeStr &&  // last real credit was the day before yesterday
            realDayKeys.has(dayBeforeStr) &&    // ...and that day is genuinely logged, not itself frozen
            rescueAvailable({ forgiven: [...forgiven], rescueLast, ack: saver.ack }, todayStr);
          if (singleSlip) {
            // Freeze yesterday: hold the count, advance the marker so logging today continues it,
            // and spend the weekly rescue (released above if they later backfill it for real).
            forgiven.add(yesterdayStr);
            rescueLast = yesterdayStr;
            saverChanged = true;
            resolvedProfile = { ...profileData, streak: storedStreak, streakLastDate: yesterdayStr };
            saveStreak(userId, storedStreak, yesterdayStr).catch(() => {});
          } else {
            // Real break — reset and drop any stale freeze state.
            if (forgiven.size > 0) { forgiven.clear(); saverChanged = true; }
            resolvedProfile = { ...profileData, streak: 0 };
            saveStreak(userId, 0, storedLastDate).catch(() => {});
          }
        }

        // Persist + thread the freeze state onto the resolved profile whenever it changed.
        if (saverChanged) {
          const nextSaver = { forgiven: [...forgiven], rescueLast, ack: saver.ack };
          resolvedProfile = { ...(resolvedProfile ?? profileData), streakSaver: nextSaver };
          saveStreakSaver(userId, nextSaver).catch(() => {});
        }
      }

      // Silently capture timezone offset — used server-side by cron for accurate meal time display
      const currentOffset = new Date().getTimezoneOffset();
      if (resolvedProfile && resolvedProfile.timezoneOffsetMinutes !== currentOffset) {
        resolvedProfile = { ...resolvedProfile, timezoneOffsetMinutes: currentOffset };
        saveTimezoneOffset(userId, currentOffset).catch(() => {});
      }

      setProfile(resolvedProfile);
      setMeals(finalMeals);
      setWorkouts(workoutsData);
      setFeelLogs(feelLogsData);
      setWeightLogs(weightLogsData);
      setReflections(reflectionsData);
      setHabitHistory(habitHistoryData);
      setWaterLogs(waterLogsData);
      setHabitState(habitStateData);
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
    setProfileResolved(false);
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    load(user.id, true);
    loadNudges(user.id);
    initializePurchases(user.id).catch(() => {});
    // Watchdog: never let the splash hang forever. A query that *errors* is fine — it
    // rejects and load()'s finally recovers — but one that never settles would otherwise
    // pin the splash indefinitely. After 12s, fail open: screens handle empty state, and
    // real data still populates if the load eventually resolves.
    const watchdog = setTimeout(() => {
      if (!mountedRef.current) return;
      _dataEverLoaded = true;
      setLoading(false);
      setNudgesLoaded(true);
    }, 12000);
    return () => clearTimeout(watchdog);
  }, [user, load, loadNudges]);

  useEffect(() => {
    if (!user) return;
    // Background refresh — no loading spinner, just update state silently
    const mealsHandler = () => loadMealsOnly(user.id);
    const fullReloadHandler = () => load(user.id, false);
    const nudgeHandler = () => loadNudges(user.id);
    window.addEventListener(MEALS_UPDATED_EVENT, mealsHandler);
    window.addEventListener(WORKOUTS_UPDATED_EVENT, fullReloadHandler);
    window.addEventListener(PROFILE_UPDATED_EVENT, fullReloadHandler);
    window.addEventListener(NUDGES_UPDATED_EVENT, nudgeHandler);

    // Reload nudges when app returns to foreground (e.g. after tapping a push notification)
    // visibilitychange fires reliably in Capacitor WKWebView on iOS background/foreground
    const visibilityHandler = () => {
      if (document.visibilityState === "visible") loadNudges(user.id);
    };
    document.addEventListener("visibilitychange", visibilityHandler);

    return () => {
      window.removeEventListener(MEALS_UPDATED_EVENT, mealsHandler);
      window.removeEventListener(WORKOUTS_UPDATED_EVENT, fullReloadHandler);
      window.removeEventListener(PROFILE_UPDATED_EVENT, fullReloadHandler);
      window.removeEventListener(NUDGES_UPDATED_EVENT, nudgeHandler);
      document.removeEventListener("visibilitychange", visibilityHandler);
    };
  }, [user, load, loadMealsOnly, loadNudges]);

  const reload = useCallback(() => {
    if (user) load(user.id, false);
  }, [user, load]);

  return (
    <AppDataContext.Provider
      value={{ profile, meals, workouts, nudges, nudgesLoaded, feelLogs, weightLogs, reflections, habitHistory, waterLogs, habitState, loading, profileResolved, setMeals, setWorkouts, setProfile, setWeightLogs, setWaterLogs, setHabitState, reload }}
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
