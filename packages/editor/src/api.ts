import type { LoadedFile } from '@campo/core';
import type { TerrainGrid, TerrainWall } from './model/terrain3d.ts';

export async function fetchCampusFiles(campusId: string): Promise<LoadedFile[]> {
  const res = await fetch(`/api/campuses/${encodeURIComponent(campusId)}`);
  const body = (await res.json()) as { files?: LoadedFile[]; error?: string };
  if (!res.ok || !body.files) throw new Error(body.error ?? `불러오지 못했습니다 (HTTP ${res.status}).`);
  return body.files;
}

export async function saveCampus(campusId: string, files: Record<string, string>): Promise<{ written: string[]; removed: string[] }> {
  const res = await fetch(`/api/campuses/${encodeURIComponent(campusId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  const body = (await res.json()) as { written?: string[]; removed?: string[]; error?: string };
  if (!res.ok || !body.written) throw new Error(body.error ?? `저장하지 못했습니다 (HTTP ${res.status}).`);
  return { written: body.written, removed: body.removed ?? [] };
}

// ---- 제보 and changesets (dev server only) ----

export interface ReportFileText {
  path: string;
  text: string;
}

export async function fetchReportFiles(): Promise<ReportFileText[]> {
  const res = await fetch('/api/reports');
  const body = (await res.json()) as { reports?: ReportFileText[]; error?: string };
  if (!res.ok || !body.reports) throw new Error(body.error ?? `제보를 불러오지 못했습니다 (HTTP ${res.status}).`);
  return body.reports;
}

/** Rewrite report files that exist. */
export async function saveReportFiles(files: Record<string, string>): Promise<string[]> {
  const res = await fetch('/api/reports', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  const body = (await res.json()) as { written?: string[]; error?: string };
  if (!res.ok || !body.written) throw new Error(body.error ?? `제보 파일을 저장하지 못했습니다 (HTTP ${res.status}).`);
  return body.written;
}

// ---- 현장 기록 (dev server only) ----

export async function fetchSurveyFiles(): Promise<{ id: string; text: string }[]> {
  const res = await fetch('/api/surveys');
  const body = (await res.json()) as { surveys?: { id: string; text: string }[]; error?: string };
  if (!res.ok || !body.surveys) throw new Error(body.error ?? `현장 기록을 불러오지 못했습니다 (HTTP ${res.status}).`);
  return body.surveys;
}

/** Keep an imported survey under data/surveys/<id>/: survey.json and its photos (base64 by file name). */
export async function saveSurvey(id: string, text: string, photos: Record<string, string>): Promise<string[]> {
  const res = await fetch(`/api/surveys/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, photos }),
  });
  const body = (await res.json()) as { written?: string[]; error?: string };
  if (!res.ok || !body.written) throw new Error(body.error ?? `현장 기록을 저장하지 못했습니다 (HTTP ${res.status}).`);
  return body.written;
}

/** Write changesets/<fileName>. */
export async function saveChangeset(fileName: string, text: string): Promise<{ written: boolean }> {
  const res = await fetch(`/api/changesets/${encodeURIComponent(fileName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const body = (await res.json()) as { written?: boolean; error?: string };
  if (!res.ok || body.written === undefined) throw new Error(body.error ?? `changeset 파일을 저장하지 못했습니다 (HTTP ${res.status}).`);
  return { written: body.written };
}

// ---- 고도 (dev server only, server/elevation-api.ts) ----

export interface ElevationInfo {
  /** The elevation store text (break lines and measured Δh), or null when there is none yet. */
  store: string | null;
  solver: { ready: boolean; missing: string[] };
}

export type { TerrainWall } from './model/terrain3d.ts';

/**
 * 지형 3D's height grid: the solver's corrected grid, else the DEM, else null (the view then offers a sample); and the
 * 1 m sections across the drawn retaining walls (none from an older server).
 */
export async function fetchTerrain(campusId: string): Promise<{ grid: TerrainGrid | null; walls: TerrainWall[]; plazaHeights: Record<string, number> }> {
  const res = await fetch(`/api/elevation/${encodeURIComponent(campusId)}/terrain`);
  const body = (await res.json()) as { grid?: TerrainGrid | null; walls?: TerrainWall[]; plazaHeights?: Record<string, number>; error?: string };
  if (!res.ok) throw new Error(body.error ?? `고도 그리드를 불러오지 못했습니다 (HTTP ${res.status}).`);
  const plazaHeights = typeof body.plazaHeights === 'object' && body.plazaHeights !== null ? body.plazaHeights : {};
  return { grid: body.grid ?? null, walls: Array.isArray(body.walls) ? body.walls : [], plazaHeights };
}

export async function fetchElevation(campusId: string): Promise<ElevationInfo> {
  const res = await fetch(`/api/elevation/${encodeURIComponent(campusId)}`);
  const body = (await res.json()) as Partial<ElevationInfo> & { error?: string };
  if (!res.ok || !body.solver) throw new Error(body.error ?? `고도 정보를 불러오지 못했습니다 (HTTP ${res.status}).`);
  return { store: body.store ?? null, solver: body.solver };
}

export async function saveElevationStore(campusId: string, text: string): Promise<void> {
  const res = await fetch(`/api/elevation/${encodeURIComponent(campusId)}/store`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const body = (await res.json()) as { written?: boolean; error?: string };
  if (!res.ok || !body.written) throw new Error(body.error ?? `고도 단절선을 저장하지 못했습니다 (HTTP ${res.status}).`);
}

/** Send the recompute request and the campus as it would be saved; the solver's derived/elevation.json comes back. */
export async function requestRecompute(campusId: string, request: unknown, files: Record<string, string>): Promise<{ derived: unknown; mode: 'solved' | 'existing'; log: string }> {
  const res = await fetch(`/api/elevation/${encodeURIComponent(campusId)}/recompute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request, files }),
  });
  const body = (await res.json()) as { derived?: unknown; mode?: 'solved' | 'existing'; log?: string; error?: string };
  if (!res.ok || body.derived === undefined || !body.mode) throw new Error(body.error ?? `고도를 다시 계산하지 못했습니다 (HTTP ${res.status}).`);
  return { derived: body.derived, mode: body.mode, log: body.log ?? '' };
}
