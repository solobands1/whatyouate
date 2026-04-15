import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dillonpoulin.whatyouate',
  appName: 'WhatYouAte',
  webDir: 'public',
  server: {
    url: 'https://whatyouate.vercel.app',
    cleartext: false,
  },
};

export default config;
