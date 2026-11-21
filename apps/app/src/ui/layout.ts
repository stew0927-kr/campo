/** Layout policy in dp. This does not claim native font/map rendering has been device-tested. */
export function screenLayout(width: number, height: number, fontScale = 1) {
  const compact = width < 360;
  const tablet = width >= 768;
  return {
    compact, tablet,
    padding: compact ? 12 : tablet ? 24 : 16,
    maxContentWidth: 960,
    stackActions: width < 380 || fontScale > 1.3,
    shortTabLabels: width < 380 || fontScale > 1.3,
    tabMinHeight: fontScale > 1.3 ? 80 : 66,
    mapHeight: Math.round(Math.max(200, Math.min(tablet ? 440 : 360, height * 0.4))),
    modalMaxWidth: 720,
  };
}
