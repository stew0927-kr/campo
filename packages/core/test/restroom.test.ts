import { describe, expect, it } from 'vitest';
import { isRestroomFor, type NodeFeature } from '../src/index.ts';

const restroom = (gender: string | undefined, type = 'restroom'): NodeFeature =>
  ({ properties: { node_type: type, restroom_gender: gender } }) as unknown as NodeFeature;

describe('isRestroomFor', () => {
  it('matches the asked gender and the both-genders restroom', () => {
    expect(isRestroomFor(restroom('male'), 'male')).toBe(true);
    expect(isRestroomFor(restroom('male'), 'female')).toBe(false);
    expect(isRestroomFor(restroom('unisex'), 'male')).toBe(true);
    expect(isRestroomFor(restroom('unisex'), 'female')).toBe(true);
  });
  it('ignores other node types', () => {
    expect(isRestroomFor(restroom('unisex', 'door'), 'male')).toBe(false);
  });
});
