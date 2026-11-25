// 매핑 탭의 지도 파일 칸: 서버 지도 상태, zip 내려받기(백업), 폴더 올리기(비교 목록을 보고 한 번에 저장).
// 저장은 save_campus_map()(supabase/migrations/0006_campus_maps.sql) 한 번: 관리자만, 그 사이 다른 저장이 있으면 멈춤,
// 내용이 같은 파일은 다시 쓰지 않음, 전부 한 트랜잭션.
import { strToU8, zipSync } from 'fflate';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  byteSize,
  CAMPUS_ID,
  compareWithServer,
  formatBytes,
  kstLabel,
  scanFolder,
  stateOf,
  zipEntries,
  zipName,
  type Comparison,
  type FolderScan,
  type ServerFile,
} from '../lib/campusFiles.ts';
import { koreanError } from '../lib/convert.ts';
import { supabase } from '../lib/supabase.ts';

type Status = { kind: 'ok' | 'error'; text: string } | null;
const PAGE = 500;

/** Every row of the campus, page by page. */
async function loadServerFiles(): Promise<ServerFile[]> {
  const all: ServerFile[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('campus_map_files')
      .select('path,text,updated_at')
      .eq('campus_id', CAMPUS_ID)
      .order('path')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data ?? []) as ServerFile[]));
    if (!data || data.length < PAGE) return all;
  }
}

