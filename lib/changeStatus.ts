// Per-user status for the "Changes You're Making" ledger — whether the user is still doing
// a kept habit, and their lifecycle choice when they stop. Kept lightweight in localStorage
// (it's a preference layer over the derived ledger; the habit data itself lives in Supabase).

export type ChangeStatus = "active" | "stopped" | "not_for_me";
export interface ChangeStatusEntry { status: ChangeStatus; ts: number; lastAsked: number }

const KEY = (userId: string) => `wya_change_status_${userId}`;

export function getChangeStatuses(userId: string): Record<string, ChangeStatusEntry> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(KEY(userId)) || "{}"); } catch { return {}; }
}

function save(userId: string, map: Record<string, ChangeStatusEntry>) {
  try { localStorage.setItem(KEY(userId), JSON.stringify(map)); } catch {}
}

export function setChangeStatus(userId: string, templateId: string, status: ChangeStatus) {
  const map = getChangeStatuses(userId);
  const prev = map[templateId];
  map[templateId] = { status, ts: Date.now(), lastAsked: prev?.lastAsked ?? Date.now() };
  save(userId, map);
}

// Record that we asked "still doing it?" so we don't nag again for a while.
export function markChangeAsked(userId: string, templateId: string) {
  const map = getChangeStatuses(userId);
  const prev = map[templateId];
  map[templateId] = { status: prev?.status ?? "active", ts: prev?.ts ?? Date.now(), lastAsked: Date.now() };
  save(userId, map);
}

export function getNotForMe(userId: string): Set<string> {
  return new Set(
    Object.entries(getChangeStatuses(userId))
      .filter(([, v]) => v.status === "not_for_me")
      .map(([k]) => k),
  );
}
