import type { ContentData, ContentSource, EssaySession, FestivalStall } from './types.ts';
export const ESSAY_NOTICE = '2027학년도 논술고사(2026년 11월 28~29일)를 소재로 만든 차기 시즌 프로토타입·시연용 화면입니다. 날짜를 포함한 실제 일정·배정 고사장·입실 마감·준비물은 반드시 학교 공식 공지를 확인해 주세요. 아래 시간·건물·호실은 가상 정보이며 수험 안내로 사용하면 안 됩니다.';
export const CONTENT_NOTICE = '시연용 가상 데이터입니다. 실제 행사·출연진·운영 시간·대기 정보가 아닙니다. 서버 연동은 준비 중입니다.';
const essay = (id: string, examDate: string, trackLabel: string, startsAt: string, endsAt: string, checkInBy: string, roomLabel: string): EssaySession => ({
  id, seasonLabel: '2027학년도', trackLabel, examDate, startsAt, endsAt, checkInBy,
  buildingCode: '가상 시험관', roomLabel, destinationNodeId: null, checkInNodeId: null,
  items: ['수험표(예시)', '신분증(예시)', '검정 필기구(예시)'],
  notices: ['아래는 화면 시연용 준비물·유의사항입니다. 실제 지참물과 반입 제한은 공식 공지로 확인해 주세요.', '혼잡을 고려해 여유 있게 도착해 주세요.'], isPublished: true, sortOrder: 0,
});
const stall = (id: string, dayId: string, name: string, category: FestivalStall['category'], extra: Partial<FestivalStall> = {}): FestivalStall => ({
  id, dayId, name, category, buildingCode: '가상 축제 광장', nodeId: null, entranceNodeId: null, exitNodeId: null,
  opensAt: '16:00', closesAt: '22:00', queueNote: '가상 대기 안내: 입장 표지에서 한 줄로 기다려 주세요. 실제 대기 시간은 제공하지 않습니다.',
  description: '캠포 화면 시연을 위한 가상 부스입니다.', isPublished: true, sortOrder: 0, ...extra,
});
export const DEMO_CONTENT: ContentData = {
  essays: [
    essay('demo-exam-1', '2026-11-28', '가상 인문계열 오전', '09:00', '10:30', '08:30', '가상 301호'),
    essay('demo-exam-2', '2026-11-28', '가상 자연계열 오후', '14:00', '15:30', '13:30', '가상 402호'),
    essay('demo-exam-3', '2026-11-29', '가상 상경계열 오전', '10:00', '11:30', '09:30', '가상 201호'),
    essay('demo-exam-4', '2026-11-29', '가상 자연계열 오후', '15:00', '16:30', '14:30', '가상 501호'),
  ],
  festivals: [{ id: 'demo-festival', name: 'CAMPO 가상 캠퍼스 축제', startsOn: '2026-11-20', endsOn: '2026-11-22', summary: '세 날짜를 전환하며 공연과 부스를 찾아보는 시연용 축제입니다.', isPublished: true }],
  days: [0, 1, 2].map((index) => ({ id: `demo-day-${index}`, festivalId: 'demo-festival', dayDate: `2026-11-${20 + index}`, opensAt: '16:00', closesAt: '22:00', sortOrder: index })),
  stalls: [
    stall('demo-stall-1', 'demo-day-0', '가상 별빛 주점', '주점'),
    stall('demo-stall-2', 'demo-day-0', '가상 만들기 부스', '부스'),
    stall('demo-stall-3', 'demo-day-0', '가상 안내·휴식소', '편의'),
    stall('demo-stall-4', 'demo-day-1', '가상 캠포 공연장', '공연'),
    stall('demo-stall-5', 'demo-day-1', '가상 동아리 부스', '부스'),
    stall('demo-stall-6', 'demo-day-2', '가상 마지막 밤 주점', '주점'),
    stall('demo-stall-7', 'demo-day-2', '가상 안내·휴식소', '편의'),
  ],
  performances: [0, 1, 2].flatMap((index) => [
    { id: `demo-performance-${index}-a`, dayId: `demo-day-${index}`, startsAt: '18:00', endsAt: '18:40', artist: `가상 밴드 ${index + 1}`, stageLabel: '가상 중앙무대', nodeId: null, description: '가상 출연진입니다. 실제 섭외·공연 정보가 아닙니다.', isPublished: true, sortOrder: 0 },
    { id: `demo-performance-${index}-b`, dayId: `demo-day-${index}`, startsAt: '20:00', endsAt: '20:50', artist: `가상 아티스트 ${index + 1}`, stageLabel: '가상 중앙무대', nodeId: null, description: '타임테이블 시연용 공연입니다.', isPublished: true, sortOrder: 1 },
  ]),
  events: [
    { id: 'demo-event-1', title: '가상 입학설명회', category: '입학', startsAt: '2026-11-25T14:00:00+09:00', endsAt: '2026-11-25T16:00:00+09:00', placeLabel: '가상 설명회관 대강당', buildingCode: null, nodeId: null, host: '가상 입학 안내팀', summary: '진학 안내 화면을 시연하는 가상 설명회입니다. 실제 모집 일정이 아닙니다.', linkUrl: null, isPublished: true, allDay: false, pinned: true },
    { id: 'demo-event-2', title: '가상 캠퍼스 길찾기 특강', category: '강연', startsAt: '2026-11-26T16:00:00+09:00', endsAt: '2026-11-26T17:30:00+09:00', placeLabel: '가상 강연관 201호', buildingCode: null, nodeId: null, host: '가상 학술팀', summary: '보행 내비게이션을 주제로 한 화면 시연용 특강입니다.', linkUrl: null, isPublished: true, allDay: false, pinned: false },
    { id: 'demo-event-3', title: '가상 동아리 교류 행사', category: '행사', startsAt: '2026-11-27T12:00:00+09:00', endsAt: '2026-11-27T18:00:00+09:00', placeLabel: '가상 행사 광장', buildingCode: null, nodeId: null, host: '가상 동아리 연합', summary: '다양한 부스를 둘러보는 가상 교내 행사입니다.', linkUrl: null, isPublished: true, allDay: false, pinned: false },
    { id: 'demo-event-4', title: '가상 학교생활 설명회', category: '설명회', startsAt: '2026-11-28T11:00:00+09:00', endsAt: null, placeLabel: '가상 학생회관', buildingCode: null, nodeId: null, host: '가상 학생 지원팀', summary: '실제 개최되지 않는 화면 시연용 설명회입니다.', linkUrl: null, isPublished: true, allDay: false, pinned: false },
  ],
};
export const DEMO_SOURCE: ContentSource = { mode: 'demo', load: async () => DEMO_CONTENT };
