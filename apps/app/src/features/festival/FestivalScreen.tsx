import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SourceNotice, type SourceProps } from '../content/SourceNotice.tsx';
import { selectStalls } from '../content/selectors.ts';
import type { ContentData, FestivalFlowGuide, FestivalPerformance, FestivalStall, StallCategory } from '../content/types.ts';
import { CONTENT_NOTICE } from '../content/mock.ts';
import { stageDestination, stallDestination } from '../content/destinations.ts';
import { DestinationActions } from '../content/DestinationActions.tsx';
import { useAppActions } from '../../state/AppState.tsx';
import { useScreenBack } from '../../ui/useScreenBack.ts';
import {
  Badge, Banner, Body, Bullets, Button, Caption, Card, Chips, Disclosure, Empty, Hero, HeroStat, HeroStats, IconBubble, Meta, Page,
  SearchField, SectionHeader, Segmented, TimelineSlot,
} from '../../ui/kit.tsx';
import { theme as t, type Tone } from '../../ui/theme.ts';
import { BoothMap } from './BoothMap.tsx';
import { flowDestination, gateDestination, guideFlowDestination, type StallFlow } from './flow.ts';
import {
  dayLabel, festivalGuide, flowKindLabel, groupRows, inArea, noticesForDay, shortDate, stallAreas, stallNumber, stallPerks,
  timetableSlots, won, zonesForDay, type NormalizedGuide,
} from './guide.ts';

const FLOW_LABEL: Record<StallFlow, string> = { enter: '입장 동선', queue: '대기 동선', exit: '퇴장 동선' };
const VIEWS = ['타임테이블', '입장·동선', '부스 찾기', '이용 안내'] as const;
const CATEGORIES = ['전체', '주점', '부스', '공연', '편의'] as const;
const NOTICE_TONE: Record<string, { tone: Tone; icon: string }> = { traffic: { tone: 'amber', icon: '🚌' }, alert: { tone: 'red', icon: '⚠️' }, info: { tone: 'blue', icon: 'ℹ️' } };
const GROUP_TONE: Record<string, Tone> = { 아티스트: 'blue', 동아리: 'green', 기획단: 'navy', 응원제: 'red' };
const CATEGORY_TONE: Record<StallCategory, Tone> = { 주점: 'amber', 부스: 'blue', 공연: 'red', 편의: 'green' };
const FLOW_TONE: Record<FestivalFlowGuide['kind'], Tone> = { queue: 'amber', enter: 'blue', exit: 'neutral', evacuation: 'red' };
const SWATCH: Record<string, string> = { 주황: '#F28C28', 노랑: '#E8B90C', 보라: '#9B5DE5', 파랑: t.color.primary, 초록: t.color.start, 빨강: t.color.end };
const ITEM_GLYPH: Record<string, string> = { 카메라: '📷', 유리병: '🍾', 셀카봉: '🤳', '밀폐되지 않은 음료': '🥤', 우산: '☂️', '날카로운 물품': '🔪', '가연성·폭발성 물질': '💥', 주류: '🍶' };

