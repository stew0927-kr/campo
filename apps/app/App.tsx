import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { MapScreen } from './src/features/map/MapScreen.tsx';
import { AppStateProvider, useAppState } from './src/state/AppState.tsx';
import { TabBar } from './src/ui/TabBar.tsx';
import { ScreenBoundary } from './src/ui/ScreenBoundary.tsx';
import { Body, Page } from './src/ui/kit.tsx';
function AppContent() {
  const { state, dispatch } = useAppState();
  return <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
    <View style={{ flex: 1, display: state.tab === '지도·길찾기' ? 'flex' : 'none' }}><ScreenBoundary><MapScreen /></ScreenBoundary></View>
    {state.tab !== '지도·길찾기' && <Page title={state.tab}><Body>화면을 준비하고 있습니다.</Body></Page>}
    <TabBar tab={state.tab} onChange={(tab) => dispatch({ type: 'tab', tab })} />
  </SafeAreaView>;
}
export default function App() {
  return <SafeAreaProvider><AppStateProvider><StatusBar style="dark" /><AppContent /></AppStateProvider></SafeAreaProvider>;
}
