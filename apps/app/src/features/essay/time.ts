export function seoulTime(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
export function checkInTimeline(date: string, checkInBy: string | null, travelSec: number | null): string[] {
  if (!checkInBy) return ['입실 마감 시각이 아직 없습니다. 학교 공지를 확인해 주세요.'];
  const deadline = new Date(`${date}T${checkInBy.length === 5 ? `${checkInBy}:00` : checkInBy}+09:00`).getTime();
  if (!Number.isFinite(deadline)) return ['입실 시각을 확인해 주세요.'];
  const arrival = deadline - 30 * 60_000;
  const lines = [
    `${seoulTime(new Date(arrival).toISOString())}까지 건물 도착을 목표로 해 주세요. (마감 30분 전)`,
    `${seoulTime(new Date(deadline - 10 * 60_000).toISOString())}까지 고사실·준비물을 확인해 주세요. (마감 10분 전)`,
    `${seoulTime(new Date(deadline).toISOString())} 입실 마감 예시입니다.`,
  ];
  if (travelSec !== null && Number.isFinite(travelSec) && travelSec >= 0) lines.unshift(`${seoulTime(new Date(arrival - travelSec * 1000).toISOString())} 출발 권장 시각입니다. 선택한 출발지에서 계산한 예상 시간이며 여유를 더 두세요.`);
  else lines.unshift('길찾기를 완료하면 선택한 출발지 기준 예상 이동 시간을 반영할 수 있습니다. 현재는 출발 시각을 추정하지 않습니다.');
  return lines;
}
