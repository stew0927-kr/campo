import { defineProject } from 'vitest/config';

// Only the app's logic is tested here (plans, session, storage, export, projection): plain TypeScript with no React Native import.
export default defineProject({
  test: {
    name: 'mobile',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
