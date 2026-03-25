"use client";

import { useCallback, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { WorkoutSession } from "../lib/types";
import { addWorkout, getActiveWorkout, listWorkouts, updateWorkout } from "../lib/supabaseDb";
import { notifyWorkoutsUpdated } from "../lib/dataEvents";

export const WORKOUT_TYPE_OPTIONS = [
  "Walk",
  "Run",
  "Cycle",
  "Cardio",
  "Weights",
  "Calisthenics",
  "HIIT",
  "Yoga",
  "Pilates",
  "Swim",
  "Sport",
  "Stretching",
  "Other",
];

export function useWorkout(
  user: User | null,
  onError: (msg: string) => void,
  setEditRecents: (val: boolean) => void,
  initialWorkouts: WorkoutSession[] = []
) {
  const [workouts, setWorkouts] = useState<WorkoutSession[]>(() => initialWorkouts);
  const [activeWorkout, setActiveWorkout] = useState<WorkoutSession | null>(null);
  const [showStartWorkoutModal, setShowStartWorkoutModal] = useState(false);
  const [showEndWorkoutModal, setShowEndWorkoutModal] = useState(false);
  const [isEndingWorkout, setIsEndingWorkout] = useState(false);
  const [selectedWorkoutTypes, setSelectedWorkoutTypes] = useState<string[]>([]);
  const [selectedIntensity, setSelectedIntensity] = useState<"low" | "medium" | "high" | "">("");
  const [editingWorkout, setEditingWorkout] = useState<WorkoutSession | null>(null);
  const [workoutEditHours, setWorkoutEditHours] = useState("");
  const [workoutEditMinutes, setWorkoutEditMinutes] = useState("");
  const [workoutEditTypes, setWorkoutEditTypes] = useState<string[]>([]);
  const [workoutEditIntensity, setWorkoutEditIntensity] = useState<"low" | "medium" | "high" | "">("");
  const [updatingWorkout, setUpdatingWorkout] = useState(false);
  const [showManualWorkoutModal, setShowManualWorkoutModal] = useState(false);
  const [manualHours, setManualHours] = useState("");
  const [manualMinutes, setManualMinutes] = useState("");
  const [manualTypes, setManualTypes] = useState<string[]>([]);
  const [manualIntensity, setManualIntensity] = useState<"low" | "medium" | "high" | "">("");
  const [manualDate, setManualDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [addingManual, setAddingManual] = useState(false);

  const load = useCallback(async (userId: string) => {
    const [workoutsData, activeWorkoutData] = await Promise.all([
      listWorkouts(userId, 50),
      getActiveWorkout(userId),
    ]);
    setWorkouts(workoutsData);
    setActiveWorkout(activeWorkoutData);
  }, []);

  const toggleWorkoutType = (type: string) => {
    setSelectedWorkoutTypes((prev) =>
      prev.includes(type) ? prev.filter((item) => item !== type) : [...prev, type]
    );
  };

  const openWorkoutEditor = (workout: WorkoutSession) => {
    const endTs = workout.endTs ?? Date.now();
    const inferredDuration =
      workout.durationMin ??
      (workout.startTs ? Math.max(0, Math.round((endTs - workout.startTs) / 60000)) : 0);
    const hours = Math.floor(inferredDuration / 60);
    const minutes = inferredDuration % 60;
    setWorkoutEditHours(String(hours));
    setWorkoutEditMinutes(String(minutes));
    setWorkoutEditTypes(workout.workoutTypes ?? []);
    setWorkoutEditIntensity(workout.intensity ?? "");
    setEditingWorkout(workout);
  };

  const handleStartWorkout = async () => {
    if (!user) return;
    try {
      const session = await addWorkout(user.id, Date.now());
      setActiveWorkout(session);
      await load(user.id);
      notifyWorkoutsUpdated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to start workout");
    } finally {
      setShowStartWorkoutModal(false);
    }
  };

  const handleEndWorkout = async () => {
    if (!user || !activeWorkout || isEndingWorkout) return;
    setIsEndingWorkout(true);
    try {
      const now = Date.now();
      const rawMinutes = (now - activeWorkout.startTs) / 60000;
      const durationMin = rawMinutes < 1 ? 0 : Math.ceil(rawMinutes);
      await updateWorkout(
        activeWorkout.id,
        user.id,
        now,
        durationMin,
        selectedWorkoutTypes,
        selectedIntensity || undefined
      );
      setActiveWorkout(null);
      setSelectedWorkoutTypes([]);
      setSelectedIntensity("");
      await load(user.id);
      notifyWorkoutsUpdated();
    } catch (err) {
      console.error("[endWorkout] FAILED", err);
      onError(err instanceof Error ? err.message : "Failed to end workout");
    } finally {
      setIsEndingWorkout(false);
      setShowEndWorkoutModal(false);
    }
  };

  const todayDateStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const openManualWorkoutModal = () => {
    setManualHours("");
    setManualMinutes("");
    setManualTypes([]);
    setManualIntensity("");
    setManualDate(todayDateStr());
    setShowManualWorkoutModal(true);
  };

  const handleAddManualWorkout = async () => {
    if (!user) return;
    try {
      setAddingManual(true);
      const hours = Number(manualHours) || 0;
      const minutes = Number(manualMinutes) || 0;
      const durationMin = hours * 60 + minutes;
      // Use noon of the selected date as the end anchor
      const endTs = new Date(`${manualDate}T12:00:00`).getTime();
      const startTs = durationMin > 0 ? endTs - durationMin * 60000 : endTs;
      const session = await addWorkout(user.id, startTs);
      await updateWorkout(
        session.id,
        user.id,
        endTs,
        durationMin > 0 ? durationMin : 0,
        manualTypes.length > 0 ? manualTypes : undefined,
        manualIntensity || undefined
      );
      setShowManualWorkoutModal(false);
      setManualHours("");
      setManualMinutes("");
      setManualTypes([]);
      setManualIntensity("");
      await load(user.id);
      notifyWorkoutsUpdated();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to add workout");
    } finally {
      setAddingManual(false);
    }
  };

  const handleUpdateWorkout = async () => {
    if (!editingWorkout || !user) return;
    try {
      setUpdatingWorkout(true);
      const parsedHours = Number(workoutEditHours);
      const parsedMinutes = Number(workoutEditMinutes);
      const safeHours = Number.isFinite(parsedHours) ? parsedHours : 0;
      const safeMinutes = Number.isFinite(parsedMinutes) ? parsedMinutes : 0;
      const computedDuration = safeHours * 60 + safeMinutes;
      const durationMin = computedDuration > 0 ? computedDuration : editingWorkout.durationMin ?? 0;
      const endTs = editingWorkout.startTs + durationMin * 60000;
      await updateWorkout(
        editingWorkout.id,
        user.id,
        endTs,
        durationMin,
        workoutEditTypes.length > 0 ? workoutEditTypes : undefined,
        workoutEditIntensity || undefined
      );
      setEditingWorkout(null);
      setEditRecents(false);
      await load(user.id);
      notifyWorkoutsUpdated();
    } catch (err) {
      console.error("Workout update failed", err);
    } finally {
      setUpdatingWorkout(false);
    }
  };

  return {
    workouts,
    setWorkouts,
    activeWorkout,
    setActiveWorkout,
    showStartWorkoutModal,
    setShowStartWorkoutModal,
    showEndWorkoutModal,
    setShowEndWorkoutModal,
    isEndingWorkout,
    selectedWorkoutTypes,
    setSelectedWorkoutTypes,
    selectedIntensity,
    setSelectedIntensity,
    editingWorkout,
    setEditingWorkout,
    workoutEditHours,
    setWorkoutEditHours,
    workoutEditMinutes,
    setWorkoutEditMinutes,
    workoutEditTypes,
    setWorkoutEditTypes,
    workoutEditIntensity,
    setWorkoutEditIntensity,
    updatingWorkout,
    load,
    toggleWorkoutType,
    openWorkoutEditor,
    handleStartWorkout,
    handleEndWorkout,
    handleUpdateWorkout,
    showManualWorkoutModal,
    setShowManualWorkoutModal,
    openManualWorkoutModal,
    manualHours,
    setManualHours,
    manualMinutes,
    setManualMinutes,
    manualTypes,
    setManualTypes,
    manualIntensity,
    setManualIntensity,
    manualDate,
    setManualDate,
    addingManual,
    handleAddManualWorkout,
  };
}
