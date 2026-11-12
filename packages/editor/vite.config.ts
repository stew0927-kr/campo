import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { campusApiPlugin } from './server/campus-api.ts';

// CAMPO_CAMPUSES_DIR points the save API at another folder (the e2e tests use a temporary one; data/ is never touched by them).
const campusesDir = process.env['CAMPO_CAMPUSES_DIR'] ?? fileURLToPath(new URL('../../data/campuses', import.meta.url));

export default defineConfig({
  plugins: [react(), campusApiPlugin(campusesDir)],
  server: { host: '127.0.0.1' }, // the save API writes to disk: keep it on this machine only
  test: {
    name: 'editor',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
