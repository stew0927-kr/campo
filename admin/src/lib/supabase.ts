// One Supabase client for the whole admin web. Uses ONLY the publishable (public) key:
// what an admin may do is decided by the database's RLS rules, not by this code.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '';
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? '';

/** Korean message when .env.local is missing or wrong; null when the client is usable. */
export const configProblem: string | null = !url || !key
  ? 'admin/.env.local 파일에 VITE_SUPABASE_URL과 VITE_SUPABASE_PUBLISHABLE_KEY를 적은 뒤 npm run dev를 다시 실행해 주세요.'
  : key.startsWith('sb_secret_')
    ? '비밀 키(sb_secret_...)는 브라우저에 넣으면 안 됩니다. .env.local에 공개 키(sb_publishable_...)를 적어 주세요.'
    : null;

export const supabase: SupabaseClient = createClient(url || 'http://invalid.localhost', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
});