export type FestivalView = (typeof VIEWS)[number];
/** `initialView`/`initialDayId` open a given section (deep links, tests); the user can switch freely afterwards. */
export function FestivalScreen({ data, active = true, sourceMode = 'demo', sourceNotice = null, onReload, initialView = '타임테이블', initialDayId }: { data: ContentData; active?: boolean; initialView?: FestivalView; initialDayId?: string } & SourceProps) {
  const { dispatch } = useAppActions();
  const demo = sourceMode === 'demo';
  const festival = data.festivals[0];
  const guide = useMemo(() => festivalGuide(festival), [festival]);
  const days = data.days.filter((d) => d.festivalId === festival?.id).sort((a, b) => a.dayDate.localeCompare(b.dayDate) || a.sortOrder - b.sortOrder);
  const [dayId, setDayId] = useState(initialDayId ?? days[0]?.id ?? '');
  const [view, setView] = useState<FestivalView>(initialView);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('전체');
  const [area, setArea] = useState('전체');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const currentDay = days.find((d) => d.id === dayId) ?? days[0];
  const areas = stallAreas(data, currentDay?.id);
  const currentArea = areas.includes(area) ? area : '전체';
  const stalls = selectStalls(data, currentDay?.id, category, query).filter((row) => inArea(row, currentArea));
  const dayStalls = data.stalls.filter((row) => row.dayId === currentDay?.id);
  const performances = data.performances.filter((row) => row.dayId === currentDay?.id);
  const selected = data.stalls.find((row) => row.id === selectedId);
  useScreenBack(active && selectedId !== null, useCallback(() => setSelectedId(null), []));
  const firstShow = timetableSlots(performances)[0]?.startsAt;
  const hours = currentDay?.opensAt ? `${currentDay.opensAt}–${currentDay.closesAt ?? ''}` : guide.wristband?.hours?.replace(/\s/g, '') ?? null;
  const pickDay = (id: string) => { setDayId(id); setSelectedId(null); setArea('전체'); };

  return <Page resetKey={`${active}:${selectedId}:${view}`} eyebrow="FESTIVAL" title="축제" subtitle={festival ? `${shortDate(festival.startsOn)} – ${shortDate(festival.endsOn)} · 한양대학교 서울캠퍼스` : '공개된 축제가 없습니다.'}>
    <SourceNotice sourceMode={sourceMode} sourceNotice={sourceNotice} onReload={onReload} demoText={CONTENT_NOTICE} />
    {!festival ? <Empty message="공개된 축제 정보가 없습니다." /> : selected ? <StallDetail stall={selected} demo={demo} onBack={() => setSelectedId(null)} onFlow={(flow) => dispatch({ type: 'navigate', destination: flowDestination(selected, flow, demo) })} /> : <>
      <Hero eyebrow={currentDay ? dayLabel(currentDay, days.indexOf(currentDay)) : null} title={festival.name} subtitle={festival.summary}>
        <HeroStats>
          <HeroStat value={firstShow ? `${firstShow}~` : '공지 전'} label="메인 무대 시작" />
          <HeroStat value={`${dayStalls.length}곳`} label="부스·주점·편의" />
          <HeroStat value={hours ?? '공지 전'} label={currentDay?.opensAt ? '운영 시간' : '팔찌·굿즈 운영'} />
        </HeroStats>
      </Hero>
      {days.length > 1 && <Segmented label="축제 일차" values={days.map((d) => d.id)} value={currentDay?.id ?? ''} onChange={pickDay} labels={Object.fromEntries(days.map((d, i) => [d.id, dayLabel(d, i)]))} />}
      {noticesForDay(guide, currentDay?.id).map((notice) => <Banner key={notice.id} tone={NOTICE_TONE[notice.tone ?? 'info']?.tone ?? 'blue'} icon={NOTICE_TONE[notice.tone ?? 'info']?.icon ?? 'ℹ️'} title={notice.title} body={notice.body ?? null} />)}
      <Segmented label="축제 안내 보기" values={VIEWS} value={view} onChange={setView} labels={{ 타임테이블: '타임테이블', '입장·동선': '입장·동선', '부스 찾기': '부스', '이용 안내': '이용안내' }} />
      {view === '타임테이블' && <Timetable performances={performances} guide={guide} demo={demo} />}
      {view === '입장·동선' && <EntryAndFlows guide={guide} dayId={currentDay?.id} demo={demo} onNavigate={(destination) => dispatch({ type: 'navigate', destination })} />}
      {view === '부스 찾기' && <>
        <Chips values={CATEGORIES} value={category} onChange={setCategory} />
        {areas.length > 1 && <Chips values={['전체', ...areas]} value={currentArea} onChange={setArea} />}
        <SearchField label="축제 부스 검색" placeholder="부스·주점 이름, 구역 검색" value={query} onChangeText={setQuery} />
        <SectionHeader title={currentArea === '전체' ? '배치도와 목록' : `${currentArea} 배치`} caption="지도 번호와 목록 번호가 같습니다." trailing={<Badge label={`${stalls.length}곳`} tone="navy" />} />
        <BoothMap stalls={stalls} onSelect={(row) => setSelectedId(row.id)} />
        {stalls.length === 0 && <Empty message="조건에 맞는 부스가 없습니다. 날짜·분류·구역·검색어를 바꿔 주세요." />}
        {stalls.map((row) => <StallRow key={row.id} stall={row} onOpen={() => setSelectedId(row.id)} />)}
        {(category === '전체' || category === '부스') && guide.sponsors.length > 0 && <>
          <SectionHeader title="스폰서·샘플링" caption="참여 조건을 확인해 주세요." />
          {guide.sponsors.map((sponsor) => <Card key={sponsor.id} tint={t.glass.tint}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><Badge label="스폰서" tone="blue" solid /><Badge label={sponsor.locationLabel ?? '위치 공지 전'} tone="neutral" /></View>
            <Text style={st.cardTitle}>{sponsor.name} · {sponsor.title}</Text>
            {sponsor.condition && <Banner tone="green" icon="🎁" title="참여 조건" body={sponsor.condition} />}
            {sponsor.items?.map((item, index) => <View key={item.name} style={st.perk}><IconBubble glyph={String(index + 1)} tone="blue" size={30} /><View style={{ flex: 1 }}><Body strong>{item.name}</Body>{item.description && <Caption>{item.description}</Caption>}</View></View>)}
          </Card>)}
        </>}
        {category === '전체' && guide.unplacedBooths.length > 0 && <>
          <SectionHeader title="배치 위치 공지 전 부스" caption="운영일·위치가 공지되면 지도에 표시됩니다." />
          {guide.unplacedBooths.map((booth) => <Card key={booth.name}><Text style={st.cardTitle}>{booth.name}</Text>{booth.description && <Body>{booth.description}</Body>}</Card>)}
        </>}
      </>}
      {view === '이용 안내' && <Services guide={guide} stalls={dayStalls} onOpen={(row) => setSelectedId(row.id)} />}
    </>}
  </Page>;
}

