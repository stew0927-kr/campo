import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'osm-campus-map',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
