// Local save API for the editor's Vite dev server (SPEC §3 저장, §8 저장).
//   GET /api/campuses/:id  → { files: [{ path, text }] }   (missing folder → no files)
//   PUT /api/campuses/:id  ← { files: { [path]: text } }   writes the whole campus folder
// Only dev-server, only paths of the SPEC §4.3 layout. People commit the result with Git.
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

const CAMPUS_ID = /^[a-z0-9][a-z0-9-]*$/;
/** Every path a campus folder may contain (SPEC §4.3). Anything else is refused. */
const CAMPUS_PATH = /^(campus\.json|outdoor\.geojson|connections\.geojson|buildings\/[A-Za-z0-9]+\/(building|L-?[1-9][0-9]*)\.geojson)$/;
const MAX_BODY_BYTES = 50 * 1024 * 1024;

export function isCampusPath(path: string): boolean {
  return CAMPUS_PATH.test(path);
}

export async function readCampusFiles(dir: string): Promise<{ path: string; text: string }[]> {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const files: { path: string; text: string }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    const path = relative(dir, abs).split(sep).join('/');
    if (isCampusPath(path)) files.push({ path, text: await readFile(abs, 'utf8') });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * Make the campus folder hold exactly `files`: write each one, and delete layout
 * files that are no longer in the set (e.g. a floor whose last node was removed).
 */
export async function writeCampusFiles(dir: string, files: Record<string, string>): Promise<{ written: string[]; removed: string[] }> {
  const bad = Object.keys(files).filter((p) => !isCampusPath(p));
  if (bad.length > 0) throw new HttpError(400, `저장할 수 없는 경로입니다: ${bad.join(', ')}`);

  const written: string[] = [];
  for (const [path, text] of Object.entries(files).sort()) {
    const abs = join(dir, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, text, 'utf8');
    written.push(path);
  }

  const removed: string[] = [];
  for (const { path } of await readCampusFiles(dir)) {
    if (path in files || !path.endsWith('.geojson')) continue;
    await rm(join(dir, path));
    removed.push(path);
  }
  // Drop building folders (and buildings/) left empty. rmdir only succeeds on empty folders.
  for (const path of removed) {
    await rmdir(dirname(join(dir, path))).catch(() => {});
  }
  if (removed.some((p) => p.startsWith('buildings/'))) await rmdir(join(dir, 'buildings')).catch(() => {});
  return { written, removed };
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Connect-style handler; exported for tests. */
export function createCampusApi(campusesDir: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const match = /^\/api\/campuses\/([^/?#]+)\/?(?:\?.*)?$/.exec(req.url ?? '');
    if (!match) return next();
    try {
      const id = decodeURIComponent(match[1]!);
      if (!CAMPUS_ID.test(id)) throw new HttpError(400, `캠퍼스 id가 올바르지 않습니다: ${id}`);
      const dir = join(campusesDir, id);

      if (req.method === 'GET') {
        return send(res, 200, { files: await readCampusFiles(dir) });
      }
      if (req.method === 'PUT') {
        const body = JSON.parse(await readBody(req)) as { files?: unknown };
        if (typeof body.files !== 'object' || body.files === null ||
          !Object.values(body.files).every((t) => typeof t === 'string')) {
          throw new HttpError(400, '요청 본문은 { files: { 경로: 내용 } } 형식이어야 합니다.');
        }
        return send(res, 200, await writeCampusFiles(dir, body.files as Record<string, string>));
      }
      throw new HttpError(405, `${req.method ?? ''} 요청은 지원하지 않습니다.`);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err instanceof SyntaxError ? 400 : 500;
      return send(res, status, { error: (err as Error).message });
    }
  };
}

/** Vite plugin: mounts the API on the dev server only. */
export function campusApiPlugin(campusesDir: string): Plugin {
  return {
    name: 'campo-campus-api',
    apply: 'serve',
    configureServer(server) {
      const handle = createCampusApi(campusesDir);
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '저장할 데이터가 너무 큽니다.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