function Timetable({ performances, guide, demo }: { performances: FestivalPerformance[]; guide: NormalizedGuide; demo: boolean }) {
  const slots = timetableSlots(performances);
  const stage = performances.find((row) => row.stageLabel)?.stageLabel ?? null;
  return <>
    <SectionHeader title="메인 무대 타임테이블" caption={stage} trailing={slots.length > 0 ? <Badge label={`${performances.length}팀`} tone="blue" /> : null} />
    {slots.length === 0 && <Empty message="이 날짜의 공연 정보가 아직 공개되지 않았습니다." />}
    {slots.map((slot, index) => <TimelineSlot key={slot.startsAt} time={slot.startsAt} caption="부터" last={index === slots.length - 1}>
      {groupRows(slot.rows).map((block) => <Card key={block.rows[0]!.id} style={st.slotCard}>
        {block.group && <Badge label={block.group} tone={GROUP_TONE[block.group] ?? 'neutral'} solid={block.group === '아티스트'} />}
        {block.rows[0]!.description && <Caption>{block.rows[0]!.description}</Caption>}
        <View style={st.lineup}>{block.rows.map((row) => <Text key={row.id} style={block.group === '아티스트' ? st.artist : st.act}>{row.artist}{row.endsAt ? ` · ~${row.endsAt}` : ''}</Text>)}</View>
      </Card>)}
    </TimelineSlot>)}
    {guide.timetableNote && <Caption>※ {guide.timetableNote}</Caption>}
    {performances[0] && <Card><Body strong>{stage ?? '메인 무대'}까지 안내받기</Body><DestinationActions destination={stageDestination(performances[0], demo)} /></Card>}
  </>;
}

