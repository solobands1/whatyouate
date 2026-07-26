import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'com.dillonpoulin.whatyouate',
  appName: 'WhatYouAte',
  webDir: 'public',
  // Webview background shown while the remote app loads over the network — match the app's
  // surface color so launch shows near-white instead of a white flash. (Takes effect on the
  // next native build: npx cap sync ios, then rebuild.)
  backgroundColor: '#F8FAFC',
  server: {
    url: 'https://whatyouate.vercel.app',
    cleartext: false,
  },
  plugins: {
    // Keyboard EVENTS only — we do NOT let the plugin resize the webview (resize: None).
    // Modal keyboard-avoidance is handled in-app via useKeyboardInset (paddingBottom that
    // tracks the native keyboardWillShow height), so nothing global reflows unexpectedly.
    // (Takes effect on the next native build: npx cap sync ios, then rebuild.)
    Keyboard: {
      resize: KeyboardResize.None,
    },
  },
};

export default config;
