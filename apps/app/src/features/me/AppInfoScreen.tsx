import { useState } from 'react';
import Constants from 'expo-constants';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Caption, Card, IconBubble, Notice, SectionHeader } from '../../ui/kit.tsx';
import { theme as t, type Tone } from '../../ui/theme.ts';
import licenses from './licenses.json';
export const PRIVACY_URL = 'https://stew0927-kr.github.io/campo-legal/privacy.html';
export const TERMS_URL = 'https://stew0927-kr.github.io/campo-legal/terms.html';
export const CONTACT_EMAIL = 'campo@gmail.com';
const LINKS = [
  { name: 'Expo · MIT', url: 'https://github.com/expo/expo' },
  { name: 'React · MIT', url: 'https://github.com/facebook/react' },
  { name: 'React Native · MIT', url: 'https://github.com/facebook/react-native' },
  { name: 'MapLibre React Native · MIT', url: 'https://github.com/maplibre/maplibre-react-native' },
  { name: 'OpenStreetMap · ODbL·저작자 표시', url: 'https://www.openstreetmap.org/copyright' },
];

/**
 * One settings row: leading glyph, title, optional value, chevron. The pressable's only child is the title text so the
 * row reads as its title to screen readers; the glyph and chevron are decorations laid over the row's padding.
 */
function SettingRow({ title, glyph, tone = 'navy', value, first = false, onPress }: { title: string; glyph: string; tone?: Tone; value?: string; first?: boolean; onPress: () => void }) {
  return <View style={st.row}>
    {!first && <View pointerEvents="none" style={st.divider} />}
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [st.press, pressed && st.pressed]}><Text style={st.title}>{title}</Text></Pressable>
    <View pointerEvents="none" style={st.lead}><IconBubble glyph={glyph} tone={tone} size={32} /></View>
    <View pointerEvents="none" style={st.trail}>{value ? <Text numberOfLines={1} style={st.value}>{value}</Text> : null}<Text style={st.chevron}>›</Text></View>
  </View>;
}

export function AppInfoScreen({ contentMode = 'demo' }: { contentMode?: 'demo' | 'live' }) {
  const [message, setMessage] = useState<string | null>(null);
  const [showLicenses, setShowLicenses] = useState(false);
  async function open(url: string) { try { await Linking.openURL(url); } catch { setMessage('링크를 열지 못했습니다. 인터넷 연결과 브라우저를 확인해 주세요.'); } }
  return <>
    <SectionHeader title="앱 정보" caption={`CAMPO 버전 ${Constants.expoConfig?.version ?? '확인 대기 중'}`} />
    <Card>
      <Body strong>CAMPO 앱 정보</Body>
      <Body>한양대학교 서울캠퍼스 보행 길안내 앱입니다.</Body>
      <Caption>지도 배경 © OpenStreetMap 기여자 · 캠퍼스 데이터: CAMPO 팀 현장 조사</Caption>
      <Caption>{contentMode === 'live' ? '콘텐츠는 서버 공개 데이터입니다. ' : ''}논술·축제·학교행사 일정과 장소는 변경될 수 있으니 학교 공식 공지로 확인해 주세요.</Caption>
    </Card>
    <Card style={st.group}>
      <SettingRow first title="개인정보 처리방침" glyph="🔒" tone="blue" onPress={() => void open(PRIVACY_URL)} />
      <SettingRow title="이용약관" glyph="📄" tone="navy" onPress={() => void open(TERMS_URL)} />
      <SettingRow title="문의처" glyph="✉️" tone="green" value={CONTACT_EMAIL} onPress={() => void open(`mailto:${CONTACT_EMAIL}`)} />
    </Card>
    <Body>문의: {CONTACT_EMAIL}</Body>
    <SectionHeader title="오픈소스·지도 출처" />
    <Card style={st.group}>
      {LINKS.map((link, index) => <SettingRow key={link.url} first={index === 0} title={`${link.name} · 외부 링크 열기`} glyph="↗" tone="neutral" onPress={() => void open(link.url)} />)}
      <SettingRow title={showLicenses ? '라이선스 전문 접기' : '주요 사용 패키지 라이선스 전문 보기'} glyph="§" tone="neutral" onPress={() => setShowLicenses((old) => !old)} />
    </Card>
    {showLicenses && licenses.map((item) => <Card key={item.name}><Body strong>{item.name} · {item.version}</Body><Caption>{item.text}</Caption></Card>)}
    {message && <Notice>{message}</Notice>}
  </>;
}

const st = StyleSheet.create({
  group: { padding: 0, gap: 0, overflow: 'hidden' },
  row: { position: 'relative' },
  divider: { position: 'absolute', top: 0, left: 60, right: 0, height: 1, backgroundColor: t.color.divider },
  press: { minHeight: 56, justifyContent: 'center', paddingLeft: 60, paddingRight: 44, paddingVertical: 12 },
  pressed: { backgroundColor: t.glass.track },
  title: { fontSize: 15, lineHeight: 21, fontWeight: '600', color: t.color.text },
  lead: { position: 'absolute', left: 14, top: 0, bottom: 0, justifyContent: 'center' },
  trail: { position: 'absolute', right: 14, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  value: { fontSize: 13, color: t.color.faint, maxWidth: 160 },
  chevron: { fontSize: 22, color: t.color.faint },
});
