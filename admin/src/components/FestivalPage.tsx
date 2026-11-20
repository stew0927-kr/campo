// Festival -> day -> stalls and performances. Pick a row with "선택" to see what belongs to it.
import { useState } from 'react';
import type { Row } from '../lib/convert.ts';
import { festivalDays, festivalPerformances, festivals, festivalStalls } from '../tables.ts';
import { ResourcePanel } from './ResourcePanel.tsx';

export function FestivalPage() {
  const [festival, setFestival] = useState<Row | null>(null);
  const [day, setDay] = useState<Row | null>(null);
  const festivalId = festival ? String(festival['id']) : null;
  const dayId = day ? String(day['id']) : null;

  return (
    <>
      <p className="hint">
        축제를 <b>선택</b>하면 날짜가, 날짜를 <b>선택</b>하면 그날의 부스·공연이 아래에 나옵니다. 부스·공연은 축제가 공개 중일 때만 앱에 보입니다.
      </p>
      <ResourcePanel
        config={festivals}
        selectedId={festivalId}
        onSelect={(r) => {
          setFestival(r);
          setDay(null);
        }}
      />
      {festivalId && (
        <>
          <h3 className="crumb">{String(festival?.['name'] ?? '')} › 날짜</h3>
          <ResourcePanel key={`days-${festivalId}`} config={festivalDays} parentId={festivalId} selectedId={dayId} onSelect={setDay} />
        </>
      )}
      {festivalId && dayId && (
        <>
          <h3 className="crumb">
            {String(festival?.['name'] ?? '')} › {String(day?.['day_date'] ?? '')}
          </h3>
          <ResourcePanel key={`stalls-${dayId}`} config={festivalStalls} parentId={dayId} />
          <ResourcePanel key={`perfs-${dayId}`} config={festivalPerformances} parentId={dayId} />
        </>
      )}
    </>
  );
}
