import { createContext, useCallback, useContext, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from 'react';
import { appReducer, INITIAL_STATE, type Action, type AppState, type Tab } from './model.ts';
interface StateContext {
  state: AppState;
  dispatch: Dispatch<Action>;
  registerBack: (callback: () => void) => () => void;
  handleBack: () => boolean;
}
const Context = createContext<StateContext | null>(null);
export function AppStateProvider({ children, initialState = INITIAL_STATE }: { children: ReactNode; initialState?: AppState }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const latest = useRef(state);
  latest.current = state;
  const backHandlers = useRef(new Map<Tab, () => void>());
  const registerBack = useCallback((callback: () => void) => {
    const tab = latest.current.tab;
    backHandlers.current.set(tab, callback);
    return () => { if (backHandlers.current.get(tab) === callback) backHandlers.current.delete(tab); };
  }, []);
  const handleBack = useCallback(() => {
    const tab = latest.current.tab;
    const callback = backHandlers.current.get(tab);
    if (callback) { callback(); return true; }
    if (tab !== '지도·길찾기') { dispatch({ type: 'tab', tab: '지도·길찾기' }); return true; }
    return false;
  }, []);
  const value = useMemo(() => ({ state, dispatch, registerBack, handleBack }), [state, registerBack, handleBack]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAppState() {
  const value = useContext(Context);
  if (!value) throw new Error('AppStateProvider가 필요합니다.');
  return value;
}
