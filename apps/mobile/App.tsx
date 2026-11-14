// 캠포 현장 조사: start-up. Loads the campus bundled into the app, continues the walk saved on the phone when there is
// one, and hands both to the survey screen.
import { createIdGen } from '@campo/core';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import bundle from './assets/campus.generated.json';
import { SurveyScreen } from './src/SurveyScreen.tsx';
import { loadCampus, type BundledCampus, type Campus } from './src/campus.ts';
import { expoStore } from './src/storage/expoStore.ts';
import { clearSnapshot, loadSnapshot } from './src/storage/store.ts';
import { SurveySession } from './src/survey/session.ts';
import { isoLocal } from './src/time.ts';
import { BigButton } from './src/ui/controls.tsx';
import { color, font, space } from './src/ui/theme.ts';

type Boot =
  | { status: 'loading' }
  | { status: 'ready'; campus: Campus; session: SurveySession; greeting: string | null }
  /** A saved walk that cannot be continued on this campus data. It is kept until the surveyor decides. */
  | { status: 'stale'; campus: Campus; reason: string }
  | { status: 'failed'; reason: string };

/** Id tails differ from run to run, so two phones surveying the same floor do not make the same ids. */
const newIds = () => createIdGen((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);

function fresh(campus: Campus, greeting: string | null = null): Boot {
  const session = new SurveySession({ campus: campus.id, base: campus.base, ids: newIds(), startedAt: isoLocal(new Date()) });
  return { status: 'ready', campus, session, greeting };
}

async function boot(): Promise<Boot> {
  // The JSON import loses the [lng, lat] tuples of the outlines; the shape is the one scripts/bundle-campus.mjs writes.
  const campus = loadCampus(bundle as unknown as BundledCampus);
  const unread = campus.issues > 0 ? `읽지 못한 항목이 ${campus.issues}개 있습니다. 편집기의 오류 검사에서 확인해 주세요.` : null;
  const snapshot = await loadSnapshot(expoStore);
  if (!snapshot) return fresh(campus, unread);
  const restored = SurveySession.restore({ campus: campus.id, base: campus.base, ids: newIds() }, snapshot);
  if ('error' in restored) return { status: 'stale', campus, reason: restored.error };
  return { status: 'ready', campus, session: restored.session, greeting: '저장된 조사를 이어서 합니다.' };
}

export default function App() {
  const [state, setState] = useState<Boot>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    boot().then(
      (next) => alive && setState(next),
      (err: Error) => alive && setState({ status: 'failed', reason: err.message }),
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {state.status === 'ready' ? (
        // A new session gets a new screen: nothing of the old walk's screen state carries over.
        <SurveyScreen
          key={state.session.startedAt}
          campus={state.campus}
          session={state.session}
          store={expoStore}
          greeting={state.greeting}
          onReset={() => setState(fresh(state.campus, '새 조사를 시작합니다.'))}
        />
      ) : (
        <View style={styles.message}>
          {state.status === 'loading' && <Text style={styles.text}>캠퍼스 데이터를 불러오는 중입니다.</Text>}
          {state.status === 'failed' && <Text style={styles.text}>앱을 시작하지 못했습니다. {state.reason}</Text>}
          {state.status === 'stale' && (
            <>
              <Text style={styles.title}>저장된 조사를 이어갈 수 없습니다</Text>
              <Text style={styles.text}>앱에 들어 있는 캠퍼스 데이터가 조사를 시작했을 때와 달라졌습니다. {state.reason}</Text>
              <Text style={styles.text}>기록은 기기에 그대로 있습니다. 이전 버전의 앱으로 내보내거나, 지우고 새로 시작할 수 있습니다.</Text>
              <BigButton
                tone="danger"
                label="기록 지우고 새 조사 시작"
                onPress={() => void clearSnapshot(expoStore).then(() => setState(fresh(state.campus, '새 조사를 시작합니다.')), (err: Error) => setState({ status: 'failed', reason: err.message }))}
              />
            </>
          )}
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  message: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.lg, backgroundColor: color.bg },
  title: { fontSize: font.title, fontWeight: '800', color: color.ink },
  text: { fontSize: font.body, lineHeight: 24, color: color.ink },
});
