import { useState } from 'react';
import { TextInput } from 'react-native';
import type { ContentData, EventCategory } from '../content/types.ts';
import { CONTENT_NOTICE } from '../content/mock.ts';
import { eventDestination } from '../content/destinations.ts';
import { DestinationActions } from '../content/DestinationActions.tsx';
import { Body, Button, Card, Chips, Empty, Heading, Notice, Page, s } from '../../ui/kit.tsx';
import { seoulTime } from '../essay/time.ts';
export function EventsScreen({ data }: { data: ContentData }) {
  const [category, setCategory] = useState<'전체' | EventCategory>('전체');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.events.find((row) => row.id === selectedId);
  const items = data.events.filter((row) => (category === '전체' || row.category === category) && `${row.title} ${row.placeLabel} ${row.host}`.includes(query.trim())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.startsAt.localeCompare(b.startsAt));
  return <Page title="학교행사" subtitle="한양대학교 · 설명회·특강·행사 안내">
    <Notice>{CONTENT_NOTICE}</Notice>
    {selected ? <>
      <Button secondary title="행사 목록으로" onPress={() => setSelectedId(null)} />
      <Card><Heading>{selected.title}</Heading><Body>{selected.category} · {seoulTime(selected.startsAt)}{selected.endsAt ? `–${seoulTime(selected.endsAt)}` : ' · 종료 미정'} (한국시간)</Body><Body>장소: {selected.placeLabel ?? '미정'}{selected.allDay ? ' · 종일' : ''}</Body><Body>주최: {selected.host ?? '미정'}</Body><Body>{selected.summary ?? '상세 안내가 아직 없습니다.'}</Body><DestinationActions destination={eventDestination(selected)} />{!selected.nodeId && <Body>행사 장소 지도 연결 대기 중입니다. 길찾기 버튼을 누르면 장소 검색으로 이어집니다.</Body>}</Card>
    </> : <>
      <Chips values={['전체', '입학', '설명회', '강연', '행사', '공지'] as const} value={category} onChange={setCategory} />
      <TextInput accessibilityLabel="학교행사 검색" placeholder="행사·장소·주최 검색" value={query} onChangeText={setQuery} style={s.input} />
      {items.length === 0 && <Empty message="조건에 맞는 행사가 없습니다. 분류나 검색어를 바꿔 주세요." />}
      {items.map((row) => <Card key={row.id}><Heading>{row.pinned ? '주요 안내 · ' : ''}{row.title}</Heading><Body>{row.category} · {seoulTime(row.startsAt)} (한국시간)</Body><Body>{row.placeLabel ?? '장소 미정'}</Body><Button title="행사 상세 보기" onPress={() => setSelectedId(row.id)} /></Card>)}
    </>}
  </Page>;
}
