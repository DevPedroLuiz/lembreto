import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lembreto.app',
  appName: 'Lembreto',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
