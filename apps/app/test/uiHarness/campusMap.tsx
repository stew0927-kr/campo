// Test-only page: the real CampusMap (marker layout, scheduler, memoised markers) over a fake MapLibre (maplibre.tsx).
// `?n=1000` synthetic places on A동 4층 of the indoor fixture. Not a map rendering test: tiles, gestures and native
// marker views are not involved; it measures the React work the component does per region event.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BundledCampus } from '../../src/campus/types.ts';
import type { CampusPlace } from '../../src/contracts.ts';
import { loadBundledCampus } from '../../src/campus/loadBundledCampus.ts';
import { CampusMap } from '../../src/features/map/CampusMap.tsx';
import * as labels from '../../src/features/map/mapLabels.ts';
import fixture from '../../src/features/map/indoorFixture.json';
const w = window as any;
w.__campoLayoutEvents = true;
const n = Number(new URLSearchParams(location.search).get('n') ?? 1000);
const runtime = loadBundledCampus(fixture as BundledCampus);
let seed = 7;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const types = ['door', 'restroom', 'entrance', 'poi'] as const;
const places: CampusPlace[] = Array.from({ length: n }, (_, i) => ({
  id: `syn_${i}`, name: types[i % 4] === 'door' ? `${400 + (i % 99)}호` : `검사 장소 ${i}`, nodeType: types[i % 4]!, buildingId: 'bldg_A', level: 4,
  lng: 127.0004 + rnd() * 0.0005, lat: 37.0003 + rnd() * 0.0004, ...(types[i % 4] === 'door' ? { roomRef: `${400 + (i % 99)}` } : {}),
}));
w.__campoPlaces = places; w.__campoGraph = runtime.graph; w.__campoLabels = labels;
function Page() {
  const [tick, setTick] = useState(0);
  w.__campoRerenderParent = () => setTick((t) => t + 1);
  return <div style={{ width: 390, height: 700, display: 'flex' }} data-tick={tick}>
    <CampusMap center={{ lat: 37.0005, lng: 127.00065 }} label="검사 지도" route={null} from={null} to={null} places={places} graph={runtime.graph}
      buildingId="bldg_A" level={4} position={null} flow={null} onPoint={() => {}} onPlace={(place) => { w.__campoPicked = `${tick}:${place.id}`; }} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Page />);
