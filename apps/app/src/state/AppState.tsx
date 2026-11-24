import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type Dispatch, type ReactNode } from 'react';
import { appReducer, INITIAL_STATE, type Action, type AppState, type Tab } from './model.ts';
/**
 * App state lives in a tiny external store (same reducer). Components subscribe to what they read: `useAppSelector`
 * re-renders only when the selected value changes, so switching tabs does not re-render screens that never read `tab`.
 * `useAppState()` keeps its old shape (whole state + actions) for screens that read several fields.
 */
interface Store {
  get: () => AppState;
  dispatch: Dispatch<Action>;
  subscribe: (listener: () => void) => () => void;
}
function createStore(initial: AppState): Store {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    dispatch: (action) => {
      const next = appReducer(state, action);
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
interface Actions {
  store: Store;
  dispatch: Dispatch<Action>;
  registerBack: (callback: () => void) => () => void;
  handleBack: () => boolean;
}
interface StateContext extends Omit<Actions, 'store'> {
  state: AppState;
}
const Context = createContext<Actions | null>(null);
export function AppStateProvider({ children, initialState = INITIAL_STATE }: { children: ReactNode; initialState?: AppState }) {
  const [store] = useState(() => createStore(initialState));
  const [backHandlers] = useState(() => new Map<Tab, () => void>());
  const registerBack = useCallback((callback: () => void) => {
    const tab = store.get().tab;
    backHandlers.set(tab, callback);
    return () => { if (backHandlers.get(tab) === callback) backHandlers.delete(tab); };
  }, [store, backHandlers]);
  const handleBack = useCallback(() => {
    const tab = store.get().tab;
    const callback = backHandlers.get(tab);
    if (callback) { callback(); return true; }
    if (tab !== '지도·길찾기') { store.dispatch({ type: 'tab', tab: '지도·길찾기' }); return true; }
    return false;
  }, [store, backHandlers]);
  // Stable for the provider's lifetime: a state change never re-renders consumers through this context.
  const value = useMemo(() => ({ store, dispatch: store.dispatch, registerBack, handleBack }), [store, registerBack, handleBack]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
function useActions(): Actions {
  const value = useContext(Context);
  if (!value) throw new Error('AppStateProvider가 필요합니다.');
  return value;
}
/** Whole state and actions. Re-renders on every state change; prefer `useAppSelector` + `useAppActions` on heavy screens. */
export function useAppState(): StateContext {
  const { store, dispatch, registerBack, handleBack } = useActions();
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { state, dispatch, registerBack, handleBack };
}
/** One slice of state. The selector must return a stored value (or a primitive), not a new object. */
export function useAppSelector<T>(selector: (state: AppState) => T): T {
  const { store } = useActions();
  const read = () => selector(store.get());
  return useSyncExternalStore(store.subscribe, read, read);
}
/** dispatch / back registration only: never re-renders on state changes. */
export function useAppActions(): Omit<StateContext, 'state'> {
  const { dispatch, registerBack, handleBack } = useActions();
  return { dispatch, registerBack, handleBack };
}
