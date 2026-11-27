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
  /**
   * Facility glyph colors on the map (icon ring, glyph and the label's leading dot). Muted and distinct per group,
   * each at least 4.5:1 on white (WCAG AA). Start/end/primary stay reserved for endpoints and the current selection.
   */
  facility: {
    door: '#5E6E82', elevator: '#0E7490', stairs: '#9A5B00', restroom: '#2F6FD6', entrance: '#18744D', place: '#5E6E82', building: '#33465C',
  },
  /**
   * Liquid Glass layer (content tabs). Translucent white over a soft blue/green aura, a bright top rim and a hairline navy
   * edge. Opacity stays high (≥ 0.72) so navy text keeps AA contrast even where no real blur is available.
   */
  glass: {
    fill: 'rgba(255, 255, 255, 0.74)', fillStrong: 'rgba(255, 255, 255, 0.9)', fillSoft: 'rgba(255, 255, 255, 0.56)',
    blurFill: 'rgba(255, 255, 255, 0.5)', rim: 'rgba(255, 255, 255, 0.95)', edge: 'rgba(20, 42, 68, 0.08)',
    track: 'rgba(20, 42, 68, 0.06)', tint: 'rgba(31, 94, 255, 0.08)',
    auraBlue: 'rgba(31, 94, 255, 0.14)', auraGreen: 'rgba(16, 168, 94, 0.10)', auraNavy: 'rgba(20, 42, 68, 0.06)',
    heroRim: 'rgba(255, 255, 255, 0.22)', heroGlow: 'rgba(31, 94, 255, 0.55)', heroGlow2: 'rgba(16, 168, 94, 0.32)', onHero: 'rgba(255, 255, 255, 0.76)',
  },
  /** Status tints for badges and banners (text color on a light tint of the same hue). */
  tone: {
    blue: { fg: '#1F5EFF', bg: '#EBF1FF' }, green: { fg: '#0B7D46', bg: '#E5F6EE' }, red: { fg: '#C9302A', bg: '#FDECEB' },
    amber: { fg: '#8A5200', bg: '#FFF5DF' }, navy: { fg: '#142A44', bg: '#E8EDF4' }, neutral: { fg: '#5E6E82', bg: '#EEF1F5' },
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24 },
  /** Radius follows hierarchy: floating pills > sheets > cards > buttons. */
  radius: 16,
  radii: { pill: 999, sheet: 24, hero: 28, glass: 22, card: 16, button: 12, field: 12 },
  type: { display: 30, title: 24, heading: 17, body: 15, small: 13, micro: 12 },
} as const;

/** Floating elevation for map overlays only (search pill, FABs, sheets). */
/** Soft depth for glass cards in the content tabs (smaller than map overlays). */
export const depth = {
  shadowColor: '#0B1F3A', shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 2,
} as const;
export type Tone = keyof typeof theme.tone;

export const floating = {
  shadowColor: '#0B1F3A', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6,
} as const;
