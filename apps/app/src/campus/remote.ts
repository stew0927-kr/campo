// 서버(Supabase campus_map_files, supabase/migrations/0006_campus_maps.sql)의 캠퍼스 지도를 앱 번들 모양으로 받는다.
// 읽기 규칙은 콘텐츠와 같은 createPublicReader(HTTPS만, 공개 키만, GET, 5초 제한, 500행씩).
// 실패·오프라인·빈 응답·campus.json 없음·읽을 수 없는 지도면 앱에 들어 있는 지도(bundledCampus)로 돌아간다. 어떤 실패도 던지지 않는다.
import type { LoadedFile } from '@campo/core';
import { createPublicReader, type ReadConfig } from '../features/content/remote.ts';
import { resolveCampusData } from './resolve.ts';
import type { BundledCampus } from './types.ts';
import type { CampusData } from '../contracts.ts';

/** 팀이 매핑하는 캠퍼스(편집기·관리자 웹의 기본값과 같음). */
export const CAMPUS_ID = 'hanyang-seoul';

/** 서버가 두는 경로: 편집기 개발 서버(CAMPUS_PATH)·0006의 check와 같은 규칙. */
const MAP_PATH = /^(campus\.json|outdoor\.geojson|connections\.geojson|buildings\/[A-Za-z0-9]+\/(building|L-?[1-9][0-9]*)\.geojson)$/;

export const NOTICE = {
  noConnection: '서버에 연결할 수 없어 앱에 들어 있는 지도를 보여 줍니다.',
  failed: '서버 지도를 받지 못해 앱에 들어 있는 지도를 보여 줍니다.',
  unreadable: '서버 지도를 읽지 못해 앱에 들어 있는 지도를 보여 줍니다.',
} as const;

/** 서버 지도 파일을 읽는 함수. 실패하면 던진다(loadRemoteCampus가 받아서 폴백한다). */
export type CampusMapReader = () => Promise<LoadedFile[]>;

export function createCampusMapReader(config: ReadConfig, fetcher: typeof fetch = fetch, campus: string = CAMPUS_ID): CampusMapReader {
  const read = createPublicReader(config, fetcher);
  return async () => {
    const rows = await read('campus_map_files', { campus_id: `eq.${campus}`, select: 'path,text', order: 'path.asc' });
    const files: LoadedFile[] = [];
    for (const row of rows) {
      if (row === null || typeof row !== 'object') throw new Error('지도 응답 형식이 올바르지 않습니다.');
      const { path, text } = row as Record<string, unknown>;
      if (typeof path !== 'string' || typeof text !== 'string' || !MAP_PATH.test(path)) throw new Error('지도 파일 항목이 올바르지 않습니다.');
      files.push({ path, text });
    }
    if (files.length === 0) throw new Error('서버에 지도가 없습니다.');
    if (!files.some((f) => f.path === 'campus.json')) throw new Error('서버 지도에 campus.json이 없습니다.');
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return files;
  };
}

export interface RemoteCampus {
  /** 서버에서 받은 번들. 못 받았으면 null(그때는 앱 번들). */
  bundle: BundledCampus | null;
  source: 'server' | 'bundled';
  /** 지도 화면의 작은 안내 줄. 서버 지도를 받았으면 null. */
  message: string | null;
}

export async function loadRemoteCampus(read: CampusMapReader | null, campus: string = CAMPUS_ID): Promise<RemoteCampus> {
  if (!read) return { bundle: null, source: 'bundled', message: NOTICE.noConnection };
  try {
    return { bundle: { campus, files: await read() }, source: 'server', message: null };
  } catch {
    return { bundle: null, source: 'bundled', message: NOTICE.failed };
  }
}

/**
 * 화면에 줄 CampusData: 서버 번들이 있으면 그것을, 그 지도가 읽히지 않으면(깨진 저장 등) 앱 번들을 읽는다.
 * 앱 번들로 돌아간 이유는 issues 맨 앞의 안내 한 줄로만 알린다.
 */
export function campusDataWithFallback(remote: RemoteCampus | null, bundled: BundledCampus): CampusData {
  if (remote?.bundle) {
    const fromServer = resolveCampusData(remote.bundle);
    if (fromServer.status === 'ready') return fromServer;
    const fallback = resolveCampusData(bundled);
    return { ...fallback, issues: [NOTICE.unreadable, ...fallback.issues] };
  }
  const data = resolveCampusData(bundled);
  return remote?.message ? { ...data, issues: [remote.message, ...data.issues] } : data;
}
