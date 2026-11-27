import type { ContentData, ContentSource, EssaySession, Festival, FestivalPerformance, FestivalStall } from './types.ts';
export const ESSAY_NOTICE = '서버에 연결하지 못해 예시 정보를 표시하고 있습니다. 실제 일정·고사장·준비물은 학교 공식 공지를 확인해 주세요.';
export const CONTENT_NOTICE = '서버에 연결하지 못해 예시 정보를 표시하고 있습니다. 실제 일정은 학교 공식 공지를 확인해 주세요.';
const essay = (id: string, examDate: string, trackLabel: string, startsAt: string, endsAt: string, checkInBy: string, roomLabel: string): EssaySession => ({
  id, seasonLabel: '2027학년도', trackLabel, examDate, startsAt, endsAt, checkInBy,
  buildingCode: '가상 시험관', roomLabel, destinationNodeId: null, checkInNodeId: null,
  items: ['수험표(예시)', '신분증(예시)', '검정 필기구(예시)'],
  notices: ['아래는 화면 시연용 준비물·유의사항입니다. 실제 지참물과 반입 제한은 공식 공지로 확인해 주세요.', '혼잡을 고려해 여유 있게 도착해 주세요.'], isPublished: true, sortOrder: 0,
});
const stall = (id: string, dayId: string, name: string, category: FestivalStall['category'], extra: Partial<FestivalStall> = {}): FestivalStall => ({
  id, dayId, name, category, buildingCode: null, nodeId: null, entranceNodeId: null, exitNodeId: null,
  opensAt: null, closesAt: null, queueNote: null,
  description: null, isPublished: true, sortOrder: 0, ...extra,
});
const act = (id: string, startsAt: string, artist: string, group: string, description: string | null, sortOrder: number): FestivalPerformance => ({
  id: `orum-day-2-${id}`, dayId: 'orum-day-2', startsAt, endsAt: null, artist, stageLabel: '메인 무대(노천극장)', nodeId: null, description, isPublished: true, sortOrder, group,
});
/** 한마당 부스 배치표 DAY 2 legend and the 학내단체 부스 콘텐츠 table (description only where the table has one). */
const HANMADANG_BOOTHS: readonly [number, string, string | null][] = [
  [4, '지구 멸망까지 3분 – 미니 방탈출', '3분 안에 지속가능한 의생활과 관련된 단서를 찾아 지구를 구하세요!'],
  [5, '환승타코 ♡ SAY·U', '타코야끼로 떠나는 세계여행. 나라별 개성을 담은 특별한 속재료를 골라 다채로운 맛을 한 번에 즐겨 보세요!'],
  [6, '하암냥 잠퍼자기 부스', '하암냥 잠퍼자기 대회 — 가장 빠르게 심박수를 떨어뜨리는 당신이 잠퍼자기 챔피언.'],
  [7, '사자가 메이플 할 때', null],
  [8, '자취:ON', "창업동아리 HY-light의 서비스 '자취:ON' 소개와 밥친구 매칭, 타임어택 분리배출, 자취 시뮬레이터 체험을 하는 부스입니다!"],
  [9, 'Love in Dots', null],
  [11, '한양대 핫한 스타트업', '한양대 전통의 창업동아리 출신 3인의 스타트업의 초기 유저가 되어 보세요!'],
  [12, '대학혁신지원사업 학생모니터링단', '모니터링단의 퀴즈 타겟 던지기부터 나만의 꿀교양 추천과 경품 뽑기까지! 즐기고, 추천하고, 선물도 받아 가는 체험형 부스입니다!'],
  [13, '글로벌 사랑한대', '글로벌 소개팅부터 언어별 플러팅까지! 반짝이는 비즈 스티커와 이국적인 디저트도 받아 가세요!'],
  [14, '한양국제인간도미서전', '국어교육과 소설학회 학우들이 제작한 소설집을 판매하는 부스입니다!'],
];
/** 한마당 주점 DAY 2 table. */
const HANMADANG_PUBS: readonly [number, string][] = [
  [1, 'TIME'], [2, 'Magic-i'], [3, '애국한양풍물패연합'], [4, '불교학생회'], [5, '15ers'], [6, '하나클랑'],
  [7, '그리아미'], [8, '한토막'], [9, '20학번이즈백'], [10, 'HVC 주점'], [11, '시끄러운 밤'],
];
const ORUM_FESTIVAL: Festival = {
  id: 'orum-2026', name: '2026 애국한양응원제 : 오름', startsOn: '2026-10-01', endsOn: '2026-10-02', isPublished: true,
  summary: '한양대학교 서울캠퍼스 노천극장 메인 무대와 한마당 부스·주점에서 열린 축제입니다. 아래는 축제기획단 공식 안내를 옮긴 예시입니다.',
  guide: {
    notices: [{ id: 'bus-03-2', tone: 'traffic', title: '17시 이후 성동 03-2번 버스 회차 지점 변경',
      body: '축제 기간(10월 1일~2일) 매일 17시 이후에는 주점 운영에 따른 인파와 안전 문제로 한양대학교 응급의료센터 부근에서 회차하며 교내로 진입하지 않습니다. 논술고사 때와 같은 조치입니다.',
      dayIds: ['orum-day-1', 'orum-day-2'] }],
    zones: [
      { id: 'hanyang', name: '한양존', gates: ['GATE A', 'GATE B'], note: '무대 앞 스탠딩석도 한양존입니다.' },
      { id: 'friends', name: '프렌즈존', gates: ['GATE C'], note: '10/1(목)~10/2(금) 한양존과 프렌즈존 모두 운영합니다.' },
    ],
    gates: [
      { id: 'gate-a', label: 'GATE A', zone: '한양존', nearBy: '정몽구미래자동차연구센터' },
      { id: 'gate-b', label: 'GATE B', zone: '한양존', nearBy: '정몽구미래자동차연구센터' },
      { id: 'gate-c', label: 'GATE C', zone: '프렌즈존', nearBy: '역사관' },
    ],
    flows: [
      { id: 'queue-orange', kind: 'queue', colorName: '주황', title: '백남학술정보관·제1공학관 쪽 대기열', description: '사회과학관 쪽에서 백남학술정보관 뒤편을 돌아 제1공학관 옆을 따라 한양존 GATE B로 이어집니다.', placeLabel: '백남학술정보관' },
      { id: 'queue-yellow', kind: 'queue', colorName: '노랑', title: '역사관 쪽 대기열', description: '역사관 앞을 따라 한양존 GATE A와 프렌즈존 GATE C로 이어집니다.', placeLabel: '역사관' },
      { id: 'queue-purple', kind: 'queue', colorName: '보라', title: '신소재공학관·박물관 쪽 대기열', description: '공업센터 쪽에서 신소재공학관과 박물관을 따라 프렌즈존 GATE C로 이어집니다.', placeLabel: '신소재공학관' },
      { id: 'evacuation', kind: 'evacuation', title: '비상구', description: '한양존 오른쪽과 프렌즈존 GATE C 옆에 비상구가 있습니다.', placeLabel: '노천극장' },
    ],
    timetableNote: '당일 현장 상황에 따라 일부 일정이 변동될 수 있습니다.',
    wristband: { audience: '한양존과 프렌즈존 입장 관객 모두', locationLabel: '국제관 옆 팔찌 부스(2곳)', hours: '10:00 ~ 20:00', steps: ['국제관 옆 대기 동선을 따라 줄을 섭니다.', '팔찌를 받은 뒤 퇴장 동선으로 나갑니다.'] },
    goods: [{ id: 'soccer-uniform', name: '축구 유니폼', subtitle: 'Soccer Uniform', price: 38000, sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'], boothLabel: '국제관 옆 굿즈 부스', hours: '10:00 ~ 20:00' }],
    sponsors: [{ id: 'tanghwa', name: '탕화쿵푸', title: '신제품 3종 무료 샘플링', condition: '탕화쿵푸 공식 인스타그램·유튜브·X(트위터) 중 한 채널만 팔로우하면 무료로 제공합니다.', items: [
      { name: '토마토 마라탕', description: '상큼한 토마토의 진한 풍미와 깊은 감칠맛' },
      { name: '사천훠궈마라탕', description: '얼얼하고 화끈한 오리지널 사천 훠궈의 깊은 맛' },
      { name: '마라 비빔', description: '새콤·달콤·매콤·고소, 4가지 소스의 꾸덕한 마라비빔' },
    ] }],
    unplacedBooths: [{ name: '용기한걸음메아리', description: '마약의 위험성에 대해 알아보고 퀴즈를 맞히면 간식과 즉석 마약 검사 키트를 드립니다!' }],
    prohibitedItems: ['카메라', '유리병', '셀카봉', '밀폐되지 않은 음료', '우산', '날카로운 물품', '가연성·폭발성 물질', '주류'],
  },
};
export const DEMO_CONTENT: ContentData = {
  essays: [
    essay('demo-exam-1', '2026-11-28', '가상 인문계열 오전', '09:00', '10:30', '08:30', '가상 301호'),
    essay('demo-exam-2', '2026-11-28', '가상 자연계열 오후', '14:00', '15:30', '13:30', '가상 402호'),
    essay('demo-exam-3', '2026-11-29', '가상 상경계열 오전', '10:00', '11:30', '09:30', '가상 201호'),
    essay('demo-exam-4', '2026-11-29', '가상 자연계열 오후', '15:00', '16:30', '14:30', '가상 501호'),
  ],
  // Festival example: only what the official 2026 애국한양응원제 '오름' notices (hyu_festival) show. No map node ids,
  // queue times or extra booths are invented; sections the notices did not cover stay empty in the app.
  festivals: [ORUM_FESTIVAL],
  days: [
    { id: 'orum-day-1', festivalId: 'orum-2026', dayDate: '2026-10-01', opensAt: null, closesAt: null, sortOrder: 0, label: 'DAY 1' },
    { id: 'orum-day-2', festivalId: 'orum-2026', dayDate: '2026-10-02', opensAt: null, closesAt: null, sortOrder: 1, label: 'DAY 2' },
  ],
  stalls: [
    ...HANMADANG_BOOTHS.map(([mapNumber, name, description], index) => stall(`orum-booth-${mapNumber}`, 'orum-day-2', name, '부스', {
      kind: '학내단체 부스', areaLabel: '한마당', buildingCode: '한마당', mapNumber, description, sortOrder: 100 + index,
    })),
    ...HANMADANG_PUBS.map(([mapNumber, name], index) => stall(`orum-pub-${mapNumber}`, 'orum-day-2', name, '주점', {
      kind: '주점', areaLabel: '한마당', buildingCode: '한마당', mapNumber, sortOrder: 200 + index,
    })),
    ...['orum-day-1', 'orum-day-2'].flatMap((dayId, day) => [
      stall(`orum-wristband-${day + 1}`, dayId, '팔찌 부스', '편의', { kind: '팔찌 수령', areaLabel: '국제관 옆', buildingCode: '국제관', opensAt: '10:00', closesAt: '20:00',
        description: '한양존과 프렌즈존 입장 관객 모두 팔찌를 받을 수 있습니다. 대기 동선을 따라 줄을 선 뒤 퇴장 동선으로 나갑니다.', sortOrder: 10 }),
      stall(`orum-goods-${day + 1}`, dayId, '굿즈 부스', '편의', { kind: '굿즈 판매', areaLabel: '국제관 옆', buildingCode: '국제관', opensAt: '10:00', closesAt: '20:00',
        description: '축제 굿즈 현장 판매 부스입니다.', sortOrder: 11 }),
    ]),
  ],
  performances: [
    ...['한울림', '쇼다운', '락더보헤미안', '알스아망디'].map((artist, index) => act(`club-${index}`, '15:10', artist, '동아리', '총동아리연합회·단과대학 동아리 공연', index)),
    act('planner', '15:10', '블라인드 소개팅', '기획단', '축제기획단 컨텐츠', 10),
    act('cheer', '15:10', '루터스', '응원제', '애국한양응원제', 11),
    ...['데이먼스 이어', '창모', '다영', 'HIGHLIGHT', 'fromis_9'].map((artist, index) => act(`artist-${index}`, '20:00', artist, '아티스트', null, 20 + index)),
  ],
  events: [
    { id: 'demo-event-1', title: '가상 입학설명회', category: '입학', startsAt: '2026-11-25T14:00:00+09:00', endsAt: '2026-11-25T16:00:00+09:00', placeLabel: '가상 설명회관 대강당', buildingCode: null, nodeId: null, host: '가상 입학 안내팀', summary: '진학 안내 화면을 시연하는 가상 설명회입니다. 실제 모집 일정이 아닙니다.', linkUrl: null, isPublished: true, allDay: false, pinned: true },
    { id: 'demo-event-2', title: '가상 캠퍼스 길찾기 특강', category: '강연', startsAt: '2026-11-26T16:00:00+09:00', endsAt: '2026-11-26T17:30:00+09:00', placeLabel: '가상 강연관 201호', buildingCode: null, nodeId: null, host: '가상 학술팀', summary: '보행 내비게이션을 주제로 한 화면 시연용 특강입니다.', linkUrl: null, isPublished: true, allDay: false, pinned: false },
    { id: 'demo-event-3', title: '가상 동아리 교류 행사', category: '행사', startsAt: '2026-11-27T12:00:00+09:00', endsAt: '2026-11-27T18:00:00+09:00', placeLabel: '가상 행사 광장', buildingCode: null, nodeId: null, host: '가상 동아리 연합', summary: '다양한 부스를 둘러보는 가상 교내 행사입니다.', linkUrl: null, isPublished: true, allDay: false, pinned: false },
    { id: 'demo-event-4', title: '가상 학교생활 설명회', category: '설명회', startsAt: '2026-11-28T11:00:00+09:00', endsAt: null, placeLabel: '가상 학생회관', buildingCode: null, nodeId: null, host: '가상 학생 지원팀', summary: '실제 개최되지 않는 화면 시연용 설명회입니다.', linkUrl: null, isPublished: true, allDay: false, pinned: false },
    { id: 'demo-event-5', title: '가상 행사 운영 안내', category: '공지', startsAt: '2026-11-21T09:00:00+09:00', endsAt: null, allDay: true, placeLabel: '가상 안내소', buildingCode: null, nodeId: null, host: '가상 운영팀', summary: '화면 시연용 고정 공지입니다. 실제 통행 제한이나 행사 공지가 아닙니다.', linkUrl: null, isPublished: true, pinned: true },
    { id: 'demo-event-6', title: '가상 접근성 안내 특강', category: '강연', startsAt: '2026-11-30T15:00:00+09:00', endsAt: '2026-11-30T16:00:00+09:00', allDay: false, placeLabel: '가상 강연관 101호', buildingCode: null, nodeId: null, host: '가상 접근성팀', summary: '화면 시연용 추가 특강입니다.', linkUrl: null, isPublished: true, pinned: false },
    { id: 'demo-event-7', title: '가상 일정 확인 공지', category: '공지', startsAt: '2026-11-29T09:00:00+09:00', endsAt: null, allDay: true, placeLabel: null, buildingCode: null, nodeId: null, host: '가상 운영팀', summary: '실제 일정은 학교 공식 공지를 확인해 주세요. 이 항목은 가상 공지입니다.', linkUrl: null, isPublished: true, pinned: false },
  ],
};
export const DEMO_SOURCE: ContentSource = { mode: 'demo', load: async () => DEMO_CONTENT };
