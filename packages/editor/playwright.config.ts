// e2e of the editor. The dev server runs on its own port and saves into a temporary folder, never into data/.
// Run from the repository root:  npx playwright test -c packages/editor
import { defineConfig } from '@playwright/test';
import { CHANGESETS_DIR, E2E_DIR, PORT, REPORTS_DIR } from './e2e/seed.ts';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1440, height: 900 }, browserName: 'chromium' },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    cwd: '.',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { CAMPO_CAMPUSES_DIR: E2E_DIR, CAMPO_REPORTS_DIR: REPORTS_DIR, CAMPO_CHANGESETS_DIR: CHANGESETS_DIR },
  },
});
