import { useState } from 'react';
import Constants from 'expo-constants';
import { Linking } from 'react-native';
import { Body, Button, Card, Heading, Notice } from '../../ui/kit.tsx';
import licenses from './licenses.json';
const LINKS = [
  { name: 'Expo · MIT', url: 'https://github.com/expo/expo' },
  { name: 'React · MIT', url: 'https://github.com/facebook/react' },
  { name: 'React Native · MIT', url: 'https://github.com/facebook/react-native' },
  { name: 'MapLibre React Native · MIT', url: 'https://github.com/maplibre/maplibre-react-native' },
  { name: 'OpenStreetMap · ODbL·저작자 표시', url: 'https://www.openstreetmap.org/copyright' },
];
export function AppInfoScreen() {
  const [message, setMessage] = useState<string | null>(null);
  const [showLicenses, setShowLicenses] = useState(false);
  async function open(url: string) { try { await Linking.openURL(url); } catch { setMessage('링크를 열지 못했습니다. 인터넷 연결과 브라우저를 확인해 주세요.'); } }
  return <>
    <Card><Heading>CAMPO 앱 정보</Heading><Body>버전 {Constants.expoConfig?.version ?? '확인 대기 중'}</Body><Body>한양대학교 서울캠퍼스 보행 길안내 시제품입니다. 실제 경로 데이터와 현장 검증은 연결 대기 중입니다.</Body>
      <Body>지도 배경 © OpenStreetMap 기여자 · 캠퍼스 데이터 담당: CAMPO 팀 현장 조사(C조원). 현재 빈 데이터 또는 명시된 개발용 가상 데이터를 사용합니다.</Body>
      <Body>논술·축제·학교행사 콘텐츠는 시연용입니다. 실제 공지나 운영 정보로 사용하지 마세요.</Body>
      <Button secondary disabled title="개인정보 처리방침 · D조원 URL 준비 중" onPress={() => undefined} /><Body>팀 공용 문의처: D조원 제공 대기 중입니다. 개인 연락처를 사용하지 않습니다.</Body>
    </Card>
    <Card><Heading>오픈소스·지도 출처</Heading>{LINKS.map((link) => <Button key={link.url} secondary title={`${link.name} · 외부 링크 열기`} onPress={() => void open(link.url)} />)}
      <Button secondary title={showLicenses ? '라이선스 전문 접기' : '주요 사용 패키지 라이선스 전문 보기'} onPress={() => setShowLicenses((old) => !old)} />
      {showLicenses && licenses.map((item) => <Card key={item.name}><Heading>{item.name} · {item.version}</Heading><Body>{item.text}</Body></Card>)}
      <Body>배포 전 네이티브 SDK와 간접 의존성을 포함한 전체 고지는 B조원과 최종 확인해야 합니다.</Body>
      {message && <Notice>{message}</Notice>}
    </Card>
  </>;
}
