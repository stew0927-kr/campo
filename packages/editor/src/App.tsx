import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { PROFILES, buildGraph, findRoute, validateCampus, type NodeFeature, type Position, type RouteResult } from '@campo/core';
import { fetchCampus, saveCampus } from './api.ts';
import type { RouteLine } from './map/layers.ts';
import { MapView, type FocusRequest, type MapClick } from './map/MapView.tsx';
import { addBuilding, buildingAt } from './model/building.ts';
import type { CampusDoc } from './model/document.ts';
import { docToCampus, docToFiles } from './model/files.ts';
import { getBuilding } from './model/ids.ts';
import { addElevator, addIndoorNode, addStairs, connectNodes } from './model/indoor.ts';
import { addBridge, addOutdoorNode, addPortal, updateProperties } from './model/links.ts';
import { featureCenter, featureScope } from './model/locate.ts';
import { addOutdoorPath, type PathVertex } from './model/outdoor-path.ts';
import { routeLine, routePlaces } from './model/places.ts';
import { OUTDOOR, floorLabel, inScope, nodeInScope, scopeLabel, type Scope } from './model/scope.ts';
import { ChecksPanel } from './ui/ChecksPanel.tsx';
import { BuildingDialog, ClassroomDialog, ElevatorDialog, PoiDialog, StairsDialog } from './ui/Dialogs.tsx';
import { FloorPicker } from './ui/FloorPicker.tsx';
import { PropertiesPanel } from './ui/PropertiesPanel.tsx';
import { RoutePanel } from './ui/RoutePanel.tsx';
import { SidePanel } from './ui/SidePanel.tsx';
import { StatusBar } from './ui/StatusBar.tsx';
import { Toolbar } from './ui/Toolbar.tsx';
import { TOOL_HINTS, effectiveAddKind, initialUi, toolAvailable, type Tool, type UiState } from './ui/ui-state.ts';

const CAMPUS_ID = import.meta.env.VITE_CAMPUS_ID?.trim() || 'hanyang-seoul';

type Notice = { text: string; tone: 'info' | 'error' } | null;
/** Open form, with where it was asked for. Screen state. */
type Dialog =
  | { kind: 'building'; ring: Position[] }
  | { kind: 'classroom' | 'elevator' | 'stairs' | 'poi'; position: Position }
  | null;
type Result = { doc: CampusDoc } | { error: string };

