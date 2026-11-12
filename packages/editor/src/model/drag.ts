// Dragging a node (SPEC-v0.2 5.1, iD drag_node): the history holds one entry per drag.
//   start   perform(noop), no label
//   move    replace(moveNode), no label     (the map only redraws a small temporary source meanwhile)
//   finish  the last replace carries the label: moveNode, or mergeNodes (dropped on a node), or splitEdgeAt with the node (dropped on an edge)
// A drop that core refuses puts the node back where it was (undo of the whole drag), like iD's "nope".
import { mergeNodes, moveNode, noop, splitEdgeAt, type EditContext, type EditState, type History, type Position } from '@campo/core';

export type DropTarget = { kind: 'node'; id: string } | { kind: 'edge'; id: string };

export type DragResult =
  | { ok: true; kind: 'move' | 'merge' | 'split'; warnings: string[] }
  | { ok: false; reason: string };

export class NodeDrag {
  constructor(
    private readonly history: History,
    private readonly ctx: EditContext,
    readonly nodeId: string,
  ) {}

  start(): void {
    this.history.perform(noop(), null);
  }

  /** The state with the node (and its elevator mates) at `coord`. */
  move(coord: Position): EditState {
    return this.history.replace(moveNode(this.nodeId, coord), null);
  }

  /** Back to the state before start(); the drag leaves no entry. */
  cancel(): void {
    this.history.undo();
  }

  finish(coord: Position, target: DropTarget | null): DragResult {
    const h = this.history;
    if (!target) {
      h.replace(moveNode(this.nodeId, coord));
      return { ok: true, kind: 'move', warnings: [] };
    }
    if (target.kind === 'node') {
      const there = h.current().nodes[target.id];
      if (!there) return this.refuse(`지점 "${target.id}"이(가) 없습니다.`);
      const place = moveNode(this.nodeId, there.coord);
      const merge = mergeNodes([this.nodeId, target.id], this.ctx);
      const reason = merge.disabled(place.apply(h.current()));
      if (reason !== false) return this.refuse(reason);
      h.replace(place, null);
      const warnings = merge.warnings?.(h.current()) ?? [];
      h.replace(merge);
      return { ok: true, kind: 'merge', warnings };
    }
    h.replace(moveNode(this.nodeId, coord), null);
    const split = splitEdgeAt(target.id, coord, { nodeId: this.nodeId }, this.ctx);
    const reason = split.disabled(h.current());
    if (reason !== false) return this.refuse(reason);
    const warnings = split.warnings?.(h.current()) ?? [];
    h.replace(split);
    return { ok: true, kind: 'split', warnings };
  }

  private refuse(reason: string): DragResult {
    this.cancel();
    return { ok: false, reason };
  }
}
