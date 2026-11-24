// 화장실 성별 판정: 남자 화장실 찾기에는 'female'만, 여자 화장실 찾기에는 'male'만 뺀다.
// 'unisex'·'family'·'all'·'unknown'·빈 값·기록 없음·알 수 없는 값은 성별 제한이 없다고 보고 양쪽에 모두 넣는다.
// 코어의 isRestroomFor는 'unisex'만 양쪽에 넣으므로 쓰지 않고, 이 판정을 코어의 findNearest·findRouteBetween과 조합한다.
// React를 import하지 않는 순수 모듈.
import type { NodeFeature } from '@campo/core';
import type { CampusPlace } from '../../contracts.ts';

/** 전체 / 남자 / 여자. */
export type RestroomWanted = 'any' | 'male' | 'female';

export const RESTROOM_WANTED: readonly { value: RestroomWanted; label: string }[] = [
  { value: 'any', label: '전체' },
  { value: 'male', label: '남자' },
  { value: 'female', label: '여자' },
];

/** 이 성별 값의 화장실이 `wanted` 목록에 들어가는가. 판정은 이 함수 하나로 통일한다. */
export function genderAllows(gender: unknown, wanted: RestroomWanted): boolean {
  if (wanted === 'male') return gender !== 'female';
  if (wanted === 'female') return gender !== 'male';
  return true;
}

/** 화장실(nodeType 'restroom')이고 `wanted`에 맞는가. 화장실이 아니면 언제나 false. */
export function restroomMatchesGender(place: Pick<CampusPlace, 'nodeType'> & { restroomGender?: unknown }, wanted: RestroomWanted): boolean {
  return place.nodeType === 'restroom' && genderAllows(place.restroomGender, wanted);
}

/** 화장실만 남기고 `wanted`로 거른다. */
export function filterRestrooms<T extends Pick<CampusPlace, 'nodeType'> & { restroomGender?: unknown }>(places: readonly T[], wanted: RestroomWanted): T[] {
  return places.filter((p) => restroomMatchesGender(p, wanted));
}

/**
 * 화장실 찾기 목록: 화장실이 아닌 장소(출발 후보)는 그대로 두고, 화장실만 `wanted`로 거른다.
 * 출발·도착 검색에는 쓰지 않는다(그 목록은 성별 때문에 줄면 안 된다).
 */
export function restroomCandidates<T extends Pick<CampusPlace, 'nodeType'> & { restroomGender?: unknown }>(places: readonly T[], wanted: RestroomWanted): T[] {
  return wanted === 'any' ? [...places] : places.filter((p) => p.nodeType !== 'restroom' || genderAllows(p.restroomGender, wanted));
}

/** 그래프 지점용: 화장실이고, 성별이 맞고, wheelchair면 휠체어 사용 가능('yes')인가. findNearest의 조건으로 쓴다. */
export function restroomNodeMatches(node: NodeFeature, wanted: RestroomWanted, wheelchair: boolean): boolean {
  const props = node.properties;
  if (props.node_type !== 'restroom') return false;
  if (wheelchair && props.wheelchair !== 'yes') return false;
  return genderAllows(props.restroom_gender, wanted);
}

const GENDER_LABEL: Readonly<Record<string, string>> = {
  male: '남자 화장실',
  female: '여자 화장실',
  unisex: '남녀공용 화장실',
  family: '가족 화장실',
};

/** 화장실 행에 이름과 함께 보일 보조 라벨. 같은 건물의 남/여 화장실이 같은 이름일 때 구분한다. 이름은 바꾸지 않는다. */
export function genderLabel(place: { restroomGender?: unknown }): string {
  return typeof place.restroomGender === 'string' ? GENDER_LABEL[place.restroomGender] ?? '화장실' : '화장실';
}

/** '가장 가까운 화장실' / '가장 가까운 남자 화장실' / '가장 가까운 여자 화장실'. */
export function nearestRestroomTitle(wanted: RestroomWanted): string {
  return wanted === 'male' ? '가장 가까운 남자 화장실' : wanted === 'female' ? '가장 가까운 여자 화장실' : '가장 가까운 화장실';
}