export function App() {
  /** Saved data (what goes to disk). */
  const [doc, setDoc] = useState<CampusDoc | null>(null);
  /** The doc as last loaded or saved, to tell whether there are unsaved changes. */
  const [savedDoc, setSavedDoc] = useState<CampusDoc | null>(null);
  /** Screen state. */
  const [ui, setUi] = useState<UiState>(initialUi);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
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
  const patchUi = (patch: Partial<UiState>) => setUi((u) => ({ ...u, ...patch }));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ---- Checks and routes: core's own functions, on exactly what would be saved ----
  const checkedDoc = useDeferredValue(doc);
  const campus = useMemo(() => (checkedDoc ? docToCampus(checkedDoc) : null), [checkedDoc]);
  const checks = useMemo(() => (campus ? validateCampus(campus) : { errors: [], warnings: [] }), [campus]);
  const graph = useMemo(() => (campus && ui.panelTab === 'routes' ? buildGraph(campus) : null), [campus, ui.panelTab]);
  const places = useMemo(() => (doc ? routePlaces(doc) : []), [doc]);
  const routeResults = useMemo<RouteResult[]>(() => {
    if (!graph || !ui.routeFrom || !ui.routeTo) return [];
    return PROFILES.map((p) => findRoute(graph, ui.routeFrom!, ui.routeTo!, p));
  }, [graph, ui.routeFrom, ui.routeTo]);
  const routeLines = useMemo<RouteLine[]>(() => {
    if (!checkedDoc || ui.panelTab !== 'routes') return [];
    return routeResults.flatMap((r) => (r.found ? [{ profile: r.profile, coordinates: routeLine(r, checkedDoc) }] : []));
  }, [routeResults, checkedDoc, ui.panelTab]);

  // ---- Edits ----
  /** Apply a model result. Returns the error (for a dialog to show) or undefined. */
  const apply = (r: Result, done: string): string | undefined => {
    if ('error' in r) {
      fail(r.error);
      return r.error;
    }
    setDoc(r.doc);
    setDialog(null);
    info(done);
    return undefined;
  };

  const setTool = (tool: Tool) => {
    patchUi({ tool, pickFrom: null });
    setNotice(null);
  };

  const showFloor = (scope: Scope, keepPick = false) => setUi((u) => ({
    ...u,
    scope,
    selectedBuildingId: scope.kind === 'building' ? scope.buildingId : null,
    // Picking a floor is usually followed by adding points; tools that span floors keep their first pick.
    tool: u.tool === 'select-building' || !toolAvailable(u.tool, scope) ? (scope.kind === 'building' ? 'add-node' : 'pan') : u.tool,
    pickFrom: keepPick ? u.pickFrom : null,
  }));

  const onPathDrawn = useCallback((vertices: PathVertex[]) => {
    if (!doc) return;
    const result = addOutdoorPath(doc, vertices, ui.outdoorKind);
    setDoc(result.doc);
    setNotice(result.edgeIds.length > 0 ? { text: `구간 ${result.edgeIds.length}개를 그렸습니다.`, tone: 'info' } : null);
  }, [doc, ui.outdoorKind]);

  const onPolygonDrawn = useCallback((ring: Position[]) => setDialog({ kind: 'building', ring }), []);

  /** Two-click tools: remember the first node, then build the edge on the second. */
  const pickPair = (node: NodeFeature | undefined, make: (a: string, b: string) => { doc: CampusDoc; id: string } | { error: string }, next: string) => {
    if (!doc) return;
    if (!node) return info(ui.pickFrom ? next : '지점 가까이를 눌러 주세요.');
    if (!ui.pickFrom) {
      patchUi({ pickFrom: node.id });
      return info(`${node.id}을(를) 골랐습니다. ${next}`);
    }
    const r = make(ui.pickFrom, node.id);
    patchUi({ pickFrom: null });
    apply(r, 'id' in r ? `${r.id} 구간을 만들었습니다.` : '');
  };

  const onMapClick = ({ position, node, edge }: MapClick) => {
    if (!doc) return;
    const scope = ui.scope;
    switch (ui.tool) {
      case 'pan':
        patchUi({ selectedId: node?.id ?? edge?.id ?? null, ...(node || edge ? { panelTab: 'properties' as const } : {}) });
        return;
      case 'select-building': {
        const b = buildingAt(doc, position);
        patchUi({ selectedBuildingId: b?.id ?? null });
        return b ? setNotice(null) : info('여기에는 건물이 없습니다. 건물 외곽선 안쪽을 눌러 주세요.');
      }
      case 'add-node': {
        const kind = effectiveAddKind(ui);
        if (kind === 'classroom' || kind === 'elevator' || kind === 'stairs' || kind === 'poi') return setDialog({ kind, position });
        if (kind === 'outdoor') {
          const r = addOutdoorNode(doc, position);
          return apply(r, 'id' in r ? `${r.id} 지점을 만들었습니다.` : '');
        }
        if (scope.kind !== 'building') return;
        const r = addIndoorNode(doc, { buildingId: scope.buildingId, level: scope.level, kind, position });
        return apply(r, 'id' in r ? `${r.id} 지점을 만들었습니다.` : '');
      }
      case 'connect':
        return pickPair(node, (a, b) => connectNodes(doc, a, b), '이을 다른 지점을 눌러 주세요.');
      case 'portal':
        return pickPair(node, (a, b) => addPortal(doc, a, b), '이어질 바깥 지점을 눌러 주세요(흐리게 보이는 바깥 지점).');
      case 'bridge':
        if (!node && ui.pickFrom) {
          // Clicking another building opens its floor picker without losing the first pick.
          const b = buildingAt(doc, position);
          if (b) {
            patchUi({ selectedBuildingId: b.id });
            return info(`${b.properties.name}의 층을 고른 다음 이어질 지점을 눌러 주세요.`);
          }
        }
        return pickPair(node, (a, b) => addBridge(doc, a, b), '다른 건물을 눌러 층을 고른 다음, 이어질 지점을 눌러 주세요.');
      default:
    }
  };

  const onLocate = (featureId: string) => {
    const f = doc?.features.get(featureId);
    if (!doc || !f) return;
    const scope = featureScope(f, doc);
    setUi((u) => ({
      ...u,
      scope,
      selectedBuildingId: scope.kind === 'building' ? scope.buildingId : f.properties.kind === 'building' ? f.id : null,
      selectedId: featureId,
      tool: toolAvailable(u.tool, scope) ? u.tool : 'pan',
      pickFrom: null,
    }));
    setFocus((prev) => ({ position: featureCenter(f), seq: (prev?.seq ?? 0) + 1 }));
  };

  const onSave = useCallback(async () => {
    if (!doc || saving) return;
    const files = docToFiles(doc);
    // SPEC §8: check before saving, on exactly the files that will be written.
    const { errors } = validateCampus(docToCampus(doc));
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
      } else if (e.key === 'Escape' && ui.pickFrom) {
        patchUi({ pickFrom: null });
        setNotice(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSave, ui.pickFrom]);

  const highlight = useMemo(() => new Set([ui.pickFrom, ui.selectedId].filter((id): id is string => !!id)), [ui.pickFrom, ui.selectedId]);

  /** Second click of 포탈 picks an outdoor point; everything else picks on the floor being shown. */
  const canPick = useCallback((n: NodeFeature) => (
    ui.tool === 'portal' && ui.pickFrom ? n.properties.building_id === null : nodeInScope(n, ui.scope)
  ), [ui.tool, ui.pickFrom, ui.scope]);

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

  return (
    <div className="app">
      <Toolbar
        ui={ui}
        campusName={doc.meta.name}
        canSave={dirty}
        saving={saving}
        onTool={setTool}
        onChange={patchUi}
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
          canPick={canPick}
          routes={routeLines}
          focus={focus}
          onPathDrawn={onPathDrawn}
          onPolygonDrawn={onPolygonDrawn}
          onMapClick={onMapClick}
        />
        {selected && (
          <FloorPicker
            building={selected}
            scope={ui.scope}
            onPick={(level) => showFloor({ kind: 'building', buildingId: selected.id, level }, ui.tool === 'bridge')}
            onOutdoor={() => showFloor(OUTDOOR)}
          />
        )}
      </div>
      <SidePanel tab={ui.panelTab} onTab={(panelTab) => patchUi({ panelTab })} badges={{ checks: checks.errors.length }}>
        {ui.panelTab === 'properties' && (
          <PropertiesPanel
            feature={ui.selectedId ? doc.features.get(ui.selectedId) : undefined}
            onEdit={(edits) => ui.selectedId && setDoc(updateProperties(doc, ui.selectedId, edits))}
          />
        )}
        {ui.panelTab === 'checks' && <ChecksPanel result={checks} onLocate={onLocate} />}
        {ui.panelTab === 'routes' && (
          <RoutePanel
            places={places}
            fromId={ui.routeFrom}
            toId={ui.routeTo}
            results={routeResults}
            onPick={(end, id) => patchUi(end === 'from' ? { routeFrom: id } : { routeTo: id })}
          />
        )}
      </SidePanel>
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
      {dialog?.kind === 'poi' && (
        <PoiDialog
          onCancel={closeDialog}
          onSubmit={(name) => apply(addOutdoorNode(doc, dialog.position, name), `${name} 후보를 만들었습니다.`)}
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
