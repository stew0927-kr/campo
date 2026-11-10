import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseCampus, validateCampus } from '@campo/core';
import { fetchCampus, saveCampus } from './api.ts';
import { MapView } from './map/MapView.tsx';
import type { CampusDoc } from './model/document.ts';
import { docToFiles } from './model/files.ts';
import { addOutdoorPath, type PathVertex } from './model/outdoor-path.ts';
import { SidePanel } from './ui/SidePanel.tsx';
import { StatusBar } from './ui/StatusBar.tsx';
import { Toolbar } from './ui/Toolbar.tsx';
import { initialUi, type UiState } from './ui/ui-state.ts';

const CAMPUS_ID = import.meta.env.VITE_CAMPUS_ID?.trim() || 'hanyang-seoul';
const DRAW_HINT = '클릭하며 이어 그리고, 마지막 점을 한 번 더 누르거나 Enter를 누르면 끝납니다. Esc는 취소입니다.';

type Notice = { text: string; tone: 'info' | 'error' } | null;

export function App() {
  /** Saved data (what goes to disk). */
  const [doc, setDoc] = useState<CampusDoc | null>(null);
  /** The doc as last loaded or saved, to tell whether there are unsaved changes. */
  const [savedDoc, setSavedDoc] = useState<CampusDoc | null>(null);
  /** Screen state. */
  const [ui, setUi] = useState<UiState>(initialUi);
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchCampus(CAMPUS_ID).then(
      (loaded) => {
        setDoc(loaded);
        setSavedDoc(loaded);
        if (loaded.passthrough.length > 0) {
          setNotice({ text: `스키마에 맞지 않는 Feature ${loaded.passthrough.length}개는 고치지 않고 그대로 저장합니다.`, tone: 'error' });
        }
      },
      (err: Error) => setLoadError(err.message),
    );
  }, []);

  const dirty = doc !== null && doc !== savedDoc;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const onPathDrawn = useCallback((vertices: PathVertex[]) => {
    if (!doc) return;
    const result = addOutdoorPath(doc, vertices, ui.outdoorKind);
    setDoc(result.doc);
    setNotice(result.edgeIds.length > 0 ? { text: `구간 ${result.edgeIds.length}개를 그렸습니다.`, tone: 'info' } : null);
  }, [doc, ui.outdoorKind]);

  const onSave = useCallback(async () => {
    if (!doc || saving) return;
    const files = docToFiles(doc);
    // SPEC §8: check before saving, on exactly the files that will be written.
    const { errors } = validateCampus(parseCampus(Object.entries(files).map(([path, text]) => ({ path, text }))));
    if (errors.length > 0 && !window.confirm(`검사 오류가 ${errors.length}개 있습니다. 그래도 저장하시겠습니까?`)) return;

    setSaving(true);
    try {
      const { written, removed } = await saveCampus(doc, files);
      setSavedDoc(doc);
      const removedText = removed.length > 0 ? `, 지운 파일 ${removed.length}개` : '';
      setNotice({ text: `저장했습니다. 쓴 파일 ${written.length}개${removedText}. 커밋은 Git에서 해 주세요.`, tone: 'info' });
    } catch (err) {
      setNotice({ text: (err as Error).message, tone: 'error' });
    } finally {
      setSaving(false);
    }
  }, [doc, saving]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave]);

  const counts = useMemo(() => {
    let nodes = 0;
    let edges = 0;
    for (const f of doc?.features.values() ?? []) {
      if (f.properties.kind === 'node' && f.properties.building_id === null) nodes++;
      if (f.properties.kind === 'edge' && (f.properties.edge_type ?? 'outdoor') === 'outdoor') edges++;
    }
    return { nodes, edges };
  }, [doc]);

  if (loadError) {
    return <p className="load-message notice-error">캠퍼스 데이터를 불러오지 못했습니다. {loadError}</p>;
  }
  if (!doc) return <p className="load-message">캠퍼스 데이터를 불러오는 중입니다…</p>;

  return (
    <div className="app">
      <Toolbar
        ui={ui}
        campusName={doc.meta.name}
        canSave={dirty}
        saving={saving}
        onChange={(patch) => setUi((u) => ({ ...u, ...patch }))}
        onSave={() => void onSave()}
      />
      <MapView doc={doc} tool={ui.tool} outdoorKind={ui.outdoorKind} basemap={ui.basemap} onPathDrawn={onPathDrawn} />
      <SidePanel tab={ui.panelTab} onTab={(panelTab) => setUi((u) => ({ ...u, panelTab }))} />
      <StatusBar
        nodes={counts.nodes}
        edges={counts.edges}
        dirty={dirty}
        notice={notice}
        hint={ui.tool === 'outdoor-path' ? DRAW_HINT : null}
      />
    </div>
  );
}
