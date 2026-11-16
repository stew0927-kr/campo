// 훅이 useMemo 의존성으로 쓰는 "내용 키". React를 import하지 않는 순수 함수라 Node에서 테스트한다
// (test/memoKeys.test.ts). 화면이 매 렌더 새 객체(인라인 요청·인라인 번들)를 넘겨도 내용이 같으면 키가 같아서
// 경로를 다시 찾거나 캠퍼스를 다시 읽지 않는다.
import type { BundledCampus } from '../campus/types.ts';
import type { CampusRouteRequest, RouteEndpoint } from '../contracts.ts';

function endpointKey(endpoint: RouteEndpoint | null): string {
  if (endpoint === null) return '-';
  if (endpoint.kind === 'node') return `n${JSON.stringify(endpoint.nodeId)}`;
  // String(): NaN·Infinity도 서로 다른 키가 된다(JSON.stringify는 둘 다 null로 만든다).
  return `p${String(endpoint.lat)},${String(endpoint.lng)}`;
}

/** 경로 요청의 내용 키: 출발·도착(지점 id 또는 위경도)과 모드. 내용이 같으면 새 객체여도 같은 키다. */
export function routeRequestKey(request: CampusRouteRequest | null): string {
  if (request === null) return 'null';
  const mode = request.mode ?? 'shortest';
  const alternatives = request.alternatives === true ? '1' : '0';
  return `${endpointKey(request.from)}|${endpointKey(request.to)}|${mode}|${alternatives}`;
}

const bundleKeys = new WeakMap<object, string>();

/**
 * 번들의 내용 키: 캠퍼스 id와 파일마다 경로·본문. 길이를 앞에 붙여 이어 붙이므로 내용이 다르면 키도 다르다.
 * 같은 번들 객체(기본값인 앱 번들)는 한 번만 계산한다.
 */
export function bundleKeyOf(bundle: BundledCampus): string {
  const cached = bundleKeys.get(bundle);
  if (cached !== undefined) return cached;
  const files = Array.isArray(bundle.files) ? bundle.files : [];
  let key = `${String(bundle.campus).length}:${String(bundle.campus)}`;
  for (const file of files) {
    const path = String(file.path);
    const text = String(file.text);
    key += `|${path.length}:${path}|${text.length}:${text}`;
  }
  bundleKeys.set(bundle, key);
  return key;
}
