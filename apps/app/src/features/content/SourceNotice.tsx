import { Button, Notice } from '../../ui/kit.tsx';
import type { AppContentState } from './useAppContent.ts';
export interface SourceProps { sourceMode?: AppContentState['mode']; sourceNotice?: string | null; onReload?: (() => void) | undefined }
export function SourceNotice({ sourceMode = 'demo', sourceNotice, onReload, demoText }: SourceProps & { demoText: string }) {
  return <><Notice>{sourceMode === 'live' ? '서버 공개 데이터를 표시합니다. 일정·장소와 데이터 자체의 시연 여부는 제공 기관의 공지를 확인해 주세요.' : demoText}{sourceNotice ? `\n${sourceNotice}` : ''}</Notice>{sourceNotice && onReload && <Button secondary title="서버 다시 조회" onPress={onReload} />}</>;
}
