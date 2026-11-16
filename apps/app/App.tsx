// 캠포 사용자 앱의 유일한 화면. 5탭 UI와 네비게이션은 프론트 담당이 붙인다(그래서 여기는 비워 두었다).
// 지금은 캠퍼스 데이터가 정상적으로 읽히는지만 보여 주고, 새 화면을 만들 때 이 파일을 출발점으로 쓰면 된다.
// 사용법과 훅 계약: docs/FRONTEND_HANDOFF.md
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useCampusData } from './src/hooks/useCampusData.ts';

export default function App() {
  const campus = useCampusData();

  const status =
    campus.status === 'error'
      ? (campus.error ?? '캠퍼스 데이터를 읽지 못했습니다.')
      : campus.campus === null
        ? '캠퍼스 데이터를 읽는 중입니다.'
        : `${campus.campus.name} · 지점 ${campus.counts.nodes} · 구간 ${campus.counts.edges} · 건물 ${campus.counts.buildings}`;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <View style={styles.screen}>
        <Text style={styles.title}>캠포</Text>
        <Text style={styles.status}>{status}</Text>
        {campus.issues.length > 0 && <Text style={styles.issue}>읽지 못한 항목 {campus.issues.length}개</Text>}
        <Text style={styles.hint}>다섯 탭 화면은 여기에 붙입니다. docs/FRONTEND_HANDOFF.md를 보세요.</Text>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: '#FFFFFF' },
  title: { fontSize: 32, fontWeight: '700', color: '#1A1A1A' },
  status: { fontSize: 15, color: '#3C3C3C', textAlign: 'center' },
  issue: { fontSize: 13, color: '#B45309' },
  hint: { fontSize: 13, color: '#8A8A8A', textAlign: 'center' },
});
