import { useState } from 'react';
import { TextInput } from 'react-native';
import type { ContentData, StallCategory } from '../content/types.ts';
import { CONTENT_NOTICE } from '../content/mock.ts';
import { stageDestination, stallDestination } from '../content/destinations.ts';
import { DestinationActions } from '../content/DestinationActions.tsx';
import { useAppState } from '../../state/AppState.tsx';
import { Body, Button, Card, Chips, Empty, Heading, Notice, Page, s } from '../../ui/kit.tsx';
import { BoothMap } from './BoothMap.tsx';
import { flowDestination, hasFlowNodes, type StallFlow } from './flow.ts';
const FLOW_LABEL: Record<StallFlow, string> = { enter: '입장 동선', queue: '대기 동선', exit: '퇴장 동선' };
export function FestivalScreen({ data }: { data: ContentData }) {
  const { dispatch } = useAppState();
  const festival = data.festivals[0];
  const days = data.days.filter((d) => d.festivalId === festival?.id).sort((a, b) => a.dayDate.localeCompare(b.dayDate));
  const [dayId, setDayId] = useState(days[0]?.id ?? '');
  const [category, setCategory] = useState<'전체' | StallCategory>('전체');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [performanceId, setPerformanceId] = useState<string | null>(null);
  const currentDay = days.find((d) => d.id === dayId) ?? days[0];
  const stalls = data.stalls.filter((row) => row.dayId === currentDay?.id && (category === '전체' || category === row.category) && row.name.includes(query.trim())).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'));
  const performances = data.performances.filter((row) => row.dayId === currentDay?.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const selected = data.stalls.find((row) => row.id === selectedId);
  const selectedPerformance = performances.find((row) => row.id === performanceId);
  return <Page title="축제" subtitle={festival?.name ?? '공개된 축제가 없습니다.'}>
    <Notice>{CONTENT_NOTICE} 지도 핀·입장·대기·퇴장 경로는 실제 지점이 연결된 경우에만 표시합니다.</Notice>
    {festival ? <>
      <Card><Heading>{festival.name}</Heading><Body>{festival.startsOn}–{festival.endsOn}</Body><Body>{festival.summary}</Body></Card>
      <Chips values={days.map((day) => day.dayDate)} value={currentDay?.dayDate ?? ''} onChange={(value) => { setDayId(days.find((day) => day.dayDate === value)?.id ?? ''); setSelectedId(null); setPerformanceId(null); }} />
      <Body>운영 {currentDay?.opensAt ?? '미정'}–{currentDay?.closesAt ?? '미정'} · 시연용</Body>
      {selected ? <>
        <Button secondary title="부스 목록으로" onPress={() => setSelectedId(null)} />
        <Card><Heading>{selected.name}</Heading><Body>{selected.category} · {selected.buildingCode ?? '위치 미정'}</Body><Body>운영 {selected.opensAt ?? '미정'}–{selected.closesAt ?? '미정'}</Body><Body>{selected.description}</Body><Notice>{selected.queueNote ?? '대기 정보가 없습니다.'}</Notice><DestinationActions destination={stallDestination(selected)} /></Card>
        <Card><Heading>시연용 동선 안내</Heading><Body>입장=파랑 · 대기=주황 · 퇴장=회색. 실제 대기열의 모양·혼잡도는 제공하지 않습니다.</Body>
          {(['enter', 'queue', 'exit'] as const).map((flow) => <Button key={flow} secondary title={`${FLOW_LABEL[flow]}${hasFlowNodes(selected, flow) ? '' : ' · 지도 연결 대기'}`} onPress={() => dispatch({ type: 'navigate', destination: flowDestination(selected, flow) })} />)}
          <Body>입장: 입구 → 부스 / 대기: 선택한 출발지 → 부스 / 퇴장: 부스 → 출구. 지도 ID가 없으면 장소 검색으로 이어집니다.</Body>
        </Card>
        <BoothMap stalls={[selected]} onSelect={(row) => setSelectedId(row.id)} />
      </> : <>
        <Heading>공연 타임테이블</Heading>
        {performances.length === 0 && <Empty message="이 날짜의 공연 정보가 없습니다." />}
        {performances.map((row) => <Card key={row.id}><Heading>{row.startsAt} · {row.artist}</Heading><Body>{row.stageLabel ?? '무대 미정'} · 종료 {row.endsAt ?? '미정'}</Body><Button secondary title="공연 상세 보기" onPress={() => setPerformanceId(row.id === performanceId ? null : row.id)} />{selectedPerformance?.id === row.id && <><Body>{row.description}</Body><DestinationActions destination={stageDestination(row)} /></>}</Card>)}
        <Heading>주점·부스 찾기</Heading>
        <Chips values={['전체', '주점', '부스', '공연', '편의'] as const} value={category} onChange={setCategory} />
        <TextInput accessibilityLabel="축제 부스 검색" placeholder="부스 이름 검색" style={s.input} value={query} onChangeText={setQuery} />
        <BoothMap stalls={stalls} onSelect={(row) => setSelectedId(row.id)} />
        {stalls.length === 0 && <Empty message="조건에 맞는 부스가 없습니다. 날짜·분류·검색어를 바꿔 주세요." />}
        {stalls.map((row) => <Card key={row.id}><Heading>{row.name}</Heading><Body>{row.category} · {row.buildingCode}</Body><Button title="부스 상세 보기" onPress={() => setSelectedId(row.id)} /></Card>)}
      </>}
    </> : <Empty message="공개된 축제 정보가 없습니다." />}
  </Page>;
}
