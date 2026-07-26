// Single source of truth for the on-screen keyboard height (px), shared across the app.
//
// On native iOS (inside the Capacitor shell) it reads the exact keyboard height from the
// native `keyboardWillShow` event — fired at the START of iOS's keyboard slide — so modals
// can glide above the keyboard in sync with it, with no jolt. (This is why the plugin is
// configured with resize:None — we do the avoidance in-app rather than letting the webview
// reflow globally.)
//
// On the web it falls back to `visualViewport` so mobile browsers still get avoidance.
//
// Consumers subscribe via useKeyboardInset(); the value is 0 whenever the keyboard is
// closed, so anything wired to it is a no-op in the normal (keyboard-closed) state.

let current = 0;
const subscribers = new Set<(height: number) => void>();
let started = false;

function emit() {
  for (const cb of subscribers) cb(current);
}

function set(height: number) {
  const next = Math.max(0, Math.round(height));
  if (next === current) return;
  current = next;
  emit();
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;

  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  const isNative = !!cap?.isNativePlatform?.();

  if (isNative) {
    // Native: exact height + native timing, up front.
    import("@capacitor/keyboard")
      .then(({ Keyboard }) => {
        Keyboard.addListener("keyboardWillShow", (info) => set(info.keyboardHeight));
        Keyboard.addListener("keyboardWillHide", () => set(0));
      })
      .catch(() => {
        /* plugin unavailable — leave inset at 0 */
      });
    return;
  }

  // Web fallback: observe the visual viewport. The difference between the layout height and
  // the visible height approximates the keyboard; the >80px guard ignores browser toolbars.
  const vv = window.visualViewport;
  if (!vv) return;
  const onChange = () => {
    const overlap = window.innerHeight - vv.height - vv.offsetTop;
    set(overlap > 80 ? overlap : 0);
  };
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
}

export function subscribeKeyboardInset(cb: (height: number) => void): () => void {
  start();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function getKeyboardInset(): number {
  return current;
}
