import type { LoadedFile } from '@campo/core';
import type { TerrainGrid, TerrainWall } from './model/terrain3d.ts';
import type { TerrainTile } from './model/terrainFootprint.ts';

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
/**
 * Keep an imported survey on this PC: survey.json first, then each photo in a request of its own as raw bytes (a walk's
 * photos as one base64 JSON body ran the tab and the dev server out of memory). A photo that fails stops the save with
 * an error that says how far it got; importing the same file again is a retry that sends the photos again.
 */
export async function saveSurvey(
  id: string,
  text: string,
  photos: { names: readonly string[]; read: (name: string) => Uint8Array } = { names: [], read: () => new Uint8Array() },
): Promise<string[]> {
  const res = await fetch(`/api/surveys/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, photos: {} }),
  });
  const body = (await res.json().catch(() => ({}))) as { written?: string[]; error?: string };
  if (!res.ok || !body.written) throw new Error(body.error ?? `현장 기록을 저장하지 못했습니다 (HTTP ${res.status}).`);
  const written = [...body.written];
  let done = 0;
  const stopped = (why: string) => new Error(`${why} 사진 ${photos.names.length}장 중 ${done}장을 저장했습니다. 같은 파일을 다시 불러오면 이어서 저장합니다.`);
  for (const name of photos.names) {
    let bytes: Uint8Array;
    try {
      bytes = photos.read(name);
    } catch (err) {
      throw stopped(`사진 ${name}을(를) 파일에서 꺼내지 못했습니다(${(err as Error).message}).`);
    }
    let r: Response;
    try {
      r = await fetch(`/api/surveys/${encodeURIComponent(id)}/photos/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
      });
    } catch (err) {
      throw stopped(`사진 ${name}을(를) 보내지 못했습니다(${(err as Error).message}).`);
    }
    const b = (await r.json().catch(() => ({}))) as { written?: string[]; error?: string };
    if (!r.ok || !b.written) throw stopped(b.error ?? `사진 ${name}을(를) 저장하지 못했습니다 (HTTP ${r.status}).`);
    written.push(...b.written);
    done++;
  }
  return written;
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
 * 지형 3D's height grid: the solver's corrected grid, else the DEM, else null (the view then offers a sample); the 1 m
 * sections across the drawn retaining walls, and the 1 m tiles round each plaza (none of either from an older server).
 */
export async function fetchTerrain(campusId: string): Promise<{
  grid: TerrainGrid | null; walls: TerrainWall[]; plazaHeights: Record<string, number>; tiles: TerrainTile[];
}> {
  const res = await fetch(`/api/elevation/${encodeURIComponent(campusId)}/terrain`);
  const body = (await res.json()) as {
    grid?: TerrainGrid | null; walls?: TerrainWall[]; plazaHeights?: Record<string, number>; tiles?: TerrainTile[]; error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? `고도 그리드를 불러오지 못했습니다 (HTTP ${res.status}).`);
  const plazaHeights = typeof body.plazaHeights === 'object' && body.plazaHeights !== null ? body.plazaHeights : {};
  return { grid: body.grid ?? null, walls: Array.isArray(body.walls) ? body.walls : [], plazaHeights, tiles: Array.isArray(body.tiles) ? body.tiles : [] };
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

/** One Δh edge out of the store on the server (DELETE). The updated store text comes back, with the edge's two ends. */
export async function deleteElevationEdge(campusId: string, edgeId: string): Promise<{ store: string; removed: { edgeId: string; from: string; to: string } }> {
  const res = await fetch(`/api/elevation/${encodeURIComponent(campusId)}/edges/${encodeURIComponent(edgeId)}`, { method: 'DELETE' });
  const body = (await res.json().catch(() => ({}))) as { written?: boolean; store?: string; removed?: { edgeId: string; from: string; to: string }; error?: string };
  if (!res.ok || !body.written || typeof body.store !== 'string' || !body.removed) throw new Error(body.error ?? `높이 차를 지우지 못했습니다 (HTTP ${res.status}).`);
  return { store: body.store, removed: body.removed };
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
