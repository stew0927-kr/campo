// Builds the map editor (packages/editor) for the admin web's 매핑 tab and puts it in admin/dist/map/.
// Runs after `vite build` (npm run build). The editor is built in its server mode (VITE_EDITOR_STORAGE=supabase) with the
// same URL and publishable key as the admin web, read from admin/.env.local — no second env file, and a PC editor
// (`npm run editor`) is never switched to the server by this.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const admin = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(admin, '..');
const out = join(admin, 'dist', 'map');

const fail = (msg) => {
  console.error(`\n[매핑 편집기 빌드] ${msg}\n`);
  process.exit(1);
};

const env = loadEnv('production', admin, 'VITE_');
const url = env.VITE_SUPABASE_URL?.trim();
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
if (!url || !key) fail('admin/.env.local에 VITE_SUPABASE_URL과 VITE_SUPABASE_PUBLISHABLE_KEY가 있어야 합니다.');
if (key.startsWith('sb_secret_')) fail('비밀 키(sb_secret_...)는 브라우저용 빌드에 넣으면 안 됩니다. 공개 키(sb_publishable_...)를 적어 주세요.');

// The editor's packages come from the repository's npm workspaces (root node_modules), not from admin/node_modules.
const needed = ['maplibre-gl', 'terra-draw', '@supabase/supabase-js', 'vite'];
const missing = needed.filter((p) => !existsSync(join(root, 'node_modules', p)) && !existsSync(join(root, 'packages', 'editor', 'node_modules', p)));
if (missing.length > 0) {
  fail(`편집기 패키지가 설치되어 있지 않습니다(${missing.join(', ')}). 저장소 맨 위 폴더에서 아래를 한 번 실행한 뒤 다시 npm run build 하세요.\n  npm install -w @campo/editor -w @campo/core --include-workspace-root`);
}

const result = spawnSync('npm', ['run', 'build', '-w', '@campo/editor', '--', '--base=/map/', `--outDir=${out}`, '--emptyOutDir'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_EDITOR_STORAGE: 'supabase', VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key },
});
if (result.status !== 0) fail('편집기 빌드가 실패했습니다. 위의 오류를 확인해 주세요.');
if (!existsSync(join(out, 'index.html'))) fail(`${out}/index.html이 만들어지지 않았습니다.`);
console.log(`\n[매핑 편집기 빌드] admin/dist/map/ 에 넣었습니다. Cloudflare에는 지금처럼 dist 폴더 전체를 올리면 됩니다.\n`);