export function MapFilesPanel() {
  const [server, setServer] = useState<ServerFile[] | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [scan, setScan] = useState<FolderScan | null>(null);
  const [prune, setPrune] = useState(false);
  const [busy, setBusy] = useState<'load' | 'read' | 'upload' | 'zip' | null>('load');
  const [status, setStatus] = useState<Status>(null);
  const input = useRef<HTMLInputElement>(null);

  // React has no prop for folder picking; the attribute works in Chrome, Edge, Safari and Firefox.
  useEffect(() => {
    input.current?.setAttribute('webkitdirectory', '');
    input.current?.setAttribute('directory', '');
  }, []);

  const refresh = useCallback(async (): Promise<ServerFile[] | null> => {
    setBusy('load');
    try {
      const rows = await loadServerFiles();
      setServer(rows);
      setServerError(null);
      return rows;
    } catch (e) {
      setServerError(koreanError(e as { message?: string; code?: string }));
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const comparison: Comparison | null = scan && server ? compareWithServer(scan.files, server) : null;
  const toWrite = comparison ? comparison.added.length + comparison.changed.length : 0;
  const toRemove = comparison && prune ? comparison.serverOnly.length : 0;
  const lastSaved = server && server.length > 0 ? server.reduce((a, b) => (a.updated_at > b.updated_at ? a : b)).updated_at : null;

  const onPick = async (list: FileList | null) => {
    setStatus(null);
    setScan(null);
    setPrune(false);
    if (!list || list.length === 0) return;
    setBusy('read');
    try {
      const picked = Array.from(list, (f) => ({ relativePath: f.webkitRelativePath || f.name, size: f.size, read: () => f.text() }));
      const result = await scanFolder(picked);
      if ('error' in result) setStatus({ kind: 'error', text: result.error });
      else setScan(result);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  const upload = async () => {
    if (!scan || !server || !comparison) return;
    const parts = [`새 파일 ${comparison.added.length}개`, `바뀐 파일 ${comparison.changed.length}개`];
    if (toRemove > 0) parts.push(`지울 파일 ${toRemove}개`);
    if (!window.confirm(`${parts.join(', ')}를 서버에 올릴까요? 앱은 다음 실행 때 이 지도를 받습니다.`)) return;
    setBusy('upload');
    setStatus(null);
    const { data, error } = await supabase.rpc('save_campus_map', {
      p_campus_id: CAMPUS_ID,
      p_files: scan.files,
      p_expected: stateOf(server),
      p_prune: prune,
    });
    setBusy(null);
    if (error) {
      if (error.code === 'PT409') {
        await refresh();
        setStatus({ kind: 'error', text: '그 사이 다른 곳에서 지도를 저장했습니다. 아래 비교 목록이 새로 바뀌었으니 다시 확인한 뒤 올려 주세요.' });
      } else {
        setStatus({ kind: 'error', text: koreanError(error) });
      }
      return;
    }
    const result = data as { written: string[]; removed: string[] };
    await refresh();
    setPrune(false);
    setStatus({
      kind: 'ok',
      text: `서버에 올렸습니다: 저장 ${result.written.length}개${result.removed.length ? `, 삭제 ${result.removed.length}개` : ''}. 앱은 다음 실행 때 받아 갑니다.`,
    });
  };

  const download = async () => {
    setBusy('zip');
    setStatus(null);
    try {
      const rows = await loadServerFiles();
      if (rows.length === 0) {
        setStatus({ kind: 'error', text: '서버에 지도가 없습니다.' });
        return;
      }
      const entries = Object.fromEntries(Object.entries(zipEntries(rows)).map(([name, text]) => [name, strToU8(text)]));
      const blob = new Blob([zipSync(entries, { level: 6 })], { type: 'application/zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = zipName(new Date());
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setStatus({ kind: 'ok', text: `내려받았습니다(파일 ${rows.length}개). 압축을 풀면 ${CAMPUS_ID} 폴더가 나옵니다.` });
    } catch (e) {
      setStatus({ kind: 'error', text: koreanError(e as { message?: string; code?: string }) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>서버 지도</h2>
          <div className="head-actions">
            <button onClick={() => void refresh()} disabled={busy !== null}>새로고침</button>
            <button onClick={() => void download()} disabled={busy !== null || !server || server.length === 0}>
              {busy === 'zip' ? '만드는 중…' : '서버 지도 내려받기(zip)'}
            </button>
          </div>
        </div>
        {serverError && <p className="status error">{serverError}</p>}
        {!serverError && server === null && <p className="muted">불러오는 중…</p>}
        {server && server.length === 0 && <p className="muted">서버에 아직 지도가 없습니다. 아래에서 캠퍼스 폴더를 올려 주세요.</p>}
        {server && server.length > 0 && (
          <p className="muted">
            파일 {server.length}개 · {formatBytes(byteSize(server))} · 마지막 저장 {lastSaved ? kstLabel(lastSaved) : '-'}
          </p>
        )}
        <p className="hint">큰 작업 전과 PC 편집기로 작업하기 전에 내려받아 두세요. 서버(Supabase 무료 플랜)는 따로 백업이 없습니다.</p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>폴더 올리기</h2>
          <label className={`file-pick${busy !== null ? ' disabled' : ''}`}>
            <input ref={input} type="file" multiple disabled={busy !== null} onChange={(e) => void onPick(e.target.files)} />
            {busy === 'read' ? '읽는 중…' : '폴더 선택'}
          </label>
        </div>
        <p className="hint">
          PC의 <code>data/campuses/{CAMPUS_ID}</code> 폴더를 고르세요. 브라우저가 "파일을 업로드할까요?"라고 물으면 업로드를 누르면 됩니다.
          그 단계에서는 아직 서버로 보내지 않고, 아래 비교 목록을 보고 "서버에 올리기"를 눌러야 올라갑니다.
        </p>
        {status && <p className={`status ${status.kind}`}>{status.text}</p>}
        {scan && comparison && (
          <div className="compare">
            <p className="muted">
              고른 폴더: <code>{scan.root || '(최상위)'}</code> · 지도 파일 {scan.files.length}개 · {formatBytes(byteSize(scan.files))}
            </p>
            <FileGroup title="새 파일" paths={comparison.added} tone="add" open />
            <FileGroup title="바뀐 파일" paths={comparison.changed} tone="change" open />
            <FileGroup title="같은 파일(그대로 둠)" paths={comparison.same} />
            <FileGroup title="서버에만 있는 파일" paths={comparison.serverOnly} tone="remove" open={comparison.serverOnly.length > 0} />
            {comparison.serverOnly.length > 0 && (
              <label className="check-line">
                <input type="checkbox" checked={prune} onChange={(e) => setPrune(e.target.checked)} />
                서버에만 있는 파일 {comparison.serverOnly.length}개를 지웁니다(체크하지 않으면 그대로 둡니다)
              </label>
            )}
            <FileGroup title="건너뛴 파일(올리지 않음)" paths={scan.skipped.map((s) => `${s.path} — ${s.reason}`)} />
            {scan.outside > 0 && <p className="muted">캠퍼스 폴더 밖의 파일 {scan.outside}개는 보지 않았습니다.</p>}
            {comparison.changed.length > 0 && (
              <p className="hint">
                "바뀐 파일"이 예상보다 많으면 올리지 마세요. 내 폴더가 서버보다 오래됐을 수 있습니다(웹에서 고친 내용이 덮입니다).
                먼저 서버 지도를 내려받아 비교해 보세요.
              </p>
            )}
            <div className="actions">
              <button className="primary" onClick={() => void upload()} disabled={busy !== null || (toWrite === 0 && toRemove === 0)}>
                {busy === 'upload' ? '올리는 중…' : toWrite + toRemove === 0 ? '바뀐 것이 없습니다' : `서버에 올리기(${toWrite + toRemove}개)`}
              </button>
              <button onClick={() => { setScan(null); setStatus(null); setPrune(false); }} disabled={busy !== null}>취소</button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function FileGroup({ title, paths, tone, open = false }: { title: string; paths: string[]; tone?: 'add' | 'change' | 'remove'; open?: boolean }) {
  if (paths.length === 0) return <p className="group-empty">{title} 0개</p>;
  return (
    <details className={`file-group${tone ? ` ${tone}` : ''}`} open={open}>
      <summary>{title} {paths.length}개</summary>
      <ul>
        {paths.map((p) => <li key={p}><code>{p}</code></li>)}
      </ul>
    </details>
  );
}
