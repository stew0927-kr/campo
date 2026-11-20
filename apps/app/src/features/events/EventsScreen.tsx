import { SourceNotice, type SourceProps } from '../content/SourceNotice.tsx';
import { openPublicLink, publicLink } from '../../ui/external.ts';
import { eventSections, selectEvents } from '../content/selectors.ts';
import { useScreenBack } from '../../ui/useScreenBack.ts';
import { useCallback, useState } from 'react';
import { Linking, TextInput } from 'react-native';
import type { ContentData, EventCategory } from '../content/types.ts';
import { CONTENT_NOTICE } from '../content/mock.ts';
import { eventDestination } from '../content/destinations.ts';
import { DestinationActions } from '../content/DestinationActions.tsx';
import { Body, Button, Card, Chips, Empty, Heading, Notice, Page, s } from '../../ui/kit.tsx';
import { seoulTime } from '../essay/time.ts';
export function EventsScreen({ data, active = true, sourceMode = 'demo', sourceNotice = null, onReload }: { data: ContentData; active?: boolean } & SourceProps) {
  const [category, setCategory] = useState<'전체' | EventCategory>('전체');
  const [period, setPeriod] = useState<'전체' | '다가오는 행사'>('전체');
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.events.find((row) => row.id === selectedId);
  const items = selectEvents(data, category, query, period);
  const sections = eventSections(items);
  useScreenBack(active && selectedId !== null, useCallback(() => setSelectedId(null), []));
  return <Page resetKey={`${active}:${selectedId}`} title="학교행사" subtitle="한양대학교 · 설명회·특강·행사 안내">
    <SourceNotice sourceMode={sourceMode} sourceNotice={sourceNotice} onReload={onReload} demoText={CONTENT_NOTICE} />
    {selected ? <>
      <Button secondary title="행사 목록으로" onPress={() => setSelectedId(null)} />
      <Card><Heading>{selected.title}</Heading><Body>{selected.category} · {seoulTime(selected.startsAt)}{selected.endsAt ? `–${seoulTime(selected.endsAt)}` : ' · 종료 미정'} (한국시간)</Body><Body>장소: {selected.placeLabel ?? '미정'}{selected.allDay ? ' · 종일' : ''}</Body><Body>주최: {selected.host ?? '미정'}</Body><Body>{selected.summary ?? '상세 안내가 아직 없습니다.'}</Body><Button secondary disabled={!publicLink(selected.linkUrl)} title={publicLink(selected.linkUrl) ? '원문 보기 · 외부 브라우저' : sourceMode === 'demo' ? '원문 링크 미제공 · 시연용 정보' : '원문 링크 미제공'} onPress={() => { void openPublicLink(selected.linkUrl, Linking.openURL).then(setLinkMessage); }} />{linkMessage && <Notice>{linkMessage}</Notice>}<DestinationActions destination={eventDestination(selected, sourceMode === 'demo')} />{!selected.nodeId && <Body>행사 장소 지도 연결 대기 중입니다. 길찾기 버튼을 누르면 장소 검색으로 이어집니다.</Body>}</Card>
    </> : <>
      <Chips values={['다가오는 행사', '전체'] as const} value={period} onChange={setPeriod} />
      <Chips values={['전체', '입학', '설명회', '강연', '행사', '공지'] as const} value={category} onChange={setCategory} />
      <TextInput accessibilityLabel="학교행사 검색" placeholder="행사·장소·주최 검색" value={query} onChangeText={setQuery} style={s.input} />
      {items.length === 0 && <><Empty message={sourceMode === 'live' && data.events.length === 0 ? '서버에 공개된 학교행사가 없습니다. 공개 행사가 등록되면 표시됩니다.' : '조건에 맞는 행사가 없습니다. 분류나 검색어를 바꿔 주세요.'} /><Button secondary title="전체 일정 보기" onPress={() => { setPeriod('전체'); setCategory('전체'); setQuery(''); }} /></>}
      {sections.map((section) => <Card key={section.title}><Heading>{section.title}</Heading>{section.data.map((row) => <Card key={row.id}><Heading>{row.pinned ? '고정 · ' : ''}{row.title}</Heading><Body>{row.category} · {seoulTime(row.startsAt)} (한국시간)</Body><Body>{row.placeLabel ?? '장소 미정'}</Body><Button title="행사 상세 보기" onPress={() => { setLinkMessage(null); setSelectedId(row.id); }} /></Card>)}</Card>)}
    </>}
  </Page>;
}
