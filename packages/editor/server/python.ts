// Which Python runs the height solver (dev server only).
//   CAMPO_PYTHON set: that command (may carry arguments, e.g. "py -3"), nothing else is tried.
//   Not set: a virtual environment near the repository (VIRTUAL_ENV, <root>/.venv, <root>/venv, tools/elevation/.venv),
//   then the OS's usual names: Windows python → py -3 → python3 (python3 there is often the Microsoft Store stub),
//   elsewhere python3 → python. Each is asked for its major version once; the first Python 3 wins and is remembered.
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { Readable } from 'node:stream';

export interface PythonCommand {
  /** The program spawned. */
  file: string;
  /** Arguments that come before the script (e.g. ["-3"] for the Windows launcher). */
  args: string[];
}

export interface ProbeResult {
  ok: boolean;
  /** What went wrong (spawn error, exit code, stderr), when not ok. */
  detail: string;
}
export type Probe = (cmd: PythonCommand) => Promise<ProbeResult>;

export const showCommand = (c: PythonCommand): string => [c.file, ...c.args].map((s) => (/\s/.test(s) ? `"${s}"` : s)).join(' ');

/** "py -3" → { file: "py", args: ["-3"] }; a quoted path keeps its spaces. */
export function parseCommand(text: string): PythonCommand {
  const parts = [...text.trim().matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
  return { file: parts[0] ?? '', args: parts.slice(1) };
}

/** The commands to try, in order. `exists` is injectable for tests. */
export function pythonCandidates(opts: {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** Folders whose .venv / venv count (the repository root, tools/elevation). */
  roots: readonly string[];
  exists?: (path: string) => boolean;
}): PythonCommand[] {
  const configured = opts.env['CAMPO_PYTHON']?.trim();
  if (configured) return [parseCommand(configured)];
  const exists = opts.exists ?? existsSync;
  const win = opts.platform === 'win32';
  const { join } = win ? win32 : posix;
  const inVenv = (dir: string) => (win ? join(dir, 'Scripts', 'python.exe') : join(dir, 'bin', 'python'));
  const venvs = [opts.env['VIRTUAL_ENV'], ...opts.roots.flatMap((r) => [join(r, '.venv'), join(r, 'venv')])]
    .filter((d): d is string => !!d)
    .map(inVenv)
    .filter((p, i, all) => all.indexOf(p) === i && exists(p));
  const names: PythonCommand[] = win
    ? [{ file: 'python', args: [] }, { file: 'py', args: ['-3'] }, { file: 'python3', args: [] }]
    : [{ file: 'python3', args: [] }, { file: 'python', args: [] }];
  return [...venvs.map((file) => ({ file, args: [] })), ...names];
}

const tail = (text: string, lines = 6) => text.trim().split(/\r?\n/).slice(-lines).join('\n');

/** Runs `<python> -c "import sys; print(sys.version_info[0])"`: ok when it prints 3. */
export const probePython: Probe = (cmd) => new Promise((resolve) => {
  let out = '';
  let err = '';
  let child: ChildProcessByStdio<null, Readable, Readable>;
  try {
    child = spawn(cmd.file, [...cmd.args, '-c', 'import sys; print(sys.version_info[0])'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (e) {
    resolve({ ok: false, detail: (e as Error).message });
    return;
  }
  const timer = setTimeout(() => child.kill(), 10_000);
  child.stdout.on('data', (b: Buffer) => { out += b.toString('utf8'); });
  child.stderr.on('data', (b: Buffer) => { err += b.toString('utf8'); });
  child.on('error', (e) => {
    clearTimeout(timer);
    resolve({ ok: false, detail: e.message });
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0 && out.trim() === '3') resolve({ ok: true, detail: '' });
    else resolve({ ok: false, detail: code === 0 ? `Python 3이 아닙니다(출력: ${out.trim() || '없음'})` : `종료 코드 ${code}${err.trim() ? `, stderr: ${tail(err, 3)}` : ''}` });
  });
});

/** The first candidate that is a working Python 3, or an error (Korean) naming every command tried and why it failed. */
export async function findPython(candidates: readonly PythonCommand[], probe: Probe = probePython): Promise<PythonCommand | { error: string }> {
  const failed: string[] = [];
  for (const c of candidates) {
    const r = await probe(c);
    if (r.ok) return c;
    failed.push(`${showCommand(c)} → ${r.detail}`);
  }
  return {
    error: `고도 계산에 쓸 Python 3을 찾지 못했습니다. 시도한 명령: ${failed.join(' / ')}. `
      + 'Python 3을 설치하거나 환경 변수 CAMPO_PYTHON에 실행 파일 경로(예: C:\\Python312\\python.exe 또는 "py -3")를 넣어 주세요.',
  };
}

export { tail as outputTail };
