import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useDeferredValue, useEffect, useState, type ReactNode } from 'react';
import { BackHandler, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { MapScreen } from './src/features/map/MapScreen.tsx';
import { AppStateProvider, useAppActions, useAppSelector } from './src/state/AppState.tsx';
import type { Tab } from './src/state/model.ts';
import { TabBar } from './src/ui/TabBar.tsx';
import { ScreenBoundary } from './src/ui/ScreenBoundary.tsx';
import { EventsScreen } from './src/features/events/EventsScreen.tsx';
import { MeScreen } from './src/features/me/MeScreen.tsx';
import { FestivalScreen } from './src/features/festival/FestivalScreen.tsx';
import { EssayScreen } from './src/features/essay/EssayScreen.tsx';
import { useAppContent } from './src/features/content/useAppContent.ts';
import { Loading } from './src/ui/kit.tsx';
// Memoised screens: a tab switch re-renders only the two screens whose `active` flips (their other props are stable).
const MapTab = memo(MapScreen);
const Essay = memo(EssayScreen);
const Festival = memo(FestivalScreen);
const Events = memo(EventsScreen);
const Me = memo(MeScreen);
const MAP_TAB: Tab = '지도·길찾기';
/**
 * Tabs other than the map are mounted on first visit and then stay mounted (keeping their state; hidden tabs are
 * display:none). `tab` is the deferred tab, so a first mount happens in the background render after the tab bar moved.
 */
function useVisited(tab: Tab): ReadonlySet<Tab> {
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set([MAP_TAB, tab]));
  // Derived state, updated during render (React re-renders this component at once, before committing).
  if (!visited.has(tab)) { const next = new Set([...visited, tab]); setVisited(next); return next; }
  return visited;
}
const Pane = memo(function Pane({ active, children }: { active: boolean; children: ReactNode }) {
  return <View style={active ? PANE_ON : PANE_OFF}><ScreenBoundary>{children}</ScreenBoundary></View>;
// A hidden pane does not re-render at all; it catches up with the latest props when it becomes active again.
}, (prev, next) => prev.active === next.active && (!next.active || prev.children === next.children));
const PANE_ON = { flex: 1, display: 'flex' } as const;
const PANE_OFF = { flex: 1, display: 'none' } as const;
function AppContent() {
  // The store switches tab at once (back key and intents always see the real tab) and the tab bar highlights it in
  // that same urgent render. The screens follow `shownTab`, a deferred copy: React shows/hides and (on a first visit)
  // mounts them in an interruptible background render, so a press never waits for the screen to draw.
  const tab = useAppSelector((s) => s.tab);
  const shownTab = useDeferredValue(tab);
  const { dispatch, handleBack } = useAppActions();
  const content = useAppContent();
  const visited = useVisited(shownTab);
  const onTab = useCallback((next: Tab) => dispatch({ type: 'tab', tab: next }), [dispatch]);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => back.remove();
  }, [handleBack]);
  const source = { sourceMode: content.mode, sourceNotice: content.notice, onReload: content.reload } as const;
  const page = (name: Tab, screen: (active: boolean) => ReactNode) => {
    const active = shownTab === name;
    return <Pane active={active}>{visited.has(name) ? screen(active) : <Loading />}</Pane>;
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
    {page(MAP_TAB, (active) => <MapTab active={active} photoCatalog={content.catalog} photoNotice={content.photoNotice} />)}
    {page('논술', (active) => (content.data ? <Essay data={content.data} active={active} {...source} /> : <Loading />))}
    {page('축제', (active) => (content.data ? <Festival data={content.data} active={active} {...source} /> : <Loading />))}
    {page('학교행사', (active) => (content.data ? <Events data={content.data} active={active} {...source} /> : <Loading />))}
    {page('내정보', (active) => <Me active={active} contentMode={content.mode} />)}
    <TabBar tab={tab} onChange={onTab} />
  </SafeAreaView>;
}
export default function App() {
  return <SafeAreaProvider><AppStateProvider><StatusBar style="dark" /><AppContent /></AppStateProvider></SafeAreaProvider>;
}
