// Google Gemini generateContent over plain fetch (no SDK). Returns the text of the first candidate.
import { ProviderError, type EnvGet, type ProviderInput } from '../types.ts';

export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';

export async function callGemini(input: ProviderInput, env: EnvGet, fetchImpl: typeof fetch = fetch): Promise<string> {
  const key = env('GEMINI_API_KEY');
  if (!key) throw new ProviderError('GEMINI_API_KEY가 없습니다.');
  const model = env('GEMINI_MODEL') || GEMINI_DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts: [{ text: input.prompt }, { inline_data: { mime_type: input.mimeType, data: input.imageBase64 } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) {
    throw new ProviderError(`Gemini에 연결하지 못했습니다. ${(err as Error).message}`);
  }
  const json = (await res.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  } | null;
  if (!res.ok) throw new ProviderError(`Gemini 오류(HTTP ${res.status}): ${json?.error?.message ?? '응답 없음'}`, res.status);
  const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (text.trim() === '') throw new ProviderError('Gemini가 빈 응답을 보냈습니다.', res.status);
  return text;
}
