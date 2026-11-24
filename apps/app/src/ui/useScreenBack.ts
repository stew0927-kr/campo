import { useEffect } from 'react';
import { useAppActions } from '../state/AppState.tsx';
/** Register only the active detail, independent of native effect subscription order. */
export function useScreenBack(active: boolean, onBack: () => void) {
  const { registerBack } = useAppActions();
  useEffect(() => active ? registerBack(onBack) : undefined, [active, onBack, registerBack]);
}
