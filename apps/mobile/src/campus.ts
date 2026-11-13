// The campus bundled into the app (scripts/bundle-campus.mjs) as the walk's starting state.
import { fromCampus, parseCampus, type CampusMeta, type EditState, type LoadedFile, type Position } from '@campo/core';

export interface BundledCampus {
  campus: string;
  files: LoadedFile[];
}

export interface Campus {
  id: string;
  name: string;
  center: Position;
  base: EditState;
  /** Features the app could not read (shown once at start; the editor's 오류 검사 has the details). */
  issues: number;
}

export function loadCampus(bundle: BundledCampus): Campus {
  const loaded = parseCampus(bundle.files);
  const meta = loaded.meta as Partial<CampusMeta> | undefined;
  if (!meta || typeof meta.id !== 'string' || !Array.isArray(meta.center)) throw new Error('campus.json을 읽을 수 없습니다.');
  const { state, issues } = fromCampus(loaded);
  return { id: meta.id, name: meta.name ?? meta.id, center: meta.center, base: state, issues: issues.length + loaded.fileErrors.length };
}
