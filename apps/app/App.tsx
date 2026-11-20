import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { MapScreen } from './src/features/map/MapScreen.tsx';
import { AppStateProvider, useAppState } from './src/state/AppState.tsx';
import { TabBar } from './src/ui/TabBar.tsx';
import { ScreenBoundary } from './src/ui/ScreenBoundary.tsx';
import { EventsScreen } from './src/features/events/EventsScreen.tsx';
import { MeScreen } from './src/features/me/MeScreen.tsx';
import { FestivalScreen } from './src/features/festival/FestivalScreen.tsx';
import { EssayScreen } from './src/features/essay/EssayScreen.tsx';
import { ContentGate } from './src/features/content/ContentGate.tsx';
import { useContent } from './src/features/content/repository.ts';
import { DEMO_SOURCE } from './src/features/content/mock.ts';
function AppContent() {
  const { state, dispatch } = useAppState();
  const content = useContent(DEMO_SOURCE);
  return <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
    <View style={{ flex: 1, display: state.tab === '지도·길찾기' ? 'flex' : 'none' }}><ScreenBoundary><MapScreen active={state.tab === '지도·길찾기'} /></ScreenBoundary></View>
    {state.tab !== '지도·길찾기' && <View style={{ flex: 1 }}><ScreenBoundary key={state.tab}>
    {state.tab === '논술' && <ContentGate content={content}>{(data) => <EssayScreen data={data} />}</ContentGate>}
    {state.tab === '축제' && <ContentGate content={content}>{(data) => <FestivalScreen data={data} />}</ContentGate>}
    {state.tab === '학교행사' && <ContentGate content={content}>{(data) => <EventsScreen data={data} />}</ContentGate>}
    {state.tab === '내정보' && <MeScreen />}
    </ScreenBoundary></View>}
    <TabBar tab={state.tab} onChange={(tab) => dispatch({ type: 'tab', tab })} />
  </SafeAreaView>;
}
export default function App() {
  return <SafeAreaProvider><AppStateProvider><StatusBar style="dark" /><AppContent /></AppStateProvider></SafeAreaProvider>;
}
