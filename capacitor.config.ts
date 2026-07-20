import type { CapacitorConfig } from '@capacitor/cli';

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
};

export default config;
