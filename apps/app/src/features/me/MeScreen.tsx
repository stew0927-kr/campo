import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useAppActions, useAppSelector } from '../../state/AppState.tsx';
import type { DefaultMode, Destination } from '../../state/model.ts';
import { Badge, Body, Button, Caption, Card, Chips, Empty, Hero, HeroStat, HeroStats, IconBubble, Notice, Page, SectionHeader } from '../../ui/kit.tsx';
import { theme as t, type Tone } from '../../ui/theme.ts';
import { AppInfoScreen } from './AppInfoScreen.tsx';

const PROFILES: { mode: DefaultMode; title: string; description: string; glyph: string }[] = [
  { mode: 'shortest', title: '일반 보행', description: '예상 이동 시간이 짧은 길을 안내합니다.', glyph: '🚶' },
  { mode: 'step_free', title: '계단 회피', description: '계단을 되도록 피합니다.', glyph: '↗' },
  { mode: 'wheelchair', title: '휠체어 보행', description: '계단을 지나지 않는 길만 안내합니다.', glyph: '♿' },
];
type Permission = { label: string; tone: Tone; detail: string };
const CHECKING: Permission = { label: '확인 중', tone: 'neutral', detail: '위치 권한 상태를 확인하고 있습니다.' };
const KIND: Record<string, { label: string; glyph: string; tone: Tone }> = {
  place: { label: '장소', glyph: '📍', tone: 'blue' }, stall: { label: '부스', glyph: '🎪', tone: 'amber' }, event: { label: '행사', glyph: '📅', tone: 'green' },
};
const kindOf = (kind: string) => KIND[kind] ?? { label: '기타', glyph: '⭐', tone: 'navy' as Tone };

