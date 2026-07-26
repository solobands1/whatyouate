import { useSyncExternalStore } from "react";
import { subscribeKeyboardInset, getKeyboardInset } from "../lib/keyboardInset";

// Live on-screen keyboard height in px (0 when the keyboard is closed).
//
// Spread it onto a modal's full-screen flex container to make the dialog ride above the
// keyboard:  <div className="fixed inset-0 flex items-center kb-avoid" style={{ paddingBottom: kbInset }}>
// Because it's 0 when the keyboard is closed, adding it is a no-op in the normal state.
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribeKeyboardInset, getKeyboardInset, () => 0);
}
