// Sizes and colours of the survey screen. Everything that is pressed is at least TOUCH high and wide:
// the phone is in one hand, the surveyor is walking, and a wrong press records a wrong point.

/** Smallest touch target (dp). The accessibility minimum is 48. */
export const TOUCH = 56;
/** The main action buttons. */
export const TOUCH_LARGE = 64;

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

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 10, md: 16, pill: 999 } as const;
export const font = { small: 14, body: 16, label: 18, title: 22, display: 34 } as const;
