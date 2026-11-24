// Test-only stand-in for expo-image: a plain <img> that keeps the accessibility label. Image loading is not verified.
import { css } from './native.tsx';
export function Image(p: Record<string, any>) {
  return <img alt={p.accessibilityLabel ?? ''} aria-label={p.accessibilityLabel} src={p.source?.uri} style={{ objectFit: p.contentFit === 'contain' ? 'contain' : 'cover', ...css(p.style) }} />;
}
