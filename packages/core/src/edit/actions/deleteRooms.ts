import { defineAction, deletionWarnings, type Action, type EditContext } from '../action.ts';
import { sortedValues, type EditNode, type EditState } from '../state.ts';
import { missing } from './common.ts';

/** Delete room outlines. Their doors stay (a door is a path node, the outline is only macro input). */
export function deleteRooms(ids: readonly string[], ctx?: EditContext): Action {
  const list = [...new Set(ids)];
  const action = defineAction({
    annotation: `강의실 영역 ${list.length}개 삭제`,
    disabled: (state) => missing('강의실 영역', list, (id) => id in state.rooms),
    recipe(draft) {
      for (const id of list) delete draft.rooms[id];
    },
    warnings: (state) => deletionWarnings(action, ctx, state),
  });
  return action;
}

/** Doors of a room: door nodes in the same building and level whose room_ref equals the room's room_ref. */
export function doorsOfRoom(state: EditState, roomId: string): EditNode[] {
  const room = state.rooms[roomId];
  const ref = room?.props.room_ref;
  if (!room || ref === undefined) return [];
  return sortedValues(state.nodes).filter((n) =>
    n.props.node_type === 'door' &&
    n.props.room_ref === ref &&
    n.props.building_id === room.props.building_id &&
    n.props.level === room.props.level);
}
