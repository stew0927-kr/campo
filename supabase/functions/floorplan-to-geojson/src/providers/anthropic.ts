// Anthropic Messages API over plain fetch (no SDK). Returns the text blocks of the reply joined.
import { ProviderError, type EnvGet, type ProviderInput } from '../types.ts';

/** Default model id. Set ANTHROPIC_MODEL to use another one. */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';

export async function callAnthropic(input: ProviderInput, env: EnvGet, fetchImpl: typeof fetch = fetch): Promise<string> {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new ProviderError('ANTHROPIC_API_KEY가 없습니다.');
  const body = {
    model: env('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL,
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: input.mimeType, data: input.imageBase64 } },
        { type: 'text', text: input.prompt },
      ],
    }],
  };
  let res: Response;
  try {
    res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ProviderError(`Anthropic에 연결하지 못했습니다. ${(err as Error).message}`);
  }
  const json = (await res.json().catch(() => null)) as { content?: { type?: string; text?: string }[]; error?: { message?: string } } | null;
  if (!res.ok) throw new ProviderError(`Anthropic 오류(HTTP ${res.status}): ${json?.error?.message ?? '응답 없음'}`, res.status);
  const text = (json?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  if (text.trim() === '') throw new ProviderError('Anthropic이 빈 응답을 보냈습니다.', res.status);
  return text;
}
