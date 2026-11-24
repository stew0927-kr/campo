import { useCampusData } from '../../hooks/useCampusData.ts';
import { MapCanvas } from '../map/MapCanvas.tsx';
import { Empty } from '../../ui/kit.tsx';
import type { FestivalStall } from '../content/types.ts';
export function BoothMap({ stalls, onSelect }: { stalls: readonly FestivalStall[]; onSelect: (stall: FestivalStall) => void }) {
  const campus = useCampusData();
  const places = campus.places.filter((place) => stalls.some((stall) => stall.nodeId === place.id));
  if (!places.length) return <Empty message="지도에 표시할 부스 위치가 아직 없습니다." />;
  return <MapCanvas center={campus.campus?.center ?? { lat: 37.5572, lng: 127.045 }} label="등록된 축제 부스 위치" route={null} from={null} to={null} places={places} graph={campus.graph} buildingId={null} level={null} position={null} flow={null} onPoint={() => undefined} onPlace={(place) => {
    const stall = stalls.find((row) => row.nodeId === place.id); if (stall) onSelect(stall);
  }} />;
}
