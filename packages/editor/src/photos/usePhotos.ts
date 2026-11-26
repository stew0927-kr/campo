// 사진 토글의 상태(편집기 Workspace에서 쓴다): 켜면 서버에서 campus_photos를 읽고 관리자인지 확인한다.
// 교체·삭제는 photoStore(순서는 photoModel), 변환은 webp.ts. 서버 빌드(SERVER_MODE)가 아니면 아무것도 읽지 않는다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EditNode } from '@campo/core';
import type { Scope } from '../model/scope.ts';
import { SERVER_MODE, sharedClient } from '../storage.ts';
import { ADMIN_ONLY, photoPins, sha256Hex, type PhotoRow } from './photoModel.ts';
import { deletePhoto, isAdmin, loadPhotos, replacePhoto } from './photoStore.ts';
import { toWebpVariants } from './webp.ts';

export interface PhotoManager {
  on: boolean;
  available: boolean;
  toggle: () => void;
  rows: PhotoRow[] | null;
  admin: boolean | null;
  open: string | null;
  setOpen: (nodeId: string | null) => void;
  busy: string | null;
  message: { text: string; tone: 'info' | 'error' } | null;
  pins: ReturnType<typeof photoPins>;
  replace: (row: PhotoRow, file: File) => Promise<void>;
  remove: (row: PhotoRow) => Promise<void>;
}

const NO_PINS = { pins: [], elsewhere: 0, missing: 0 };

export function usePhotos(campusId: string, nodes: Readonly<Record<string, EditNode>>, scope: Scope): PhotoManager {
  const [on, setOn] = useState(false);
  const [rows, setRows] = useState<PhotoRow[] | null>(null);
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<PhotoManager['message']>(null);
  useEffect(() => {
    if (!on || !SERVER_MODE) return;
    let alive = true;
    setMessage({ text: '서버에서 사진을 불러오고 있습니다…', tone: 'info' });
    (async () => {
      try {
        const c = sharedClient();
        const [loaded, isAdminNow] = await Promise.all([loadPhotos(c, campusId), isAdmin(c)]);
        if (!alive) return;
        setRows(loaded); setAdmin(isAdminNow);
        setMessage(isAdminNow ? null : { text: ADMIN_ONLY, tone: 'error' });
      } catch (e) {
        if (alive) setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
      }
    })();
    return () => { alive = false; };
  }, [on, campusId]);
  const pins = useMemo(() => (on && rows ? photoPins(rows, nodes, scope) : NO_PINS), [on, rows, nodes, scope]);
  const toggle = useCallback(() => { setOn((v) => !v); setOpen(null); }, []);
  const replace = useCallback(async (row: PhotoRow, file: File) => {
    if (admin === false) { setMessage({ text: ADMIN_ONLY, tone: 'error' }); return; }
    setBusy(row.id); setMessage({ text: '사진을 WebP로 바꿔 올리고 있습니다…', tone: 'info' });
    try {
      const [variants, sha] = await Promise.all([toWebpVariants(file), file.arrayBuffer().then(sha256Hex)]);
      const result = await replacePhoto(sharedClient(), row, variants, sha);
      setRows((old) => old?.map((r) => (r.id === row.id && result.row ? result.row : r)) ?? old);
      setMessage({ text: result.warning ?? '사진을 바꿨습니다. 앱은 다음에 사진을 읽을 때 새 사진을 보여 줍니다.', tone: result.warning ? 'error' : 'info' });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally { setBusy(null); }
  }, [admin]);
  const remove = useCallback(async (row: PhotoRow) => {
    if (admin === false) { setMessage({ text: ADMIN_ONLY, tone: 'error' }); return; }
    setBusy(row.id);
    try {
      const result = await deletePhoto(sharedClient(), row);
      setRows((old) => old?.filter((r) => r.id !== row.id) ?? old);
      setMessage({ text: result.warning ?? '사진을 지웠습니다.', tone: result.warning ? 'error' : 'info' });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally { setBusy(null); }
  }, [admin]);
  return { on, available: SERVER_MODE, toggle, rows, admin, open, setOpen, busy, message, pins, replace, remove };
}
