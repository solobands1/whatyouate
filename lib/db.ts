import { openDB, type DBSchema } from "idb";
import type { MealLog, UserProfile, WorkoutSession } from "./types";

interface WhatYouAteDB extends DBSchema {
  profile: {
    key: string;
    value: UserProfile;
  };
  meals: {
    key: string;
    value: MealLog;
    indexes: { "by-ts": number };
  };
  workouts: {
    key: string;
    value: WorkoutSession;
    indexes: { "by-start": number };
  };
}

const DB_NAME = "what-you-ate";
const DB_VERSION = 1;

export async function getDB() {
  return openDB<WhatYouAteDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("profile")) {
        db.createObjectStore("profile");
      }
      if (!db.objectStoreNames.contains("meals")) {
        const store = db.createObjectStore("meals", { keyPath: "id" });
        store.createIndex("by-ts", "ts");
      }
      if (!db.objectStoreNames.contains("workouts")) {
        const store = db.createObjectStore("workouts", { keyPath: "id" });
        store.createIndex("by-start", "startTs");
      }
    }
  });
}

export async function saveProfile(profile: UserProfile) {
  const db = await getDB();
  await db.put("profile", profile, "main");
}

export async function getProfile() {
  const db = await getDB();
  return db.get("profile", "main");
}

export async function addMeal(meal: MealLog) {
  const db = await getDB();
  await db.put("meals", meal);
}

export async function updateMeal(meal: MealLog) {
  const db = await getDB();
  await db.put("meals", meal);
}

export async function listMeals(limit = 50) {
  const db = await getDB();
  const tx = db.transaction("meals");
  const index = tx.store.index("by-ts");
  const meals: MealLog[] = [];
  let cursor = await index.openCursor(null, "prev");
  while (cursor && meals.length < limit) {
    meals.push(cursor.value);
    cursor = await cursor.continue();
  }
  await tx.done;
  return meals;
}

export async function addWorkout(session: WorkoutSession) {
  const db = await getDB();
  await db.put("workouts", session);
}

export async function updateWorkout(session: WorkoutSession) {
  const db = await getDB();
  await db.put("workouts", session);
}

export async function listWorkouts(limit = 50) {
  const db = await getDB();
  const tx = db.transaction("workouts");
  const index = tx.store.index("by-start");
  const sessions: WorkoutSession[] = [];
  let cursor = await index.openCursor(null, "prev");
  while (cursor && sessions.length < limit) {
    sessions.push(cursor.value);
    cursor = await cursor.continue();
  }
  await tx.done;
  return sessions;
}

export async function clearAllData() {
  const db = await getDB();
  await Promise.all([db.clear("profile"), db.clear("meals"), db.clear("workouts")]);
}

export async function exportAllData() {
  const db = await getDB();
  const profile = await db.get("profile", "main");
  const mealsRaw = await db.getAll("meals");
  const workoutsRaw = await db.getAll("workouts");
  const meals = mealsRaw.map((meal) => ({
    ...meal,
    imageBlob: undefined,
    imageThumb: meal.imageThumb ?? undefined,
    hasImage: Boolean(meal.imageBlob)
  }));
  const workouts = workoutsRaw.map((session) => ({
    ...session,
    startImageBlob: undefined,
    endImageBlob: undefined,
    hasStartImage: Boolean(session.startImageBlob),
    hasEndImage: Boolean(session.endImageBlob)
  }));
  return { profile, meals, workouts };
}