function EntryAndFlows({ guide, dayId, demo, onNavigate }: { guide: NormalizedGuide; dayId: string | undefined; demo: boolean; onNavigate: (destination: ReturnType<typeof gateDestination>) => void }) {
  const zones = zonesForDay(guide, dayId);
  const byKind = (kinds: FestivalFlowGuide['kind'][]) => guide.flows.filter((flow) => kinds.includes(flow.kind));
  const nothing = zones.length === 0 && guide.gates.length === 0 && guide.flows.length === 0;
  return <>
    {nothing && <Empty message="입장 구역과 동선 안내가 아직 공개되지 않았습니다." />}
    {zones.length > 0 && <>
      <SectionHeader title="관람 구역" caption="구역마다 들어가는 게이트가 다릅니다." />
      <View style={st.zoneGrid}>{zones.map((zone, index) => <Card key={zone.id} style={st.zoneCard} {...(index === 0 ? { tint: t.glass.tint } : {})}>
        <Text style={st.zoneName}>{zone.name}</Text>
        <View style={st.wrap}>{zone.gates?.map((gate) => <Badge key={gate} label={gate} tone={index === 0 ? 'blue' : 'navy'} />)}</View>
        {zone.note && <Caption>{zone.note}</Caption>}
      </Card>)}</View>
    </>}
    {guide.gates.length > 0 && <>
      <SectionHeader title="게이트 찾아가기" caption="게이트 옆 건물로 길찾기가 열립니다." />
      <Card>{guide.gates.map((gate, index) => <View key={gate.id} style={[st.gateRow, index > 0 && st.rowDivider]}>
        <IconBubble glyph={gate.label.replace(/^GATE\s*/i, '')} tone={gate.zone === guide.zones[0]?.name ? 'blue' : 'navy'} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}><Body strong>{gate.zone ? `${gate.zone} · ` : ''}{gate.label}</Body>{gate.nearBy && <Caption>{gate.nearBy} 쪽</Caption>}</View>
        <Button compact secondary title={`${gate.label} 길찾기`} onPress={() => onNavigate(gateDestination(gate, demo))} />
      </View>)}</Card>
    </>}
    {byKind(['queue', 'enter', 'exit']).length > 0 && <>
      <SectionHeader title="대기·입퇴장 동선" caption="색은 공식 안내도의 선 색입니다. 실제 줄 모양은 현장 안내를 따라 주세요." />
      {byKind(['queue', 'enter', 'exit']).map((flow) => <FlowCard key={flow.id} flow={flow} onPress={() => onNavigate(guideFlowDestination(flow, demo))} />)}
    </>}
    {byKind(['evacuation']).length > 0 && <>
      <SectionHeader title="비상 대피" />
      {byKind(['evacuation']).map((flow) => <FlowCard key={flow.id} flow={flow} onPress={() => onNavigate(guideFlowDestination(flow, demo))} />)}
    </>}
  </>;
}

function FlowCard({ flow, onPress }: { flow: FestivalFlowGuide; onPress: () => void }) {
  const swatch = flow.colorName ? SWATCH[flow.colorName] : undefined;
  return <Card>
    <View style={st.flowHead}>
      <View style={[st.swatch, { backgroundColor: swatch ?? t.tone[FLOW_TONE[flow.kind]].fg }]} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={st.wrap}><Badge label={flowKindLabel(flow.kind)} tone={FLOW_TONE[flow.kind]} />{flow.colorName && <Badge label={`${flow.colorName} 선`} tone="neutral" />}</View>
        <Body strong>{flow.title}</Body>
      </View>
    </View>
    {flow.description && <Body>{flow.description}</Body>}
    <Button compact secondary title={`${flowKindLabel(flow.kind)} 지도에서 보기`} onPress={onPress} />
  </Card>;
}

function StallRow({ stall, onOpen }: { stall: FestivalStall; onOpen: () => void }) {
  const number = stallNumber(stall);
  return <Card style={st.stallCard}>
    <View style={st.stallHead}>
      <View style={[st.number, { backgroundColor: t.tone[CATEGORY_TONE[stall.category]].bg }]}><Text style={[st.numberText, { color: t.tone[CATEGORY_TONE[stall.category]].fg }]}>{number ?? '·'}</Text></View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={st.cardTitle}>{stall.name}</Text>
        <View style={st.wrap}><Badge label={stall.category} tone={CATEGORY_TONE[stall.category]} />{stall.kind && stall.kind !== stall.category && <Badge label={stall.kind} tone="neutral" />}{stall.areaLabel && <Badge label={stall.areaLabel} tone="navy" />}{stall.opensAt && <Badge label={`${stall.opensAt}–${stall.closesAt ?? ''}`} tone="green" />}</View>
      </View>
    </View>
    {stall.description && <Text numberOfLines={2} style={st.desc}>{stall.description}</Text>}
    <Button compact secondary title="부스 상세 보기" onPress={onOpen} />
  </Card>;
}

