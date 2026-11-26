// PC 편집기(`npm run editor`)는 이 PC 디스크에만 저장한다: 앱·서버에 반영되지 않는다는 안내가 늘 보이고 저장할 때마다 나온다.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCAL_SAVE_BADGE, LOCAL_SAVE_NOTICE, SERVER_MODE, SERVER_SAVED_TAIL, saveTargetNotice } from '../src/storage.ts';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const WORKSPACE = source('../src/app/Workspace.tsx');
const STATUS = source('../src/ui/StatusBar.tsx');
const CSS = source('../src/styles.css');

describe('PC 편집기 저장 위치 안내', () => {
  it('문구: 이 PC에만 저장, 앱·서버 반영은 관리자 웹 매핑(/map/) 저장 또는 폴더 올리기', () => {
    expect(LOCAL_SAVE_NOTICE).toBe('이 저장은 이 PC에만 저장됩니다 — 앱·서버 반영은 관리자 웹의 매핑(/map/)에서 저장하거나 폴더 올리기를 쓰세요.');
    expect(LOCAL_SAVE_BADGE).toContain('이 PC에만 저장');
    expect(LOCAL_SAVE_BADGE).toContain('/map/');
  });
  it('PC 편집기(서버 빌드가 아니면)에서만 보인다', () => {
    expect(SERVER_MODE).toBe(false); // 테스트 환경 = PC 편집기
    expect(saveTargetNotice()).toBe(LOCAL_SAVE_NOTICE);
    expect(saveTargetNotice(false)).toBe(LOCAL_SAVE_NOTICE);
    expect(saveTargetNotice(true)).toBeNull();
  });
  it('상태 막대에 늘 보이고(눈에 띄는 호박색 표시), 저장 알림에도 붙는다', () => {
    expect(WORKSPACE).toContain('saveTarget={saveTargetNotice()}');
    expect(STATUS).toContain('{saveTarget && <span className="status-save-target" role="note" aria-label={saveTarget} title={saveTarget}>{LOCAL_SAVE_BADGE}</span>}');
    expect(STATUS).toContain("saveTarget ? '이 PC에 저장됨' : '저장됨'");
    expect(CSS).toMatch(/\.status-save-target \{[^}]*background: #ffd25e/);
    expect(WORKSPACE).toContain('info(`이 PC에 저장했습니다. 쓴 파일 ${result.written.length}개${removedText}. ${LOCAL_SAVE_NOTICE}`);');
  });
  it('서버 빌드 저장 알림은 앱에 들어가는 길(지도 새로고침·10분 뒤 복귀·재실행)을 알려 준다', () => {
    expect(SERVER_SAVED_TAIL).toContain('지도 새로고침');
    expect(WORKSPACE).toContain('${SERVER_SAVED_TAIL}');
  });
});
