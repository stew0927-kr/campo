import { describe, expect, it } from 'vitest';
import * as core from '../src/index.ts';

describe('@campo/core', () => {
  it('loads the package entry', () => {
    expect(core).toBeTypeOf('object');
  });
});
