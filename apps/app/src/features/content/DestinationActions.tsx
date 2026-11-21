import type { Destination } from '../../state/model.ts';
import { useAppState } from '../../state/AppState.tsx';
import { Button } from '../../ui/kit.tsx';
export function DestinationActions({ destination }: { destination: Destination }) {
  const { state, dispatch } = useAppState();
  const favorite = state.favorites.some((item) => item.key === destination.key);
  return <><Button title="여기까지 길찾기" onPress={() => dispatch({ type: 'navigate', destination })} /><Button secondary title={favorite ? '즐겨찾기 해제' : '즐겨찾기 추가'} onPress={() => dispatch({ type: 'favorite', destination })} /></>;
}
