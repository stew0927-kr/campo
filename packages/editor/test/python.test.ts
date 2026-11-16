import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autoPythonRunner, solverFailure } from '../server/elevation-api.ts';
import { findPython, parseCommand, pythonCandidates, showCommand, type Probe } from '../server/python.ts';

const names = (list: { file: string; args: string[] }[]) => list.map(showCommand);

describe('pythonCandidates (CAMPO_PYTHON 없을 때 고도 솔버의 Python 찾기)', () => {
  it('CAMPO_PYTHON wins alone, with its arguments', () => {
    expect(names(pythonCandidates({ platform: 'win32', env: { CAMPO_PYTHON: 'py -3' }, roots: [] }))).toEqual(['py -3']);
    expect(parseCommand('"C:\\Program Files\\Python312\\python.exe" -X utf8')).toEqual({ file: 'C:\\Program Files\\Python312\\python.exe', args: ['-X', 'utf8'] });
  });

  it('Windows: a venv near the repository first, then python, py -3, python3', () => {
    const root = 'C:\\repo';
    const venvPython = win32.join(root, '.venv', 'Scripts', 'python.exe');
    const list = pythonCandidates({ platform: 'win32', env: {}, roots: [root], exists: (p) => p === venvPython });
    expect(names(list)).toEqual([venvPython, 'python', 'py -3', 'python3']);
  });

  it('elsewhere: VIRTUAL_ENV, then python3, python', () => {
    const list = pythonCandidates({ platform: 'linux', env: { VIRTUAL_ENV: '/home/u/env' }, roots: ['/repo'], exists: (p) => p.startsWith('/home/u/env') });
    expect(names(list)).toEqual([posix.join('/home/u/env', 'bin', 'python'), 'python3', 'python']);
  });
});

describe('findPython and the solver error message', () => {
  it('takes the first command that is Python 3, and names every failed one otherwise', async () => {
    const tried: string[] = [];
    const probe: Probe = async (c) => {
      tried.push(showCommand(c));
      return c.file === 'py' ? { ok: true, detail: '' } : { ok: false, detail: 'spawn python ENOENT' };
    };
    const list = pythonCandidates({ platform: 'win32', env: {}, roots: [], exists: () => false });
    expect(await findPython(list, probe)).toEqual({ file: 'py', args: ['-3'] });
    expect(tried).toEqual(['python', 'py -3']);
    const none = await findPython(list, async () => ({ ok: false, detail: '종료 코드 9009' }));
    expect('error' in none && none.error).toContain('python → 종료 코드 9009 / py -3 → 종료 코드 9009 / python3 → 종료 코드 9009');
  });

  it('a run with no Python reports the lookup; a failed run names the command and stderr', async () => {
    const run = autoPythonRunner('solver.py', { probe: async () => ({ ok: false, detail: 'spawn python3 ENOENT' }) });
    const r = await run(['--store', 's.json']);
    expect(r.code).toBe(-1);
    expect(solverFailure(r)).toContain('spawn python3 ENOENT');
    const msg = solverFailure({ code: 1, output: 'progress\nTraceback\nValueError: unsupported schemaVersion', stderr: 'Traceback\nValueError: unsupported schemaVersion', command: 'py -3 solver.py --store s.json' });
    expect(msg).toContain('종료 코드 1');
    expect(msg).toContain('실행한 명령: py -3 solver.py --store s.json');
    expect(msg).toContain('ValueError: unsupported schemaVersion');
  });

  it('the Python of this machine is found (python on PATH)', async () => {
    const found = await findPython(pythonCandidates({ platform: process.platform, env: {}, roots: [] }));
    // On a machine without Python this documents the message instead.
    if ('error' in found) expect(found.error).toContain('CAMPO_PYTHON');
    else expect(found.file.length).toBeGreaterThan(0);
  }, 30_000);
});
