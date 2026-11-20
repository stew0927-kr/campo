import { SourceNotice, type SourceProps } from '../content/SourceNotice.tsx';
import { selectEssays } from '../content/selectors.ts';
import { useScreenBack } from '../../ui/useScreenBack.ts';
import { useCallback, useState } from 'react';
import { TextInput } from 'react-native';
import type { ContentData } from '../content/types.ts';
import { ESSAY_NOTICE } from '../content/mock.ts';
import { essayDestination } from '../content/destinations.ts';
import { DestinationActions } from '../content/DestinationActions.tsx';
import { useAppState } from '../../state/AppState.tsx';
import { Body, Button, Card, Checklist, Chips, Empty, Heading, Notice, Page, s } from '../../ui/kit.tsx';
import { checkInTimeline } from './time.ts';
export function EssayScreen({ data, active = true, sourceMode = 'demo', sourceNotice = null, onReload }: { data: ContentData; active?: boolean } & SourceProps) {
  const { state } = useAppState();
  const dates = [...new Set(data.essays.map((row) => row.examDate))].sort();
  const [date, setDate] = useState(dates[0] ?? '2026-11-28');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.essays.find((row) => row.id === selectedId);
  const currentDate = dates.includes(date) ? date : dates[0] ?? date;
  const items = selectEssays(data, currentDate, query);
  useScreenBack(active && selectedId !== null, useCallback(() => setSelectedId(null), []));
  const travel = selected?.destinationNodeId && state.lastEstimate?.nodeId === selected.destinationNodeId ? state.lastEstimate.timeSec : null;
  return <Page resetKey={`${active}:${selectedId}`} title="논술 안내" subtitle={sourceMode === 'demo' ? '2027학년도 · 2026년 11월 28~29일 시연' : data.essays[0]?.seasonLabel ?? '공개 논술 일정'}>
    <SourceNotice sourceMode={sourceMode} sourceNotice={sourceNotice} onReload={onReload} demoText={ESSAY_NOTICE} />
    {selected ? <>
      <Button secondary title="시험 목록으로" onPress={() => setSelectedId(null)} />
      <Card><Heading>{selected.trackLabel}</Heading><Body>{selected.examDate} · {selected.startsAt}–{selected.endsAt}</Body><Heading>{selected.buildingCode ?? '고사장 미정'} · {selected.roomLabel ?? '호실 미정'}</Heading><Body>입실 마감: {selected.checkInBy ?? '공식 공지 확인 필요'} · {sourceMode === 'demo' ? '가상 배정 정보입니다.' : '서버 공개 배정 정보입니다. 공식 공지로 확인해 주세요.'}</Body>
        <Heading>준비물·유의사항</Heading><Checklist key={`items-${selected.id}`} items={selected.items} />{selected.notices.map((notice) => <Body key={notice}>{notice}</Body>)}
        <DestinationActions destination={essayDestination(selected, sourceMode === 'demo')} />
        {!selected.destinationNodeId && <Body>지도 지점 연결 대기 중입니다. 길찾기를 누르면 고사장 이름으로 목적지 검색이 열립니다. 검색 결과가 없으면 직접 목적지를 선택해 주세요.</Body>}
      </Card>
      <Card><Heading>입실 동선 체크리스트{sourceMode === 'demo' ? ' · 시연용' : ''}</Heading><Checklist key={`timeline-${selected.id}`} items={checkInTimeline(selected.examDate, selected.checkInBy, travel, sourceMode === 'demo')} /></Card>
    </> : <>
      <Chips values={dates} value={currentDate} onChange={setDate} />
      <TextInput accessibilityLabel="시험·고사장 검색" placeholder="시험·건물·호실 검색" value={query} onChangeText={setQuery} style={s.input} />
      {items.length === 0 && <Empty message={sourceMode === 'live' && data.essays.length === 0 ? '서버에 공개된 논술 일정이 없습니다. 공개 일정이 등록되면 표시됩니다.' : '조건에 맞는 시험이 없습니다. 날짜나 검색어를 바꿔 주세요.'} />}
      {items.map((item) => <Card key={item.id}><Heading>{item.trackLabel}</Heading><Body>{item.startsAt}–{item.endsAt} · 입실 {item.checkInBy ?? '미정'}</Body><Body>{item.buildingCode} · {item.roomLabel}{sourceMode === 'demo' ? ' (가상)' : ''}</Body><Body>준비물{sourceMode === 'demo' ? ' 예시' : ''}: {item.items.slice(0, 2).join(' · ')}</Body><Button title="고사장 상세 보기" onPress={() => setSelectedId(item.id)} /></Card>)}
    </>}
  </Page>;
}
