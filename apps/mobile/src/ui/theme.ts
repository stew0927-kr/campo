// Sizes and colours of the survey screen. The controls are compact so the map keeps the screen, but everything that is
// pressed is still at least TOUCH high (36 dp, a little under the 48 dp guideline, as asked for the compact layout):
// the surveyor is walking, and a wrong press records a wrong point.

/** Smallest touch target (dp). */
export const TOUCH = 38;
/** The main action buttons. */
export const TOUCH_LARGE = 42;

export const color = {
  bg: '#F4F1EA',
  surface: '#FFFFFF',
  ink: '#1C2430',
  inkSoft: '#5B6675',
  line: '#D9D3C7',
  primary: '#0B5FFF',
  onPrimary: '#FFFFFF',
  accent: '#E8590C',
  ok: '#1B873F',
  warn: '#B25E09',
  danger: '#C92A2A',
  backdrop: 'rgba(12, 18, 28, 0.45)',
  // map
  building: '#E4DED1',
  buildingHere: '#FFFFFF',
  buildingLine: '#9C9484',
  edge: '#7A8696',
  edgeFaint: '#C3C9D1',
  node: '#3D4A5C',
  made: '#E8590C',
  anchor: '#0B5FFF',
} as const;

export const space = { xs: 3, sm: 5, md: 8, lg: 10, xl: 16 } as const;
export const radius = { sm: 7, md: 10, pill: 999 } as const;
export const font = { small: 12, body: 14, label: 15, title: 18, display: 26 } as const;
