// The campus files built by scripts/build-osm-campus.ts, loaded on the first click of 건물 가져오기 (not at start-up).
import type { Position } from '@campo/core';
import { lookupCampusBuilding, type CampusLookup, type OsmCampusData } from './osmCampus.ts';

const loaders: (() => Promise<{ default: unknown }>)[] = [
  () => import('../data/osm-campus/hanyang-seoul.json'),
];

let loaded: Promise<OsmCampusData[]> | null = null;
const campuses = () => (loaded ??= Promise.all(loaders.map(async (load) => (await load()).default as OsmCampusData)));

/** The embedded campus file that covers `position` decides: a building, no building there, or `outside` every file. */
export async function embeddedOsmBuilding(position: Position): Promise<CampusLookup> {
  for (const data of await campuses()) {
    const found = lookupCampusBuilding(data, position);
    if (!('outside' in found)) return found;
  }
  return { outside: true };
}
