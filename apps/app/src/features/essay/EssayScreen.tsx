import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SourceNotice, type SourceProps } from '../content/SourceNotice.tsx';
import { selectEssays } from '../content/selectors.ts';
import type { ContentData, EssaySession } from '../content/types.ts';
import { ESSAY_NOTICE } from '../content/mock.ts';
import { essayDestination } from '../content/destinations.ts';
import { DestinationActions } from '../content/DestinationActions.tsx';
import { useAppSelector } from '../../state/AppState.tsx';
import { useScreenBack } from '../../ui/useScreenBack.ts';
import { Badge, Body, Bullets, Button, Caption, Card, Checklist, Chips, Empty, Hero, HeroStat, HeroStats, Page, Progress, SearchField, SectionHeader, Segmented } from '../../ui/kit.tsx';
import { theme as t } from '../../ui/theme.ts';
import { shortDate } from '../festival/guide.ts';
import { checkInTimeline } from './time.ts';

export function EssayScreen({ data, active = true, sourceMode = 'demo', sourceNotice = null, onReload }: { data: ContentData; active?: boolean } & SourceProps) {
  const lastEstimate = useAppSelector((s) => s.lastEstimate);
  const dates = [...new Set(data.essays.map((row) => row.examDate))].sort();
  const [date, setDate] = useState(dates[0] ?? '2026-11-28');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.essays.find((row) => row.id === selectedId);
  const currentDate = dates.includes(date) ? date : dates[0] ?? date;
  const items = selectEssays(data, currentDate, query);
  const dayCount = data.essays.filter((row) => row.examDate === currentDate).length;
  useScreenBack(active && selectedId !== null, useCallback(() => setSelectedId(null), []));
  const travel = selected?.destinationNodeId && lastEstimate?.nodeId === selected.destinationNodeId ? lastEstimate.timeSec : null;
  const firstCheckIn = data.essays.filter((row) => row.examDate === currentDate && row.checkInBy).map((row) => row.checkInBy!).sort()[0];
  const labels = Object.fromEntries(dates.map((value) => [value, shortDate(value)]));
  return <Page resetKey={`${active}:${selectedId}`} eyebrow={data.essays[0]?.seasonLabel ? `${data.essays[0].seasonLabel} 논술` : 'ESSAY'} title="논술 안내" subtitle="시험 시간·입실 마감·고사장 길찾기">
    <SourceNotice sourceMode={sourceMode} sourceNotice={sourceNotice} onReload={onReload} demoText={ESSAY_NOTICE} />
    {selected ? <EssayDetail exam={selected} demo={sourceMode === 'demo'} travel={travel} onBack={() => setSelectedId(null)} /> : <>
      {dates.length > 0 && (dates.length <= 4
        ? <Segmented label="시험 날짜" values={dates} value={currentDate} onChange={setDate} labels={labels} />
        : <Chips values={dates} value={currentDate} onChange={setDate} />)}
      {dates.length > 0 && <Hero eyebrow={`${shortDate(currentDate)} 시험`} title={`${dayCount}개 시험이 있습니다`} subtitle="시험을 고르면 고사장 위치와 입실 체크리스트를 볼 수 있습니다.">
        <HeroStats>
          <HeroStat value={firstCheckIn ?? '공지 전'} label="가장 이른 입실 마감" />
          <HeroStat value={`${dayCount}개`} label="이날 시험" />
        </HeroStats>
      </Hero>}
      <SearchField label="시험·고사장 검색" placeholder="계열·건물·호실 검색" value={query} onChangeText={setQuery} />
      {items.length === 0 && <Empty message={sourceMode === 'live' && data.essays.length === 0 ? '공개된 논술 일정이 아직 없습니다.' : '조건에 맞는 시험이 없습니다. 날짜나 검색어를 바꿔 주세요.'} />}
      {items.length > 0 && <SectionHeader title="시험 목록" trailing={<Badge label={`${items.length}개`} tone="navy" />} />}
      {items.map((item) => <ExamRow key={item.id} exam={item} onOpen={() => setSelectedId(item.id)} />)}
    </>}
  </Page>;
}

