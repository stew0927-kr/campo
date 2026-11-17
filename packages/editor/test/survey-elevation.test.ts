// QA: zip ↔ editor round trip. The survey app's zip also carries the barometer measurements (elevation_store.json,
// elevation_dirty.json) and, when photos could not be read on the phone, export_report.json. The editor used to unpack
// survey.json and photos/ only, so all of that was dropped without a word.
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { formatSurvey, type Survey } from '@campo/core';
import { emptyElevationStore, serializeElevationStore, type DhEdge, type ElevationStore, type HeightNode, type MeasurementSession } from '@campo/core/elevation';
import { mergeMeasurements, parseStore } from '../src/model/elevation.ts';
import { ARCHIVE_ELEVATION_DIRTY, ARCHIVE_ELEVATION_STORE, ARCHIVE_REPORT, readSurveyFile } from '../src/model/survey.ts';

const AT = '2026-11-14T10:00:00+09:00';
const survey: Survey = {
  format: 'campo-survey', version: 1, id: 'sv-20261114-elev-1', campus: 'fixture-basic', surveyed_at: AT,
  attachments: { n_a: { recorded_at: AT, photos: ['photos/n_a-1.jpg'] } }, vertical: [],
};
const node = (key: string, lat = 37): HeightNode => ({ kind: 'outdoor_point', key, position: { lat, lng: 127 }, influenceRadiusM: 5, createdAt: 1 } as HeightNode);
const edge = (edgeId: string, from: string, to: string, qc: DhEdge['qc'] = 'ok'): DhEdge => ({
  edgeId, from, to, dhM: 1.2, sigmaM: 0.1, dtS: 30, offsetFromM: 0, offsetToM: 0, sessionId: 's1', method: 'barometer_relative', qc,
  model: { tempC: 15, sigmaInstFloorHpa: 0.01, driftHpaPerHour: 0.1 }, createdAt: 2,
} as DhEdge);
const sess = (sessionId: string): MeasurementSession => ({ sessionId, mode: 'walk', platform: 'android', installId: 'i', startedAt: 1 } as MeasurementSession);
const store = (nodes: HeightNode[], edges: DhEdge[], sessions: MeasurementSession[] = [sess('s1')]): ElevationStore => ({ ...emptyElevationStore(), nodes, edges, sessions });

describe('readSurveyFile keeps what the survey app put next to survey.json', () => {
  it('reads the elevation store, the keys to recompute, the photos the phone could not read, and names what it skipped', () => {
    const phone = store([node('op:a'), node('op:b')], [edge('e1', 'op:a', 'op:b')]);
    const zip = zipSync({
      'survey.json': strToU8(formatSurvey(survey)),
      'photos/n_a-1.jpg': new Uint8Array([1, 2]),
      [ARCHIVE_ELEVATION_STORE]: strToU8(serializeElevationStore(phone)),
      [ARCHIVE_ELEVATION_DIRTY]: strToU8(JSON.stringify({ format: 'campo-elevation-dirty/1', heightNodes: ['op:a', 'op:b'] })),
      [ARCHIVE_REPORT]: strToU8(JSON.stringify({ format: 'campo-export-report/1', missingPhotos: ['photos/n_a-2.jpg'] })),
      'notes.txt': strToU8('x'),
    });
    const read = readSurveyFile(zip);
    if ('error' in read) throw new Error(read.error);
    expect(read.elevation?.dirtyKeys).toEqual(['op:a', 'op:b']);
    expect(parseStore(read.elevation!.storeText)).toEqual(parseStore(serializeElevationStore(phone)));
    expect(read.phoneMissingPhotos).toEqual(['photos/n_a-2.jpg']);
    expect(read.ignored).toEqual(['notes.txt']);
    expect(read.missingPhotos).toEqual([]);
  });

  it('a zip without them reads as before', () => {
    const read = readSurveyFile(zipSync({ 'survey.json': strToU8(formatSurvey(survey)), 'photos/n_a-1.jpg': new Uint8Array([1]) }));
    if ('error' in read) throw new Error(read.error);
    expect(read.elevation).toBeNull();
    expect(read.phoneMissingPhotos).toEqual([]);
    expect(read.ignored).toEqual([]);
  });
});

describe('mergeMeasurements', () => {
  it('adds the phone\'s points, edges and sessions without losing the editor\'s break lines, estimates or measurements', () => {
    const mine: ElevationStore = {
      ...store([node('op:a'), node('op:x')], [edge('e0', 'op:a', 'op:x')]),
      breaklines: [{ id: 'bl1', coordinates: [{ lat: 37, lng: 127 }, { lat: 37.001, lng: 127 }], source: 'editor', createdAt: 1 } as never],
      estimates: [{ key: 'op:a', hM: 30, sigmaM: 0.1 } as never],
    };
    const phone = store([node('op:a', 37.5), node('op:b')], [edge('e0', 'op:a', 'op:x', 'superseded'), edge('e1', 'op:a', 'op:b')], [sess('s1'), sess('s2')]);
    const m = mergeMeasurements(mine, phone);
    expect(m.store.nodes.map((n) => n.key)).toEqual(['op:a', 'op:x', 'op:b']);
    expect((m.store.nodes[0] as { position: { lat: number } }).position.lat).toBe(37.5); // re-measured on the phone
    expect(m.store.edges.map((e) => [e.edgeId, e.qc])).toEqual([['e0', 'superseded'], ['e1', 'ok']]);
    expect(m.store.sessions.map((s) => s.sessionId)).toEqual(['s1', 's2']);
    expect(m.store.breaklines).toEqual(mine.breaklines);
    expect(m.store.estimates).toEqual(mine.estimates);
    expect([m.nodes, m.edges, m.sessions]).toEqual([1, 1, 1]);
    // Importing the same zip again adds nothing.
    const again = mergeMeasurements(m.store, phone);
    expect([again.nodes, again.edges, again.sessions]).toEqual([0, 0, 0]);
    expect(again.store.edges).toEqual(m.store.edges);
  });
});
