import { Button, Notice } from '../../ui/kit.tsx';
import type { AppContentState } from './useAppContent.ts';
export interface SourceProps { sourceMode?: AppContentState['mode']; sourceNotice?: string | null; onReload?: (() => void) | undefined }
export function SourceNotice({ sourceMode = 'demo', sourceNotice, onReload, demoText }: SourceProps & { demoText: string }) {
  const text = sourceMode === 'live' ? sourceNotice ?? null : [demoText, sourceNotice].filter(Boolean).join('\n');
  return <>{text && <Notice>{text}</Notice>}{sourceNotice && onReload && <Button secondary title="다시 불러오기" onPress={onReload} />}</>;
}
