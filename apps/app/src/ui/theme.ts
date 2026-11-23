/**
 * CAMPO design tokens. Light, map-first wayfinding look:
 * deep campus navy for text, one vivid route blue for action, green/red only for start/end.
 * Shadows are reserved for elements that float above the map; page cards stay flat.
 */
export const theme = {
  color: {
    bg: '#F3F5F9', surface: '#FFFFFF', sunken: '#F6F8FB',
    text: '#142A44', muted: '#5E6E82', faint: '#8A97A8',
    primary: '#1F5EFF', primaryPressed: '#1749CC', soft: '#EBF1FF',
    border: '#E4E9F0', divider: '#EEF1F5',
    start: '#10A85E', end: '#F2473F',
    warning: '#8A5200', warningBg: '#FFF5DF',
    scrim: 'rgba(20, 42, 68, 0.32)',
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24 },
  /** Radius follows hierarchy: floating pills > sheets > cards > buttons. */
  radius: 16,
  radii: { pill: 999, sheet: 24, card: 16, button: 12, field: 12 },
  type: { display: 30, title: 24, heading: 17, body: 15, small: 13, micro: 12 },
} as const;

/** Floating elevation for map overlays only (search pill, FABs, sheets). */
export const floating = {
  shadowColor: '#0B1F3A', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6,
} as const;