export function MeScreen({ active = true, contentMode = 'demo' }: { active?: boolean; contentMode?: 'demo' | 'live' }) {
  const { dispatch } = useAppActions();
  const defaultMode = useAppSelector((s) => s.defaultMode);
  const allFavorites = useAppSelector((s) => s.favorites);
  const [permission, setPermission] = useState<Permission>(CHECKING);
  const [message, setMessage] = useState<string | null>(null);
  const [category, setCategory] = useState('전체');
  useEffect(() => { let alive = true; void Location.getForegroundPermissionsAsync().then((result) => {
    if (!alive) return;
    setPermission(result.granted ? { label: '허용됨', tone: 'green', detail: '지도에서 내 위치 안내를 사용할 수 있습니다.' }
      : result.canAskAgain ? { label: '미허용', tone: 'amber', detail: '지도에서 필요할 때 요청합니다.' }
      : { label: '거절됨', tone: 'red', detail: '기기 설정에서 변경할 수 있습니다.' });
  }, () => { if (alive) setPermission({ label: '확인 불가', tone: 'neutral', detail: '이 환경에서는 확인할 수 없습니다.' }); }); return () => { alive = false; }; }, []);
  const favorites = allFavorites.filter((item) => category === '전체' || kindOf(item.kind).label === category);
  const counts = (label: string) => allFavorites.filter((item) => kindOf(item.kind).label === label).length;
  const currentProfile = PROFILES.find((profile) => profile.mode === defaultMode) ?? PROFILES[0]!;
  return <Page resetKey={String(active)} eyebrow="MY CAMPO" title="내정보" subtitle="이동 방식·즐겨찾기·권한">
    <Hero eyebrow="지금 설정" title={`${currentProfile.glyph}  ${currentProfile.title}`} subtitle="지도 탭의 이동 방식에 바로 반영됩니다.">
      <HeroStats>
        <HeroStat value={`${allFavorites.length}개`} label="즐겨찾기" />
        <HeroStat value={permission.label} label="위치 권한" />
      </HeroStats>
    </Hero>

    <SectionHeader title="기본 이동 방식" caption="길찾기 결과가 이 방식으로 먼저 계산됩니다." />
    <View accessibilityRole="radiogroup" style={{ gap: 10 }}>{PROFILES.map((profile) => {
      const on = defaultMode === profile.mode;
      return <Pressable key={profile.mode} accessibilityRole="button" accessibilityLabel={on ? `${profile.title}, 현재 기본값입니다` : `${profile.title}을 기본으로 설정`} accessibilityState={{ selected: on }} onPress={() => dispatch({ type: 'mode', mode: profile.mode })} style={[st.mode, on && st.modeOn]}>
        <IconBubble glyph={profile.glyph} tone={on ? 'blue' : 'neutral'} size={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={st.modeTitle}>{profile.title}</Text><Text style={st.modeDesc}>{profile.description}</Text></View>
        <View style={[st.radio, on && st.radioOn]}>{on && <View style={st.radioDot} />}</View>
      </Pressable>;
    })}</View>

    <SectionHeader title="즐겨찾기" trailing={<Badge label={`${allFavorites.length}개`} tone="navy" />} />
    <Chips values={['전체', '장소', '부스', '행사', '기타']} value={category} onChange={setCategory} />
    {favorites.length === 0 && <Empty message="아직 담은 항목이 없습니다. 지도 장소나 부스·행사 상세에서 즐겨찾기를 추가해 주세요." />}
    {favorites.length > 0 && <Card style={{ padding: 6, gap: 0 }}>{favorites.map((item, index) => <FavoriteRow key={item.key} item={item} first={index === 0} onGo={() => dispatch({ type: 'navigate', destination: item })} onRemove={() => dispatch({ type: 'favorite', destination: item })} />)}</Card>}
    {category === '전체' && allFavorites.length > 0 && <Caption>장소 {counts('장소')} · 부스 {counts('부스')} · 행사 {counts('행사')} · 기타 {counts('기타')}</Caption>}

    <SectionHeader title="위치·센서 권한" />
    <Card>
      <View style={st.permRow}><Body strong>위치 권한</Body><Badge label={permission.label} tone={permission.tone} solid={permission.tone === 'green'} /></View>
      <Caption>{permission.detail}</Caption>
      <Body>위치는 지도에서 위치 안내를 시작할 때만 요청하며 앱에서 저장하지 않습니다. 앱이 백그라운드로 가면 추적을 멈춥니다.</Body>
      <Button compact secondary title="기기 앱 설정 열기" onPress={() => { void Linking.openSettings().catch(() => setMessage('기기 설정을 열지 못했습니다. 휴대전화의 설정 앱에서 권한을 확인해 주세요.')); }} />
      {message && <Notice>{message}</Notice>}
    </Card>

    <AppInfoScreen contentMode={contentMode} />
  </Page>;
}

function FavoriteRow({ item, first, onGo, onRemove }: { item: Destination; first: boolean; onGo: () => void; onRemove: () => void }) {
  const kind = kindOf(item.kind);
  return <View style={[st.fav, !first && st.favDivider]}>
    <View style={st.favHead}>
      <IconBubble glyph={kind.glyph} tone={kind.tone} size={40} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text numberOfLines={2} style={st.modeTitle}>{item.name}</Text><Badge label={kind.label} tone={kind.tone} /></View>
    </View>
    <View style={st.favActions}>
      <View style={{ flex: 1 }}><Button compact title="여기까지 길찾기" onPress={onGo} /></View>
      <View style={{ flex: 1 }}><Button compact tone="ghost" title="즐겨찾기에서 삭제" onPress={onRemove} /></View>
    </View>
  </View>;
}

const st = StyleSheet.create({
  mode: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, borderWidth: 1, borderColor: t.glass.edge, backgroundColor: t.glass.fill },
  modeOn: { borderColor: t.color.primary, borderWidth: 2, backgroundColor: t.glass.fillStrong },
  modeTitle: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: t.color.text },
  modeDesc: { fontSize: 13, lineHeight: 18, color: t.color.muted },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#C3CDDA', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: t.color.primary }, radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: t.color.primary },
  fav: { padding: 12, gap: 10 }, favDivider: { borderTopWidth: 1, borderColor: t.color.divider },
  favHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  favActions: { flexDirection: 'row', gap: 8 },
  permRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
