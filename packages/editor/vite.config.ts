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

// 고도 다시 계산: CAMPO_ELEVATION_DIR (default derived/, one folder per campus: store.json, dem.json, elevation.json, solve/),
// CAMPO_ELEVATION_DEM (one DEM for every campus), CAMPO_ELEVATION_SIGMA_DEM (--sigma-dem), CAMPO_PYTHON (default python3).
const elevation = {
  elevationDir: process.env['CAMPO_ELEVATION_DIR'] ?? fileURLToPath(new URL('../../derived', import.meta.url)),
  solverScript: fileURLToPath(new URL('../../tools/elevation/campo_height_solver.py', import.meta.url)),
  demPath: process.env['CAMPO_ELEVATION_DEM'],
  sigmaDem: process.env['CAMPO_ELEVATION_SIGMA_DEM'],
  python: process.env['CAMPO_PYTHON'] ?? 'python3',
};

export default defineConfig({
  plugins: [react(), campusApiPlugin({ campusesDir, reportsDir, changesetsDir, surveysDir, elevation })],
  server: { host: '127.0.0.1' }, // the save API writes to disk: keep it on this machine only
  test: {
    name: 'editor',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
