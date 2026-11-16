import { describe, expect, it } from 'vitest';
import { bundleKeyOf, routeRequestKey } from '../src/hooks/memoKeys.ts';
import { computeRoute } from '../src/route/routeEngine.ts';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { META, bundleFrom, nodeFeature } from './helpers.ts';

describe('routeRequestKey', () => {
  it('내용이 같으면 새 객체여도 같은 키, mode를 생략하면 shortest와 같다', () => {
    const a = { from: { kind: 'node' as const, nodeId: 'n1' }, to: { kind: 'point' as const, lat: 37.1, lng: 127.2 } };
    const b = { from: { kind: 'node' as const, nodeId: 'n1' }, to: { kind: 'point' as const, lat: 37.1, lng: 127.2 }, mode: 'shortest' as const };
    expect(routeRequestKey(a)).toBe(routeRequestKey({ ...a }));
    expect(routeRequestKey(a)).toBe(routeRequestKey(b));
    expect(routeRequestKey(null)).toBe(routeRequestKey(null));
  });

  it('출발·도착·모드 중 하나라도 다르면 다른 키', () => {
    const base = { from: { kind: 'node' as const, nodeId: 'n1' }, to: { kind: 'node' as const, nodeId: 'n2' } };
    const keys = [
      routeRequestKey(null),
      routeRequestKey({ from: null, to: null }),
      routeRequestKey(base),
      routeRequestKey({ ...base, from: base.to, to: base.from }),
      routeRequestKey({ ...base, mode: 'wheelchair' }),
      routeRequestKey({ ...base, to: null }),
      routeRequestKey({ ...base, to: { kind: 'point', lat: 37, lng: 127 } }),
      routeRequestKey({ ...base, to: { kind: 'point', lat: 37, lng: 127.000001 } }),
      routeRequestKey({ ...base, to: { kind: 'point', lat: Number.NaN, lng: 127 } }),
      routeRequestKey({ ...base, to: { kind: 'point', lat: Number.POSITIVE_INFINITY, lng: 127 } }),
      // 지점 id에 구분 문자가 들어가도 다른 요청과 섞이지 않는다.
      routeRequestKey({ from: { kind: 'node', nodeId: 'n1|n2' }, to: { kind: 'node', nodeId: 'n2' } }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('같은 키의 요청은 같은 경로 결과를 낸다(키가 계산에 쓰는 내용을 빠짐없이 담는다)', () => {
    const runtime = loadBundledCampus(bundleFrom(META, [nodeFeature('n1', 127.0, 37.0, { name: '정문' })]));
    const one = { from: { kind: 'node' as const, nodeId: 'n1' }, to: { kind: 'node' as const, nodeId: 'n1' } };
    const two = { ...one, mode: 'shortest' as const };
    expect(routeRequestKey(one)).toBe(routeRequestKey(two));
    expect(computeRoute(runtime, one)).toEqual(computeRoute(runtime, two));
  });
});

describe('bundleKeyOf', () => {
  it('내용이 같으면 새로 만든 번들 객체여도 같은 키', () => {
    const features = [nodeFeature('n1', 127.0, 37.0, { name: '정문' })];
    expect(bundleKeyOf(bundleFrom(META, features))).toBe(bundleKeyOf(bundleFrom(META, features)));
  });

  it('캠퍼스 id, 파일 경로, 파일 본문 중 하나라도 다르면 다른 키', () => {
    const base = bundleFrom(META, [nodeFeature('n1', 127.0, 37.0)]);
    const keys = [
      bundleKeyOf(base),
      bundleKeyOf({ ...base, campus: 'other' }),
      bundleKeyOf(bundleFrom(META, [nodeFeature('n1', 127.0001, 37.0)])),
      bundleKeyOf({ campus: base.campus, files: base.files.map((file) => ({ ...file, path: `x/${file.path}` })) }),
      bundleKeyOf({ campus: base.campus, files: base.files.slice(0, 1) }),
      // 경계가 옮겨진 두 파일(경로+본문을 이어 붙이면 같은 글자)이 섞이지 않는다.
      bundleKeyOf({ campus: 'c', files: [{ path: 'a', text: 'bc' }] }),
      bundleKeyOf({ campus: 'c', files: [{ path: 'ab', text: 'c' }] }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
