import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { campusApiPlugin } from './server/campus-api.ts';

// CAMPO_CAMPUSES_DIR points the save API at another folder (the e2e tests use a temporary one; data/ is never touched by them).
const campusesDir = process.env['CAMPO_CAMPUSES_DIR'] ?? fileURLToPath(new URL('../../data/campuses', import.meta.url));

// Reports and changesets likewise: CAMPO_REPORTS_DIR (default data/reports, read recursively) and CAMPO_CHANGESETS_DIR (default changesets/ at the repository root).
const reportsDir = process.env['CAMPO_REPORTS_DIR'] ?? fileURLToPath(new URL('../../data/reports', import.meta.url));
const changesetsDir = process.env['CAMPO_CHANGESETS_DIR'] ?? fileURLToPath(new URL('../../changesets', import.meta.url));

// Field surveys imported from the survey app: CAMPO_SURVEYS_DIR (default data/surveys; survey.json is committed, photos/ is not).
const surveysDir = process.env['CAMPO_SURVEYS_DIR'] ?? fileURLToPath(new URL('../../data/surveys', import.meta.url));

export default defineConfig({
  plugins: [react(), campusApiPlugin({ campusesDir, reportsDir, changesetsDir, surveysDir })],
  server: { host: '127.0.0.1' }, // the save API writes to disk: keep it on this machine only
  test: {
    name: 'editor',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
