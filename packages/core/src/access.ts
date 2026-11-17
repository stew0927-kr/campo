// Opening hours, closures and access conditions of a point (SPEC 4.2): the names, the presets and the patch both the
// editor's 상세 정보 tab and the survey app's sheet use. The values are free text for people; routing does not read them.
/** The node properties that say when and how a point (a door, an entrance) can be passed. */
export const ACCESS_PROPS = ['hours', 'closed_period', 'access_condition'] as const;
export type AccessProp = (typeof ACCESS_PROPS)[number];
export type AccessInfo = Partial<Record<AccessProp, string>>;

/** Choices offered for each access property; anything else can be typed in. */
export const ACCESS_PRESETS: Record<AccessProp, readonly string[]> = {
  hours: ['24/7', '07:00-22:00', '09:00-18:00'],
  closed_period: [],
  access_condition: ['상시개방', '학생증 태깅', '관리실 문의'],
};

export const ACCESS_LABELS: Record<AccessProp, string> = { hours: '개방시간', closed_period: '폐쇄기간', access_condition: '개방조건' };
export const ACCESS_PLACEHOLDERS: Record<AccessProp, string> = { hours: '예: 07:00-22:00', closed_period: '예: 2026-11-15~2026-11-30', access_condition: '예: 학생증 태깅' };

/**
 * The setProps patch that makes `current` say `next`: values are trimmed, an empty one removes the property, and a
 * property that already has the value is left out. null when nothing would change.
 */
export function accessPatch(current: AccessInfo, next: AccessInfo): Record<AccessProp, string | undefined> | null {
  const patch: Partial<Record<AccessProp, string | undefined>> = {};
  for (const key of ACCESS_PROPS) {
    if (!(key in next)) continue;
    const value = next[key]?.trim() ?? '';
    if (value === (current[key] ?? '')) continue;
    patch[key] = value === '' ? undefined : value;
  }
  return Object.keys(patch).length === 0 ? null : (patch as Record<AccessProp, string | undefined>);
}
