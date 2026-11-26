import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// maplibre-react-native is native and cannot render in Node. Its Marker throws "'id' cannot be changed" when the same
// instance receives a new id, so the preview bubble must be re-mounted (keyed) whenever the preview changes.
const source = readFileSync(new URL('../src/features/map/CampusMap.tsx', import.meta.url), 'utf8');

describe('CampusMap preview bubble', () => {
  it('is keyed by preview.key so a new preview mounts a fresh Marker', () => {
    expect(source).toMatch(/<PreviewBubble\b[^>]*\bkey=\{preview\.key\}/);
  });
  it('still derives the Marker id from preview.key', () => {
    expect(source).toContain('id={`roadview-preview-${preview.key}`}');
  });
  it('keeps every other Marker id constant or keyed by the same value', () => {
    expect(source).toMatch(/<FacilityMarker key=\{`icon:\$\{marker\.id\}`\}/);
    expect(source).toMatch(/<LabelMarker key=\{`label:\$\{marker\.id\}`\}/);
    expect(source).toContain('<SafeMarker id="selected-place"');
    expect(source).toContain('<SafeMarker id="current-position"');
  });
});
