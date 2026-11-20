import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import { appReducer, INITIAL_STATE, type Action, type AppState } from './model.ts';
const Context = createContext<{ state: AppState; dispatch: Dispatch<Action> } | null>(null);
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAppState() {
  const value = useContext(Context);
  if (!value) throw new Error('AppStateProvider가 필요합니다.');
  return value;
}
