import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseCampus, validateCampus, type Position } from '@campo/core';
import { fetchCampus, saveCampus } from './api.ts';
import { MapView, type MapClick } from './map/MapView.tsx';
import { addBuilding, buildingAt } from './model/building.ts';
import type { CampusDoc } from './model/document.ts';
import { docToFiles } from './model/files.ts';
import { getBuilding } from './model/ids.ts';
import { addElevator, addIndoorNode, addStairs, connectNodes } from './model/indoor.ts';
import { addOutdoorPath, type PathVertex } from './model/outdoor-path.ts';
import { OUTDOOR, floorLabel, inScope, scopeLabel } from './model/scope.ts';
import { BuildingDialog, ClassroomDialog, ElevatorDialog, StairsDialog } from './ui/Dialogs.tsx';
import { FloorPicker } from './ui/FloorPicker.tsx';
import { SidePanel } from './ui/SidePanel.tsx';
import { StatusBar } from './ui/StatusBar.tsx';
import { Toolbar } from './ui/Toolbar.tsx';
import { TOOL_HINTS, initialUi, toolAvailable, type Tool, type UiState } from './ui/ui-state.ts';

const CAMPUS_ID = import.meta.env.VITE_CAMPUS_ID?.trim() || 'hanyang-seoul';

type Notice = { text: string; tone: 'info' | 'error' } | null;
/** Open form, with where it was asked for. Screen state. */
type Dialog =
  | { kind: 'building'; ring: Position[] }
  | { kind: 'classroom' | 'elevator' | 'stairs'; position: Position }
  | null;

