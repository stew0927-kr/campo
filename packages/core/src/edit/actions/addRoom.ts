import type { Position, RoomProperties } from '../../types.ts';
import { defineAction, idMemo, needIds, type Action, type EditContext } from '../action.ts';
import { freshId, roomIdPrefix } from '../ids.ts';
import { clone, idTaken } from '../state.ts';
import { polygonProblem, scopeProblem, withRevOne, type NewProps } from './common.ts';

export interface NewRoom {
  /** Omit to draw one from ctx.ids. */
  id?: string;
  polygon: Position[][];
  props: NewProps<RoomProperties>;
}

/** Add a room outline (rev 1). Its building and level must exist (same scope rule as nodes). */
export function addRoom(input: NewRoom, ctx?: EditContext): Action {
  if (input.id === undefined) needIds(ctx, 'addRoom');
  const memo = idMemo();
  return defineAction({
    annotation: '강의실 영역 추가',
    disabled(state) {
      if (input.id !== undefined && idTaken(state, input.id)) return `이미 있는 id입니다: ${input.id}`;
      return scopeProblem(state, input.props) || polygonProblem(input.polygon);
    },
    recipe(draft) {
      const { building_id, level } = input.props;
      const id = input.id ?? memo(0, draft, () => freshId(draft, ctx!.ids, roomIdPrefix(draft, building_id, level)));
      draft.rooms[id] = { id, polygon: clone(input.polygon), props: withRevOne(input.props) };
    },
  });
}