function ExamRow({ exam, onOpen }: { exam: EssaySession; onOpen: () => void }) {
  return <Card style={st.row}>
    <View style={st.rowHead}>
      <View style={st.timeBox}><Text style={st.timeStart}>{exam.startsAt}</Text><Text style={st.timeEnd}>~{exam.endsAt}</Text></View>
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Text style={st.title}>{exam.trackLabel}</Text>
        <View style={st.wrap}>
          <Badge label={`입실 ${exam.checkInBy ?? '미정'}`} tone="red" />
          <Badge label={[exam.buildingCode, exam.roomLabel].filter(Boolean).join(' · ') || '고사장 미정'} tone="navy" />
        </View>
        {exam.items.length > 0 && <Caption>준비물: {exam.items.slice(0, 2).join(' · ')}{exam.items.length > 2 ? ` 외 ${exam.items.length - 2}개` : ''}</Caption>}
      </View>
    </View>
    <Button compact secondary title="고사장 상세 보기" onPress={onOpen} />
  </Card>;
}

function EssayDetail({ exam, demo, travel, onBack }: { exam: EssaySession; demo: boolean; travel: number | null; onBack: () => void }) {
  const [done, setDone] = useState({ items: 0, total: exam.items.length });
  const onProgress = useCallback((items: number, total: number) => setDone({ items, total }), []);
  return <>
    <Button tone="ghost" title="시험 목록으로" onPress={onBack} />
    <Hero eyebrow={`${exam.trackLabel} · ${shortDate(exam.examDate)}`} title={`${exam.buildingCode ?? '고사장 미정'} ${exam.roomLabel ?? ''}`.trim()} subtitle={exam.destinationNodeId ? '지도에서 고사장 문 앞까지 안내합니다.' : '길찾기를 누르면 고사장 이름으로 목적지 검색이 열립니다.'}>
      <HeroStats>
        <HeroStat value={`${exam.startsAt}–${exam.endsAt}`} label="시험 시간" />
        <HeroStat value={exam.checkInBy ?? '공지 확인'} label="입실 마감" />
      </HeroStats>
    </Hero>
    <View style={st.deadline}><Text style={st.deadlineIcon}>⏰</Text><Text style={st.deadlineText}>입실 마감 {exam.checkInBy ?? '시각은 공식 공지를 확인해 주세요'}{exam.checkInBy ? ' 이후에는 입실이 제한될 수 있습니다.' : ''}</Text></View>
    <Card><DestinationActions destination={essayDestination(exam, demo)} /></Card>
    <SectionHeader title="준비물·유의사항" trailing={<Badge label={`${done.items}/${done.total}`} tone={done.total > 0 && done.items === done.total ? 'green' : 'neutral'} />} />
    <Card>
      <Progress value={done.total ? done.items / done.total : 0} tone="green" />
      {exam.items.length ? <Checklist key={`items-${exam.id}`} items={exam.items} onProgress={onProgress} /> : <Body>준비물 안내가 아직 없습니다.</Body>}
      {exam.notices.length > 0 && <Bullets items={exam.notices} />}
    </Card>
    <SectionHeader title="입실 동선 체크리스트" caption="출발부터 입실까지 차례대로 확인해 주세요." />
    <Card><Checklist key={`timeline-${exam.id}`} items={checkInTimeline(exam.examDate, exam.checkInBy, travel, demo)} /></Card>
  </>;
}

const st = StyleSheet.create({
  row: { padding: 14, gap: 10 },
  rowHead: { flexDirection: 'row', gap: 12 },
  timeBox: { width: 72, borderRadius: 14, paddingVertical: 10, alignItems: 'center', backgroundColor: t.color.soft },
  timeStart: { fontSize: 18, lineHeight: 24, fontWeight: '800', color: t.color.primary },
  timeEnd: { fontSize: 12, lineHeight: 16, color: t.color.muted, fontWeight: '600' },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '800', color: t.color.text },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  deadline: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 14, borderRadius: 18, backgroundColor: t.tone.red.bg, borderWidth: 1, borderColor: 'rgba(201, 48, 42, 0.2)' },
  deadlineIcon: { fontSize: 20 },
  deadlineText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '700', color: t.tone.red.fg },
});
