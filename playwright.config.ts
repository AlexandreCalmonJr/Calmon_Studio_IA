import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:3099',
    headless: true,
  },
  webServer: {
    command: 'npx tsx server.ts',
    url: 'http://127.0.0.1:3099/api/v1/system/health',
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      HOST: '127.0.0.1',
      PORT: '3099',
      NODE_ENV: 'production',
    },
  },
});

