import type { ReactNode } from 'react';
import { View } from './native.tsx';
export { View as SafeAreaView } from './native.tsx';
export function SafeAreaProvider({ children }: { children?: ReactNode }) { return <View style={{ flex: 1, height: '100%' }}>{children}</View>; }
/** Test-only: no notch or system bars in the DOM adapter. */
export function useSafeAreaInsets() { return { top: 0, bottom: 0, left: 0, right: 0 }; }
