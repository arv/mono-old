import {defineConfig, devices} from 'playwright/test';

export default defineConfig({
  testDir: './playwright',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', {open: 'never'}]],
  timeout: 60_000,
  use: {
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome']},
    },
  ],
});
