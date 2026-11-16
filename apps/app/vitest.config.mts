import { defineProject } from 'vitest/config';

// The app's hook engines and campus loading are plain TypeScript with no React or React Native import, so they run in
// Node. The screens themselves are the front-end owner's; they are checked by `npm run typecheck`.
export default defineProject({
  test: {
    name: 'app',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
