// Dragging a node (SPEC-v0.2 5.1, iD drag_node): the history holds one entry per drag.
//   start   perform(noop), no label
//   move    replace(moveNode), no label     (the map only redraws a small temporary source meanwhile)
//   finish  the last replace carries the label: moveNode, or mergeNodes (dropped on a node), or splitEdgeAt with the node (dropped on an edge)
// A drop that core refuses puts the node back where it was (undo of the whole drag), like iD's "nope".
import { addNode, compose, freshId, mergeNodes, moveNode, noop, nodeIdPrefix, splitEdgeAt, type EditContext, type EditState, type History, type NodeProperties, type Position } from '@campo/core';

export type DropTarget = { kind: 'node'; id: string } | { kind: 'edge'; id: string };

export type DragResult =
  | { ok: true; kind: 'move' | 'merge' | 'split' | 'handle'; warnings: string[] }
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

/**
 * Dragging the handle in the middle of an edge (SPEC-v0.2 5.1): a new node appears on the edge and follows the pointer.
 * Same history shape as NodeDrag: start perform(noop), every move replaces with compose([addNode, splitEdgeAt, moveNode]),
 * the last replace carries the label. One drag, one Ctrl+Z.
 */
export class HandleDrag {
  private constructor(
    private readonly history: History,
    private readonly ctx: EditContext,
    private readonly edgeId: string,
    private readonly mid: Position,
    private readonly props: NodeProperties,
    readonly nodeId: string,
  ) {}

  /** The drag, or the reason the edge cannot be split there (Korean). */
  static create(history: History, ctx: EditContext, edgeId: string, mid: Position): HandleDrag | string {
    const state = history.current();
    const reason = splitEdgeAt(edgeId, mid, {}, ctx).disabled(state);
    if (reason !== false) return reason;
    const edge = state.edges[edgeId]!;
    const from = state.nodes[edge.props.from]!.props;
    const props: NodeProperties = {
      kind: 'node',
      node_type: from.building_id === null ? 'outdoor' : edge.props.highway === 'steps' ? 'stair_landing' : 'corridor',
      building_id: from.building_id,
      level: from.level,
      source: edge.props.source,
      rev: 1,
    };
    const nodeId = freshId(state, ctx.ids, nodeIdPrefix(state, props));
    return new HandleDrag(history, ctx, edgeId, mid, props, nodeId);
  }

  private action(coord: Position, label?: string) {
    const { rev: _rev, ...props } = this.props;
    return compose([
      addNode({ id: this.nodeId, coord: [this.mid[0], this.mid[1]], props }, this.ctx),
      splitEdgeAt(this.edgeId, this.mid, { nodeId: this.nodeId }, this.ctx),
      moveNode(this.nodeId, coord),
    ], label ?? '구간 가운데에 지점 만들기');
  }

  /** The state before the drag: each move runs on it afresh (overwrite drops the previous move). */
  private before: EditState | null = null;

  start(): void {
    this.before = this.history.current();
    this.history.perform(noop(), null);
  }

  move(coord: Position): EditState {
    return this.history.overwrite(this.action(coord), null);
  }

  cancel(): void {
    this.history.undo();
  }

  finish(coord: Position, _target?: DropTarget | null): DragResult {
    const action = this.action(coord);
    const reason = action.disabled(this.before!);
    if (reason !== false) {
      this.cancel();
      return { ok: false, reason };
    }
    const warnings = action.warnings?.(this.before!) ?? [];
    this.history.overwrite(action);
    return { ok: true, kind: 'handle', warnings };
  }
}