export function App() {
  /** Saved data (what goes to disk). */
  const [doc, setDoc] = useState<CampusDoc | null>(null);
  /** The doc as last loaded or saved, to tell whether there are unsaved changes. */
  const [savedDoc, setSavedDoc] = useState<CampusDoc | null>(null);
  /** Screen state. */
  const [ui, setUi] = useState<UiState>(initialUi);
  const [dialog, setDialog] = useState<Dialog>(null);
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
  const info = (text: string) => setNotice({ text, tone: 'info' });
  const fail = (text: string) => setNotice({ text, tone: 'error' });

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setTool = (tool: Tool) => {
    setUi((u) => ({ ...u, tool, connectFrom: null }));
    setNotice(null);
  };

  const onPathDrawn = useCallback((vertices: PathVertex[]) => {
    if (!doc) return;
    const result = addOutdoorPath(doc, vertices, ui.outdoorKind);
    setDoc(result.doc);
    setNotice(result.edgeIds.length > 0 ? { text: `구간 ${result.edgeIds.length}개를 그렸습니다.`, tone: 'info' } : null);
  }, [doc, ui.outdoorKind]);

  const onPolygonDrawn = useCallback((ring: Position[]) => setDialog({ kind: 'building', ring }), []);

  const onMapClick = useCallback(({ position, node }: MapClick) => {
    if (!doc) return;
    const scope = ui.scope;
    switch (ui.tool) {
      case 'select-building': {
        const b = buildingAt(doc, position);
        setUi((u) => ({ ...u, selectedBuildingId: b?.id ?? null }));
        if (!b) info('여기에는 건물이 없습니다. 건물 외곽선 안쪽을 눌러 주세요.');
        else setNotice(null);
        return;
      }
      case 'add-node': {
        if (scope.kind !== 'building') return;
        const kind = ui.addKind;
        if (kind === 'classroom' || kind === 'elevator' || kind === 'stairs') return setDialog({ kind, position });
        const r = addIndoorNode(doc, { buildingId: scope.buildingId, level: scope.level, kind, position });
        if ('error' in r) return fail(r.error);
        setDoc(r.doc);
        return info(`${r.id} 지점을 만들었습니다.`);
      }
      case 'connect': {
        if (!node) return info('지점 가까이를 눌러 주세요.');
        if (!ui.connectFrom) {
          setUi((u) => ({ ...u, connectFrom: node.id }));
          return info(`${node.id}에서 이을 지점을 눌러 주세요.`);
        }
        const r = connectNodes(doc, ui.connectFrom, node.id);
        setUi((u) => ({ ...u, connectFrom: null }));
        if ('error' in r) return fail(r.error);
        setDoc(r.doc);
        return info(`${r.id} 구간을 만들었습니다.`);
      }
      default:
    }
  }, [doc, ui.tool, ui.scope, ui.addKind, ui.connectFrom]);

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
      info(`저장했습니다. 쓴 파일 ${written.length}개${removedText}. 커밋은 Git에서 해 주세요.`);
    } catch (err) {
      fail((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [doc, saving]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void onSave();
      } else if (e.key === 'Escape' && ui.connectFrom) {
        setUi((u) => ({ ...u, connectFrom: null }));
        setNotice(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave, ui.connectFrom]);

  const highlight = useMemo(() => new Set(ui.connectFrom ? [ui.connectFrom] : []), [ui.connectFrom]);

  const counts = useMemo(() => {
    let nodes = 0;
    let edges = 0;
    if (doc) {
      for (const f of doc.features.values()) {
        if (!inScope(f, ui.scope, doc)) continue;
        if (f.properties.kind === 'node') nodes++;
        if (f.properties.kind === 'edge') edges++;
      }
    }
    return { nodes, edges };
  }, [doc, ui.scope]);

  if (loadError) {
    return <p className="load-message notice-error">캠퍼스 데이터를 불러오지 못했습니다. {loadError}</p>;
  }
  if (!doc) return <p className="load-message">캠퍼스 데이터를 불러오는 중입니다…</p>;

  const selected = ui.selectedBuildingId ? getBuilding(doc, ui.selectedBuildingId) : undefined;
  const scopeBuilding = ui.scope.kind === 'building' ? getBuilding(doc, ui.scope.buildingId) : undefined;
  const closeDialog = () => setDialog(null);
  /** Apply a model result from a dialog: returns the error for the dialog to show, or closes it. */
  const apply = (r: { doc: CampusDoc } | { error: string }, done: string): string | undefined => {
    if ('error' in r) return r.error;
    setDoc(r.doc);
    setDialog(null);
    info(done);
    return undefined;
  };

  return (
    <div className="app">
      <Toolbar
        ui={ui}
        campusName={doc.meta.name}
        canSave={dirty}
        saving={saving}
        onTool={setTool}
        onChange={(patch) => setUi((u) => ({ ...u, ...patch }))}
        onSave={() => void onSave()}
      />
      <div className="map-area">
        <MapView
          doc={doc}
          tool={ui.tool}
          outdoorKind={ui.outdoorKind}
          basemap={ui.basemap}
          scope={ui.scope}
          highlight={highlight}
          onPathDrawn={onPathDrawn}
          onPolygonDrawn={onPolygonDrawn}
          onMapClick={onMapClick}
        />
        {selected && (
          <FloorPicker
            building={selected}
            scope={ui.scope}
            onPick={(level) => setUi((u) => ({
              ...u,
              scope: { kind: 'building', buildingId: selected.id, level },
              // Picking a floor is almost always followed by adding points on it.
              tool: u.tool === 'select-building' || !toolAvailable(u.tool, { kind: 'building', buildingId: selected.id, level }) ? 'add-node' : u.tool,
              connectFrom: null,
            }))}
            onOutdoor={() => setUi((u) => ({
              ...u,
              scope: OUTDOOR,
              selectedBuildingId: null,
              tool: toolAvailable(u.tool, OUTDOOR) ? u.tool : 'pan',
              connectFrom: null,
            }))}
          />
        )}
      </div>
      <SidePanel tab={ui.panelTab} onTab={(panelTab) => setUi((u) => ({ ...u, panelTab }))} />
      <StatusBar
        scopeLabel={scopeLabel(ui.scope, doc)}
        nodes={counts.nodes}
        edges={counts.edges}
        dirty={dirty}
        notice={notice}
        hint={ui.tool === 'outdoor-path' || ui.tool === 'add-node' ? TOOL_HINTS[ui.tool] : null}
      />

      {dialog?.kind === 'building' && (
        <BuildingDialog
          onCancel={closeDialog}
          onSubmit={(f) => apply(addBuilding(doc, { ring: dialog.ring, ...f }), `${f.name} 건물을 만들었습니다. 건물 선택으로 층을 고를 수 있습니다.`)}
        />
      )}
      {dialog?.kind === 'classroom' && ui.scope.kind === 'building' && (() => {
        const scope = ui.scope;
        return (
          <ClassroomDialog
            onCancel={closeDialog}
            onSubmit={({ ref, spaceName }) => apply(
              addIndoorNode(doc, { buildingId: scope.buildingId, level: scope.level, kind: 'classroom', position: dialog.position, ref, spaceName }),
              `${ref}호 문을 만들었습니다.`,
            )}
          />
        );
      })()}
      {dialog?.kind === 'elevator' && scopeBuilding && (
        <ElevatorDialog
          building={scopeBuilding}
          onCancel={closeDialog}
          onSubmit={(levels) => apply(addElevator(doc, { buildingId: scopeBuilding.id, position: dialog.position, levels }), '엘리베이터를 만들었습니다.')}
        />
      )}
      {dialog?.kind === 'stairs' && scopeBuilding && ui.scope.kind === 'building' && (
        <StairsDialog
          building={scopeBuilding}
          startLevel={ui.scope.level}
          onCancel={closeDialog}
          onSubmit={({ from, to }) => apply(
            addStairs(doc, { buildingId: scopeBuilding.id, position: dialog.position, from, to }),
            `${floorLabel(from)}에서 ${floorLabel(to)}까지 계단을 만들었습니다.`,
          )}
        />
      )}
    </div>
  );
}
