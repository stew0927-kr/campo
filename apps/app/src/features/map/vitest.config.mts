// Screen helpers live inside A's feature folder; the shared test configuration stays unchanged.
// From the repository root: npx vitest run --config apps/app/src/features/map/vitest.config.mts
export default {
  test: { environment: 'node', include: ['apps/app/src/features/map/model.test.ts', 'apps/app/test/appRoadview.test.ts', 'apps/app/test/appMapScreen.test.ts', 'apps/app/test/appMapUx.test.ts'] },
};
