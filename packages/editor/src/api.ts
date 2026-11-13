import type { LoadedFile } from '@campo/core';

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
