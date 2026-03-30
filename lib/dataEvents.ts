export const MEALS_UPDATED_EVENT = "meals-updated";
export const WORKOUTS_UPDATED_EVENT = "workouts-updated";
export const PROFILE_UPDATED_EVENT = "profile-updated";
export const NUDGES_UPDATED_EVENT = "nudges-updated";

function dispatchWindowEvent(name: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(name));
}

export function notifyMealsUpdated() {
  dispatchWindowEvent(MEALS_UPDATED_EVENT);
}

export function notifyWorkoutsUpdated() {
  dispatchWindowEvent(WORKOUTS_UPDATED_EVENT);
}

export function notifyProfileUpdated() {
  dispatchWindowEvent(PROFILE_UPDATED_EVENT);
}

export function notifyNudgesUpdated() {
  dispatchWindowEvent(NUDGES_UPDATED_EVENT);
}
