import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { BackHandler, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { MapScreen } from './src/features/map/MapScreen.tsx';
import { AppStateProvider, useAppState } from './src/state/AppState.tsx';
import { TabBar } from './src/ui/TabBar.tsx';
import { ScreenBoundary } from './src/ui/ScreenBoundary.tsx';
import { EventsScreen } from './src/features/events/EventsScreen.tsx';
import { MeScreen } from './src/features/me/MeScreen.tsx';
import { FestivalScreen } from './src/features/festival/FestivalScreen.tsx';
import { EssayScreen } from './src/features/essay/EssayScreen.tsx';
import { useAppContent } from './src/features/content/useAppContent.ts';
import { Loading } from './src/ui/kit.tsx';
function AppContent() {
  const { state, dispatch, handleBack } = useAppState();
  const content = useAppContent();
  const sourceProps = { sourceMode: content.mode, sourceNotice: content.notice, onReload: content.reload };
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => back.remove();
  }, [handleBack]);
  return <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
    <View style={{ flex: 1, display: state.tab === '지도·길찾기' ? 'flex' : 'none' }}><ScreenBoundary><MapScreen active={state.tab === '지도·길찾기'} photoCatalog={content.catalog} photoNotice={content.photoNotice} /></ScreenBoundary></View>
    <View style={{ flex: 1, display: state.tab === '논술' ? 'flex' : 'none' }}><ScreenBoundary>{content.data ? <EssayScreen data={content.data} active={state.tab === '논술'} {...sourceProps} /> : <Loading />}</ScreenBoundary></View>
    <View style={{ flex: 1, display: state.tab === '축제' ? 'flex' : 'none' }}><ScreenBoundary>{content.data ? <FestivalScreen data={content.data} active={state.tab === '축제'} {...sourceProps} /> : <Loading />}</ScreenBoundary></View>
    <View style={{ flex: 1, display: state.tab === '학교행사' ? 'flex' : 'none' }}><ScreenBoundary>{content.data ? <EventsScreen data={content.data} active={state.tab === '학교행사'} {...sourceProps} /> : <Loading />}</ScreenBoundary></View>
    <View style={{ flex: 1, display: state.tab === '내정보' ? 'flex' : 'none' }}><ScreenBoundary><MeScreen active={state.tab === '내정보'} contentMode={content.mode} /></ScreenBoundary></View>
    <TabBar tab={state.tab} onChange={(tab) => dispatch({ type: 'tab', tab })} />
  </SafeAreaView>;
}
export default function App() {
  return <SafeAreaProvider><AppStateProvider><StatusBar style="dark" /><AppContent /></AppStateProvider></SafeAreaProvider>;
}
