import { useCallback, useEffect, useState } from 'react';
import type { ContentData, ContentSource } from './types.ts';
import { publishedContent } from './published.ts';
export type ContentState = { status: 'loading'; data: null; error: null } | { status: 'error'; data: null; error: string } | { status: 'ready'; data: ContentData; error: null };
export function useContent(source: ContentSource) {
  const [state, setState] = useState<ContentState>({ status: 'loading', data: null, error: null });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });
    void Promise.resolve().then(() => source.load()).then((data) => { if (!cancelled) setState({ status: 'ready', data: publishedContent(data), error: null }); }).catch(() => {
      if (!cancelled) setState({ status: 'error', data: null, error: '안내를 불러오지 못했습니다. 다시 시도해 주세요.' });
    });
    return () => { cancelled = true; };
  }, [source, generation]);
  return { ...state, reload };
}