function StallDetail({ stall, demo, onBack, onFlow }: { stall: FestivalStall; demo: boolean; onBack: () => void; onFlow: (flow: StallFlow) => void }) {
  const number = stallNumber(stall);
  const perks = stallPerks(stall);
  return <>
    <Button tone="ghost" title="← 부스 목록으로" onPress={onBack} />
    <Hero eyebrow={[stall.areaLabel, number ? `${stall.category} ${number}번` : stall.category].filter(Boolean).join(' · ')} title={stall.name} subtitle={stall.kind ?? null}>
      <HeroStats>
        <HeroStat value={stall.opensAt ? `${stall.opensAt}–${stall.closesAt ?? ''}` : '공지 전'} label="운영 시간" />
        <HeroStat value={stall.areaLabel ?? stall.buildingCode ?? '위치 공지 전'} label="구역" />
      </HeroStats>
    </Hero>
    <Card>
      {stall.description ? <Body>{stall.description}</Body> : <Body>부스 소개가 아직 공개되지 않았습니다.</Body>}
      {stall.condition && <Banner tone="green" icon="🎁" title="참여 조건" body={stall.condition} />}
      {perks.length > 0 && <><Body strong>받을 수 있는 것</Body><Bullets items={perks} /></>}
      {stall.queueNote && <Banner tone="amber" icon="⏳" title="대기 안내" body={stall.queueNote} />}
      <DestinationActions destination={stallDestination(stall, demo)} />
    </Card>
    <Card><Text style={st.cardTitle}>동선 안내</Text><Caption>입장=파랑 · 대기=주황 · 퇴장=회색으로 지도에 표시합니다.</Caption>
      {(['enter', 'queue', 'exit'] as const).map((flow) => <Button key={flow} compact secondary title={FLOW_LABEL[flow]} onPress={() => onFlow(flow)} />)}
    </Card>
    <BoothMap stalls={[stall]} onSelect={() => undefined} />
  </>;
}

function Services({ guide, stalls, onOpen }: { guide: NormalizedGuide; stalls: FestivalStall[]; onOpen: (stall: FestivalStall) => void }) {
  const wristbandBooth = stalls.find((row) => row.kind?.includes('팔찌'));
  const goodsBooth = stalls.find((row) => row.kind?.includes('굿즈'));
  const band = guide.wristband;
  const evacuation = guide.flows.filter((flow) => flow.kind === 'evacuation').map((flow) => `${flow.title}: ${flow.description ?? ''}`.trim());
  const pending = '아직 공지되지 않았습니다. 학교·축제기획단 공식 안내를 확인해 주세요.';
  return <>
    <SectionHeader title="팔찌 수령" caption="무대 입장 전에 받아 두세요." />
    {band ? <Card tint={t.glass.tint}>
      <View style={st.wrap}>{band.audience && <Badge label={band.audience} tone="blue" solid />}{band.magicPass && <Badge label={`매직패스 · ${band.magicPass}`} tone="green" />}</View>
      {band.locationLabel && <Meta label="수령 위치" value={band.locationLabel} />}
      {band.hours && <Meta label="운영 시간" value={band.hours} />}
      {band.steps && band.steps.length > 0 && <Bullets items={band.steps} />}
      {band.cautions && band.cautions.length > 0 && <Banner tone="red" icon="⚠️" title="부정 수령 주의" body={band.cautions.join('\n')} />}
      {wristbandBooth && <Button compact title="팔찌 부스 위치 보기" onPress={() => onOpen(wristbandBooth)} />}
    </Card> : <Empty message={`팔찌 수령 안내가 ${pending}`} />}

    <SectionHeader title="굿즈 현장 판매" trailing={guide.goods.length > 0 ? <Badge label={`${guide.goods.length}종`} tone="navy" /> : null} />
    {guide.goods.length === 0 && <Empty message={`굿즈 판매 안내가 ${pending}`} />}
    {guide.goods.map((item) => <Card key={item.id}>
      <View style={st.goodsHead}>
        <View style={{ flex: 1, minWidth: 0 }}><Text style={st.cardTitle}>{item.name}</Text>{item.subtitle && <Caption>{item.subtitle}</Caption>}</View>
        {won(item.price) && <Text style={st.price}>{won(item.price)}</Text>}
      </View>
      {item.sizes && item.sizes.length > 0 && <View style={st.wrap}>{item.sizes.map((size) => <View key={size} style={st.size}><Text style={st.sizeText}>{size}</Text></View>)}</View>}
      {item.boothLabel && <Meta label="판매 부스" value={item.boothLabel} />}
      {item.hours && <Meta label="운영 시간" value={item.hours} />}
      {goodsBooth && <Button compact secondary title="굿즈 부스 위치 보기" onPress={() => onOpen(goodsBooth)} />}
    </Card>)}
    {guide.goodsNotes.length > 0 && <Disclosure title="결제·환불 유의사항" glyph="💳" tone="amber"><Bullets items={guide.goodsNotes} /></Disclosure>}

    <SectionHeader title="노천극장 이용 안내" caption="눌러서 펼쳐 보세요." />
    <Disclosure title="반입 금지 물품" caption={guide.prohibitedItems.length ? `${guide.prohibitedItems.length}종 · 입장 전 확인` : null} glyph="⛔" tone="red" defaultOpen={guide.prohibitedItems.length > 0}>
      {guide.prohibitedItems.length === 0 ? <Body>{pending}</Body> : <View style={st.itemGrid}>{guide.prohibitedItems.map((item) => <View key={item} style={st.itemCell}>
        <View style={st.itemIcon}><Text style={st.itemGlyph}>{ITEM_GLYPH[item] ?? '⛔'}</Text><View style={st.itemSlash} /></View>
        <Text style={st.itemLabel}>{item}</Text>
      </View>)}</View>}
    </Disclosure>
    {guide.stageRules.length > 0 && <Disclosure title="노천극장 유의사항" glyph="🎟️" tone="blue"><Bullets items={guide.stageRules} /></Disclosure>}
    <Disclosure title="안전사고·비상 대피 요령" caption={evacuation.length ? '비상구 위치 포함' : guide.safety.length ? null : '아직 공지되지 않았습니다'} glyph="🚨" tone="red">
      {guide.safety.length + evacuation.length === 0 ? <Body>{pending}</Body> : <Bullets items={[...evacuation, ...guide.safety]} />}
    </Disclosure>
    <Disclosure title="분실물·미수령 안내" caption={guide.afterCare.length ? `${guide.afterCare.length}건` : '아직 공지되지 않았습니다'} glyph="🧳" tone="neutral">
      {guide.afterCare.length === 0 ? <Body>{pending}</Body> : <Bullets items={guide.afterCare} />}
    </Disclosure>
  </>;
}

