import { parseCampus } from '@campo/core';
import { docFromLoaded, type CampusDoc } from './model/document.ts';
import { docToFiles } from './model/files.ts';

export async function fetchCampus(campusId: string): Promise<CampusDoc> {
  const res = await fetch(`/api/campuses/${encodeURIComponent(campusId)}`);
  const body = (await res.json()) as { files?: { path: string; text: string }[]; error?: string };
  if (!res.ok || !body.files) throw new Error(body.error ?? `불러오지 못했습니다 (HTTP ${res.status}).`);
  return docFromLoaded(campusId, parseCampus(body.files));
}

export async function saveCampus(doc: CampusDoc, files = docToFiles(doc)): Promise<{ written: string[]; removed: string[] }> {
  const res = await fetch(`/api/campuses/${encodeURIComponent(doc.campusId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  const body = (await res.json()) as { written?: string[]; removed?: string[]; error?: string };
  if (!res.ok || !body.written) throw new Error(body.error ?? `저장하지 못했습니다 (HTTP ${res.status}).`);
  return { written: body.written, removed: body.removed ?? [] };
}
