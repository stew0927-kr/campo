import type { ReactNode } from 'react';
import { View } from './native.tsx';
export { View as SafeAreaView } from './native.tsx';
export function SafeAreaProvider({ children }: { children?: ReactNode }) { return <View style={{ flex: 1, height: '100%' }}>{children}</View>; }
