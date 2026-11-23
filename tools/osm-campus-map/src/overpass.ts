import type { Bbox, OverpassJson } from './types.ts';

export const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';

/** Only the tag families the sketch keeps; POIs are never requested in the first place. */
export function buildOverpassQuery(bbox: Bbox): string {
  const [w, s, e, n] = bbox;
  const b = `${s},${w},${n},${e}`; // Overpass wants south,west,north,east
  return `[out:json][timeout:90];
(
  way["building"]["building"!="no"](${b});
  relation["building"]["type"="multipolygon"](${b});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|road|footway|pedestrian|path|track|cycleway|bridleway|steps|(motorway|trunk|primary|secondary|tertiary)_link)$"](${b});
  way["landuse"~"^(grass|forest)$"](${b});
  way["leisure"~"^(park|garden)$"](${b});
  way["natural"~"^(wood|water)$"](${b});
  relation["natural"="water"]["type"="multipolygon"](${b});
);
out geom;`;
}

export async function fetchOverpass(bbox: Bbox, endpoint = DEFAULT_ENDPOINT): Promise<OverpassJson> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: buildOverpassQuery(bbox) }),
  });
  if (!res.ok) throw new Error(`Overpass request failed: HTTP ${res.status}`);
  return (await res.json()) as OverpassJson;
}
