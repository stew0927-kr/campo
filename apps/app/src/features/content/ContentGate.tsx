import type { ReactNode } from 'react';
import type { ContentData } from './types.ts';
import type { useContent } from './repository.ts';
import { Body, Button, Card, Loading } from '../../ui/kit.tsx';
export function ContentGate({ content, children }: { content: ReturnType<typeof useContent>; children: (data: ContentData) => ReactNode }) {
  if (content.status === 'loading') return <Loading />;
  if (content.status === 'error') return <Card><Body>{content.error}</Body><Button title="다시 불러오기" onPress={content.reload} /></Card>;
  return children(content.data);
}
