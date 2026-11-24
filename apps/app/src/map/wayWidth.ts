// Pure (no React Native import) so Node tests can inspect it. MapLibre Native only accepts ['zoom'] as the direct input
// of a top-level "step"/"interpolate", so the width scale is multiplied into each stop's output instead of wrapping the curve.
import type { StyleSpecification } from '@maplibre/maplibre-react-native';

type LineLayer = Extract<StyleSpecification['layers'][number], { type: 'line' }>;
type LineWidth = NonNullable<NonNullable<LineLayer['paint']>['line-width']>;

/** Width factor of an outdoor way: about 2 m = 1x, clamped to 0.7x–1.8x; 2 m when width is missing. */
const WAY_SCALE = ['max', 0.7, ['min', 1.8, ['/', ['coalesce', ['get', 'width'], 2], 2]]];
const stop = (zoom: number, px: number) => [zoom, ['*', px, WAY_SCALE]];

/** Way thickness: grows with zoom (1.4 px at z14 to 11 px at z20) and follows width_m. */
export const WAY_WIDTH = ['interpolate', ['linear'], ['zoom'],
  ...stop(14, 1.4), ...stop(16, 2.6), ...stop(17, 3.6), ...stop(18, 5.2), ...stop(19, 7.5), ...stop(20, 11),
] as unknown as LineWidth;
