// The model's text → a checked DraftMap. Models wrap JSON in code fences or add a sentence around it; both are
// stripped. Points of an unknown kind and corridors that point outside the list are dropped, and how many is said in
// `warnings`. Only when no JSON object can be read at all is it a failure (extract_failed).
import {
  DOOR_ROLES, DRAFT_KINDS, RESTROOM_GENDERS,
  type DraftCorridor, type DraftKind, type DraftMap, type DraftNode, type DoorRole, type RestroomGender,
} from './types.ts';

export type ParseResult = DraftMap | { error: string };

/** The JSON object inside `text`: without code fences, else from the first "{" to the last "}". */
function jsonObjectOf(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (c === undefined) continue;
    const trimmed = c.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A finite number (or a numeric string), clamped to 0..1000 and rounded; undefined otherwise. */
export function coordOf(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.round(Math.min(1000, Math.max(0, n)));
}

/** A trimmed, non-empty string (numbers such as room 301 are taken as text). */
function textOf(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

function oneOf<T extends string>(allowed: readonly T[], v: unknown): T | undefined {
  const t = textOf(v)?.toLowerCase();
  return t !== undefined && (allowed as readonly string[]).includes(t) ? (t as T) : undefined;
}

function indexOf(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : undefined;
}

export function parseDraft(text: string): ParseResult {
  const raw = jsonObjectOf(text);
  if (!isRecord(raw) || !Array.isArray(raw.nodes)) {
    return { error: '안내도에서 읽은 결과를 해석하지 못했습니다. 사진을 더 밝고 반듯하게 다시 찍어 주세요.' };
  }
  const warnings: string[] = [];
  if (Array.isArray(raw.warnings)) for (const w of raw.warnings) {
    const t = textOf(w);
    if (t !== undefined) warnings.push(t);
  }

  const nodes: DraftNode[] = [];
  /** Index in the model's list → index in `nodes` (dropped points have none). */
  const kept = new Map<number, number>();
  let badKind = 0;
  let badCoord = 0;
  let noGender = 0;
  let autoElevator = 0;
  raw.nodes.forEach((item, i) => {
    if (!isRecord(item)) {
      badKind++;
      return;
    }
    const kind = oneOf<DraftKind>(DRAFT_KINDS, item.kind);
    if (kind === undefined) {
      badKind++;
      return;
    }
    const x = coordOf(item.x);
    const y = coordOf(item.y);
    if (x === undefined || y === undefined) {
      badCoord++;
      return;
    }
    const node: DraftNode = { kind, x, y };
    if (kind === 'door') {
      const roomRef = textOf(item.room_ref);
      const spaceName = textOf(item.space_name);
      const role = oneOf<DoorRole>(DOOR_ROLES, item.door_role);
      if (roomRef !== undefined) node.room_ref = roomRef;
      if (spaceName !== undefined) node.space_name = spaceName;
      if (role !== undefined) node.door_role = role;
    } else if (kind === 'elevator_stop') {
      const id = textOf(item.elevator_id);
      // Every stop needs an id; one without is an elevator of its own.
      node.elevator_id = id ?? `EV_auto${++autoElevator}`;
    } else if (kind === 'restroom') {
      const gender = oneOf<RestroomGender>(RESTROOM_GENDERS, item.restroom_gender);
      if (gender === undefined) {
        noGender++;
        return;
      }
      node.restroom_gender = gender;
      const spaceName = textOf(item.space_name);
      if (spaceName !== undefined) node.space_name = spaceName;
    } else if (kind === 'stair_landing') {
      const spaceName = textOf(item.space_name);
      if (spaceName !== undefined) node.space_name = spaceName;
    }
    kept.set(i, nodes.length);
    nodes.push(node);
  });

  const corridors: DraftCorridor[] = [];
  let badCorridor = 0;
  if (Array.isArray(raw.corridors)) for (const c of raw.corridors) {
    const from = isRecord(c) ? indexOf(c.from) : undefined;
    const to = isRecord(c) ? indexOf(c.to) : undefined;
    const a = from !== undefined ? kept.get(from) : undefined;
    const b = to !== undefined ? kept.get(to) : undefined;
    if (a === undefined || b === undefined) {
      badCorridor++;
      continue;
    }
    corridors.push({ from: a, to: b });
  }

  if (badKind > 0) warnings.push(`종류를 알 수 없는 점 ${badKind}개는 버렸습니다.`);
  if (badCoord > 0) warnings.push(`좌표가 없는 점 ${badCoord}개는 버렸습니다.`);
  if (noGender > 0) warnings.push(`성별을 알 수 없는 화장실 ${noGender}개는 버렸습니다. 현장에서 [화장실]로 찍어 주세요.`);
  if (autoElevator > 0) warnings.push(`번호가 없는 엘리베이터 ${autoElevator}개는 각각 다른 엘리베이터로 놓았습니다.`);
  if (badCorridor > 0) warnings.push(`없는 점을 가리키는 복도 구간 ${badCorridor}개는 버렸습니다.`);
  return { nodes, corridors, warnings };
}