const st = StyleSheet.create({
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: '800', color: t.color.text, letterSpacing: -0.2 },
  desc: { fontSize: 13, lineHeight: 19, color: t.color.muted },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  perk: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  slotCard: { padding: 14, gap: 8 },
  lineup: { gap: 4 },
  act: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: t.color.text },
  artist: { fontSize: 18, lineHeight: 25, fontWeight: '800', color: t.color.text, letterSpacing: -0.3 },
  zoneGrid: { flexDirection: 'row', gap: 10 },
  zoneCard: { flex: 1, minWidth: 0, padding: 14, gap: 8 },
  zoneName: { fontSize: 18, lineHeight: 24, fontWeight: '800', color: t.color.text },
  gateRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  rowDivider: { borderTopWidth: 1, borderColor: t.color.divider, paddingTop: 10 },
  flowHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  swatch: { width: 6, alignSelf: 'stretch', borderRadius: 3, minHeight: 40 },
  stallCard: { padding: 14, gap: 8 },
  stallHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  number: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  numberText: { fontSize: 16, fontWeight: '800' },
  goodsHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  price: { fontSize: 20, lineHeight: 26, fontWeight: '800', color: t.color.primary },
  size: { minWidth: 44, minHeight: 32, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: t.color.border, backgroundColor: 'rgba(255, 255, 255, 0.8)', alignItems: 'center', justifyContent: 'center' },
  sizeText: { fontSize: 13, fontWeight: '700', color: t.color.text },
  itemGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  itemCell: { width: '25%', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  itemIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: t.color.text, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  itemGlyph: { fontSize: 24 },
  itemSlash: { position: 'absolute', width: 60, height: 3, backgroundColor: t.color.end, transform: [{ rotate: '-45deg' }] },
  itemLabel: { fontSize: 12, lineHeight: 16, color: t.color.text, fontWeight: '600', textAlign: 'center' },
});
