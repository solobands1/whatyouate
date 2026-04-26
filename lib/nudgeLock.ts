// Module-level lock so HomeScreen prefetch and SummaryScreen never fire simultaneously
// for the same window. Both components import this, sharing one in-process Set.
const locked = new Set<string>();

export function tryLockNudgeWindow(windowKey: string): boolean {
  if (locked.has(windowKey)) return false;
  locked.add(windowKey);
  return true;
}

export function unlockNudgeWindow(windowKey: string): void {
  locked.delete(windowKey);
}

export function isNudgeWindowLocked(windowKey: string): boolean {
  return locked.has(windowKey);
}
