// Paths and secrets. The .env file lives at the repository root (already in .gitignore).
// Key values are never printed anywhere.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Repository root, worked out from this file's own location (src -> photo-pipeline -> supabase -> root). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const PIPELINE_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));
export const BUCKET = 'campus-photos';
export const TABLE = 'campus_photos';

export class ConfigError extends Error {}

/** Supabase client with the secret key. Only for scripts on your own computer, never in an app or a browser. */
export function adminClient(): SupabaseClient {
  if (existsSync(ENV_PATH)) loadDotenv({ path: ENV_PATH, quiet: true });
  const url = process.env['SUPABASE_URL']?.trim();
  const key = (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? process.env['SUPABASE_SECRET_KEY'])?.trim();
  const missing: string[] = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!key) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) {
    throw new ConfigError(
      `저장소 맨 위의 .env 파일에 ${missing.join(', ')} 값이 없습니다. (찾은 위치: ${ENV_PATH}) README의 ".env 만들기"를 따라 주세요.`,
    );
  }
  if (/\/rest\/v1\/?$/.test(url!) || url!.endsWith('/')) {
    throw new ConfigError('SUPABASE_URL은 https://xxxx.supabase.co 까지만 적어 주세요(끝에 / 나 /rest/v1 없이).');
  }
  if (key!.startsWith('sb_publishable_')) {
    throw new ConfigError('SUPABASE_SERVICE_ROLE_KEY에 공개 키(sb_publishable_...)가 들어 있습니다. 비밀 키(sb_secret_...)를 넣어 주세요.');
  }
  return createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
}
