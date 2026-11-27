import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { SourceNotice, type SourceProps } from '../content/SourceNotice.tsx';
import { openPublicLink, publicLink } from '../../ui/external.ts';
import { eventSections, selectEvents } from '../content/selectors.ts';
import { useScreenBack } from '../../ui/useScreenBack.ts';
import type { ContentData, EventCategory, SchoolEvent } from '../content/types.ts';
import { CONTENT_NOTICE } from '../content/mock.ts';
import { eventDestination } from '../content/destinations.ts';
import { DestinationActions } from '../content/DestinationActions.tsx';
import { Badge, Body, Button, Caption, Card, Chips, Empty, Hero, Meta, Notice, Page, SearchField, SectionHeader, Segmented, TimelineSlot } from '../../ui/kit.tsx';
import { theme as t, type Tone } from '../../ui/theme.ts';
import { seoulTime } from '../essay/time.ts';

const CATEGORY_TONE: Record<EventCategory, Tone> = { 입학: 'blue', 설명회: 'green', 강연: 'navy', 행사: 'amber', 공지: 'red' };
/** Korea calendar parts of an instant, independent of the device time zone. */
function koreaParts(iso: string): { date: string; time: string } {
  const text = seoulTime(iso); // 'MM. DD. HH:mm' style from Intl in ko-KR
  const digits = text.match(/\d+/g) ?? [];
  return { date: digits.length >= 2 ? `${Number(digits[0])}/${Number(digits[1])}` : text, time: digits.length >= 4 ? `${digits[2]}:${digits[3]}` : '' };
}

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
  const open = (row: SchoolEvent) => { setLinkMessage(null); setSelectedId(row.id); };
  return <Page resetKey={`${active}:${selectedId}`} eyebrow="CAMPUS EVENTS" title="학교행사" subtitle="설명회·특강·행사 안내">
    <SourceNotice sourceMode={sourceMode} sourceNotice={sourceNotice} onReload={onReload} demoText={CONTENT_NOTICE} />
    {selected ? <>
      <Button tone="ghost" title="행사 목록으로" onPress={() => setSelectedId(null)} />
      <Hero eyebrow={`${selected.pinned ? '고정 · ' : ''}${selected.category}`} title={selected.title} subtitle={`${seoulTime(selected.startsAt)}${selected.endsAt ? `–${seoulTime(selected.endsAt)}` : ' · 종료 미정'} (한국시간)`} />
      <Card>
        <Meta label="장소" value={`${selected.placeLabel ?? '미정'}${selected.allDay ? ' · 종일' : ''}`} />
        <Meta label="주최" value={selected.host ?? '미정'} />
        <Body>{selected.summary ?? '상세 안내가 아직 없습니다.'}</Body>
        <Button secondary disabled={!publicLink(selected.linkUrl)} title={publicLink(selected.linkUrl) ? '원문 보기 · 외부 브라우저' : '원문 링크 없음'} onPress={() => { void openPublicLink(selected.linkUrl, Linking.openURL).then(setLinkMessage); }} />
        {linkMessage && <Notice>{linkMessage}</Notice>}
      </Card>
      <Card><DestinationActions destination={eventDestination(selected, sourceMode === 'demo')} />{!selected.nodeId && <Caption>길찾기를 누르면 장소 검색으로 이어집니다.</Caption>}</Card>
    </> : <>
      <Segmented label="기간" values={['다가오는 행사', '전체'] as const} value={period} onChange={setPeriod} />
      <Chips values={['전체', '입학', '설명회', '강연', '행사', '공지'] as const} value={category} onChange={setCategory} />
      <SearchField label="학교행사 검색" placeholder="행사·장소·주최 검색" value={query} onChangeText={setQuery} />
      {items.length === 0 && <><Empty message={sourceMode === 'live' && data.events.length === 0 ? '공개된 학교행사가 아직 없습니다.' : '조건에 맞는 행사가 없습니다. 분류나 검색어를 바꿔 주세요.'} /><Button secondary title="전체 일정 보기" onPress={() => { setPeriod('전체'); setCategory('전체'); setQuery(''); }} /></>}
      {sections.map((section) => section.title === '고정 공지'
        ? <View key={section.title} style={{ gap: 10 }}>
          <SectionHeader title="📌 고정 공지" trailing={<Badge label={`${section.data.length}건`} tone="red" />} />
          {section.data.map((row) => <PinnedCard key={row.id} event={row} onOpen={() => open(row)} />)}
        </View>
        : <View key={section.title} style={{ gap: 10 }}>
          <SectionHeader title={section.title} trailing={<Badge label={`${section.data.length}건`} tone="navy" />} />
          {section.data.map((row, index) => {
            const when = koreaParts(row.startsAt);
            return <TimelineSlot key={row.id} time={when.date} caption={row.allDay ? '종일' : when.time} last={index === section.data.length - 1}>
              <EventCard event={row} onOpen={() => open(row)} />
            </TimelineSlot>;
          })}
        </View>)}
    </>}
  </Page>;
}

function EventCard({ event, onOpen }: { event: SchoolEvent; onOpen: () => void }) {
  return <Card style={st.card}>
    <View style={st.wrap}><Badge label={event.category} tone={CATEGORY_TONE[event.category]} />{event.host && <Badge label={event.host} tone="neutral" />}</View>
    <Text style={st.title}>{event.title}</Text>
    <Caption>📍 {event.placeLabel ?? '장소 미정'} · {seoulTime(event.startsAt)} (한국시간)</Caption>
    <Button compact secondary title="행사 상세 보기" onPress={onOpen} />
  </Card>;
}

function PinnedCard({ event, onOpen }: { event: SchoolEvent; onOpen: () => void }) {
  return <Card tint="rgba(242, 71, 63, 0.06)" style={st.card}>
    <View style={st.wrap}><Badge label="고정" tone="red" solid /><Badge label={event.category} tone={CATEGORY_TONE[event.category]} /></View>
    <Text style={st.title}>고정 · {event.title}</Text>
    {event.summary && <Text numberOfLines={2} style={st.summary}>{event.summary}</Text>}
    <Button compact secondary title="행사 상세 보기" onPress={onOpen} />
  </Card>;
}

const st = StyleSheet.create({
  card: { padding: 14, gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '800', color: t.color.text },
  summary: { fontSize: 13, lineHeight: 19, color: t.color.muted },
});
