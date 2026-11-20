import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { useAppState } from '../../state/AppState.tsx';
import type { DefaultMode } from '../../state/model.ts';
import { Body, Button, Card, Chips, Empty, Heading, Notice, Page } from '../../ui/kit.tsx';
import { AppInfoScreen } from './AppInfoScreen.tsx';
const PROFILES: { mode: DefaultMode; title: string; description: string }[] = [
  { mode: 'shortest', title: '일반 보행', description: '예상 이동 시간이 짧은 길을 안내합니다.' },
  { mode: 'step_free', title: '계단 회피', description: '계단을 되도록 피합니다. 피할 길이 없으면 기존 엔진의 대체 안내를 보여 줍니다.' },
  { mode: 'wheelchair', title: '휠체어 보행', description: '계단을 지나지 않는 길만 안내합니다. 통행 가능한 경로가 없을 수 있으며 현장 확인이 필요합니다.' },
];
export function MeScreen({ active = true }: { active?: boolean }) {
  const { state, dispatch } = useAppState();
  const [permission, setPermission] = useState('확인 중');
  const [message, setMessage] = useState<string | null>(null);
  const [category, setCategory] = useState('전체');
  useEffect(() => { let alive = true; void Location.getForegroundPermissionsAsync().then((result) => {
    if (alive) setPermission(result.granted ? '허용됨' : result.canAskAgain ? '미허용 · 지도에서 필요할 때 요청합니다' : '거절됨 · 기기 설정에서 변경할 수 있습니다');
  }, () => { if (alive) setPermission('이 환경에서는 확인할 수 없습니다'); }); return () => { alive = false; }; }, []);
  const kindLabel = (kind: string) => kind === 'place' ? '장소' : kind === 'stall' ? '부스' : kind === 'event' ? '행사' : '기타';
  const favorites = state.favorites.filter((item) => category === '전체' || kindLabel(item.kind) === category);
  return <Page resetKey={String(active)} title="내정보" subtitle="로그인 없이 보행 방식과 즐겨찾기를 관리합니다.">
    <Notice>설정·즐겨찾기는 앱을 실행한 동안만 기억합니다. 앱을 완전히 종료하면 초기화됩니다.</Notice>
    <Card><Heading>기본 이동 방식</Heading><Body>변경하면 지도 탭의 이동 방식에 바로 반영됩니다. 지도에서 다른 방식을 선택할 수도 있습니다.</Body>
      {PROFILES.map((profile) => <Card key={profile.mode}><Heading>{state.defaultMode === profile.mode ? '✓ ' : ''}{profile.title}</Heading><Body>{profile.description}</Body><Button secondary disabled={state.defaultMode === profile.mode} title={state.defaultMode === profile.mode ? '현재 기본값입니다' : `${profile.title}을 기본으로 설정`} onPress={() => dispatch({ type: 'mode', mode: profile.mode })} /></Card>)}
    </Card>
    <Heading>즐겨찾기</Heading><Chips values={['전체', '장소', '부스', '행사', '기타']} value={category} onChange={setCategory} />
    {favorites.length === 0 && <Empty message="아직 담은 항목이 없습니다. 지도 장소나 부스·행사 상세에서 즐겨찾기를 추가해 주세요." />}
    {favorites.map((item) => <Card key={item.key}><Heading>{item.name}</Heading><Body>{kindLabel(item.kind)}{item.demo ? ' · 시연용 정보' : ''}</Body><Button title="여기까지 길찾기" onPress={() => dispatch({ type: 'navigate', destination: item })} /><Button secondary title="즐겨찾기에서 삭제" onPress={() => dispatch({ type: 'favorite', destination: item })} /></Card>)}
    <Card><Heading>위치·센서 권한</Heading><Body>위치 권한: {permission}</Body><Body>GPS가 없어도 수동 출발·목적지 선택은 가능합니다. 지도에서 안내를 시작할 때만 위치를 요청하며, 기압계가 없는 기기에서는 층 추정이 제한됩니다. 앱이 백그라운드로 가면 추적을 멈춥니다.</Body><Button secondary title="기기 앱 설정 열기" onPress={() => { void Linking.openSettings().catch(() => setMessage('기기 설정을 열지 못했습니다. 휴대전화의 설정 앱에서 권한을 확인해 주세요.')); }} />{message && <Notice>{message}</Notice>}</Card>
    <AppInfoScreen />
  </Page>;
}
