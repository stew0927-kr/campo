// Id helpers (SPEC §4.4).
import type { BuildingFeature, CampoFeature, NodeFeature } from '@campo/core';
import type { CampusDoc } from './document.ts';

/** "n_A_3_hall" → "A_3_hall"; edge ids are e_{from tail}__{to tail}. */
export function tail(nodeId: string): string {
  return nodeId.replace(/^n_/, '');
}

/** `base`, or `base2`, `base3`… whichever is free. */
export function freeId(taken: { has(id: string): boolean }, base: string, separator = ''): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}${separator}${n}`)) return `${base}${separator}${n}`;
}

export function edgeIdFor(taken: { has(id: string): boolean }, from: string, to: string): string {
  return freeId(taken, `e_${tail(from)}__${tail(to)}`, '_');
}

export function getBuilding(doc: Pick<CampusDoc, 'features'>, id: string): BuildingFeature | undefined {
  const f = doc.features.get(id);
  return f?.properties.kind === 'building' ? (f as BuildingFeature) : undefined;
}

export function getNode(doc: Pick<CampusDoc, 'features'>, id: string): NodeFeature | undefined {
  const f = doc.features.get(id);
  return f?.properties.kind === 'node' ? (f as NodeFeature) : undefined;
}

export function isNode(f: CampoFeature): f is NodeFeature {
  return f.properties.kind === 'node';
}
