import { connectionFromValues } from '../../src/features/content/connection.ts';
// Test-only transport. A live-mode test uses intercepted example.test GETs, never the user's real endpoint.
export const APP_CONNECTION = new URLSearchParams(location.search).has('source')
  ? connectionFromValues('https://example.test', 'sb_publishable_test_only')
  : connectionFromValues();
