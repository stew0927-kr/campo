/** Accept public HTTPS links only; never turn missing source URLs into invented links. */
export function publicLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null; } catch { return null; }
}
export async function openPublicLink(value: string | null, open: (url: string) => Promise<unknown>): Promise<string | null> {
  const url = publicLink(value);
  if (!url) return '제공된 안전한 원문 링크가 없습니다.';
  try { await open(url); return null; } catch { return '링크를 열지 못했습니다. 인터넷 연결과 브라우저를 확인해 주세요.'; }
}
