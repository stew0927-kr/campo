import { describe, expect, it } from 'vitest';
import { filterBuildings, initialExpanded, isExpanded, normalizeQuery, toggleExpanded } from '../src/ui/scopeList.ts';

const buildings = [
  { id: 'b1', props: { name: '제1공학관', code: 'ENG1' } },
  { id: 'b2', props: { name: '도서관', code: 'LIB' } },
  { id: 'b3', props: { name: '학생회관', code: 'SU' } },
];

describe('filterBuildings', () => {
  it('keeps everyone, in order, for an empty or blank query', () => {
    expect(filterBuildings(buildings, '').map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(filterBuildings(buildings, '   ').map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('matches the name', () => {
    expect(filterBuildings(buildings, '도서').map((b) => b.id)).toEqual(['b2']);
  });

  it('matches the code without caring about case', () => {
    expect(filterBuildings(buildings, 'eng').map((b) => b.id)).toEqual(['b1']);
    expect(filterBuildings(buildings, 'LiB').map((b) => b.id)).toEqual(['b2']);
  });

  it('ignores spaces in the query and in the name', () => {
    expect(filterBuildings(buildings, '제 1 공학').map((b) => b.id)).toEqual(['b1']);
    expect(normalizeQuery(' E N G ')).toBe('eng');
  });

  it('returns nothing when no building matches', () => {
    expect(filterBuildings(buildings, '체육관')).toEqual([]);
  });
});

describe('expansion', () => {
  it('starts with only the current building open', () => {
    expect([...initialExpanded({ kind: 'building', buildingId: 'b2', level: 1 })]).toEqual(['b2']);
    const open = initialExpanded({ kind: 'building', buildingId: 'b2', level: 1 });
    expect(isExpanded(open, 'b2', '')).toBe(true);
    expect(isExpanded(open, 'b1', '')).toBe(false);
  });

  it('starts with everything folded when outdoors', () => {
    expect(initialExpanded({ kind: 'outdoor' }).size).toBe(0);
  });

  it('toggles each building on its own, without touching the input', () => {
    const start = initialExpanded({ kind: 'building', buildingId: 'b2', level: 1 });
    const opened = toggleExpanded(start, 'b1');
    expect(isExpanded(opened, 'b1', '')).toBe(true);
    expect(isExpanded(opened, 'b2', '')).toBe(true);
    const closed = toggleExpanded(opened, 'b2');
    expect(isExpanded(closed, 'b2', '')).toBe(false);
    expect(isExpanded(closed, 'b1', '')).toBe(true);
    expect(start.has('b1')).toBe(false);
  });

  it('opens every building while a query is typed, and goes back to the toggles after', () => {
    const folded = initialExpanded({ kind: 'outdoor' });
    expect(isExpanded(folded, 'b3', '학생')).toBe(true);
    expect(isExpanded(folded, 'b3', '')).toBe(false);
  });
});
