// The form that is open, and what its answer does. Each form answers with a Plan run through `perform`
// (one history entry), except 측정, which adds a line to the session instead of editing the map.
import { buildingById, type EditContext, type EditState, type Position } from '@campo/core';
import { planAddBuilding } from '../model/building.ts';
import { planRestroom } from '../model/doors.ts';
import { planElevator, planElevatorEdit, stopsOf } from '../model/elevator.ts';
import type { Direction, MeasureForm, MeasureTarget } from '../model/measure.ts';
import type { Plan, PlanResult } from '../model/plan.ts';
import type { Scope } from '../model/scope.ts';
import { planIndoorNode, planOutdoorNode, planStairs } from '../model/tools.ts';
import {
  AttachReportDialog, BuildingDialog, ClassroomDialog, DeleteBuildingDialog, ElevatorDialog, MeasureDialog, PoiDialog, RestroomDialog, StairsDialog,
  type AttachReportItem, type DeleteBuildingItem,
} from '../ui/Dialogs.tsx';

type Floor = Extract<Scope, { kind: 'building' }>;

/** Open form, with where it was asked for. Screen state. */
export type Dialog =
  | { kind: 'poi'; position: Position }
  | { kind: 'classroom' | 'stairs' | 'restroom'; position: Position; scope: Floor }
  | { kind: 'elevator'; position: Position; buildingId: string }
  | { kind: 'elevator-edit'; elevatorId: string }
  | { kind: 'measure'; target: MeasureTarget; directions: Direction[] }
  | { kind: 'attach-report'; attached: number; failed: AttachReportItem[] }
  | { kind: 'building'; ring: Position[] }
  | { kind: 'delete-building'; plan: Plan; items: DeleteBuildingItem[] };

interface Props {
  dialog: Dialog;
  state: EditState;
  ctx: EditContext;
  /** Run a plan; returns the error for the form to show, or undefined when it ran (the form closes). */
  perform: (plan: PlanResult) => string | undefined;
  /** Something was placed on this floor: show it from now on. */
  followScope: (scope: Scope) => void;
  addObservation: (target: MeasureTarget, form: MeasureForm) => string | undefined;
  onClose: () => void;
}

export function AppDialogs({ dialog, state, ctx, perform, followScope, addObservation, onClose }: Props) {
  /** Run a plan that places something on `scope`. */
  const place = (scope: Scope, plan: PlanResult) => {
    const err = perform(plan);
    if (err === undefined) followScope(scope);
    return err;
  };

  switch (dialog.kind) {
    case 'building':
      return <BuildingDialog onCancel={onClose} onSubmit={(form) => perform(planAddBuilding(dialog.ring, form))} />;
    case 'delete-building':
      return <DeleteBuildingDialog items={dialog.items} onCancel={onClose} onConfirm={() => perform(dialog.plan)} />;
    case 'poi':
      return <PoiDialog onCancel={onClose} onSubmit={(name) => perform(planOutdoorNode(state, ctx, dialog.position, name))} />;
    case 'classroom': {
      const { scope, position } = dialog;
      return (
        <ClassroomDialog
          onCancel={onClose}
          onSubmit={({ ref, spaceName }) => place(scope, planIndoorNode(state, ctx, { buildingId: scope.buildingId, level: scope.level, kind: 'classroom', position, ref, spaceName }))}
        />
      );
    }
    case 'restroom': {
      const { scope, position } = dialog;
      return <RestroomDialog onCancel={onClose} onSubmit={(form) => place(scope, planRestroom(state, ctx, { position, scope, form }))} />;
    }
    case 'stairs': {
      const { scope, position } = dialog;
      const building = buildingById(state, scope.buildingId);
      if (!building) return null;
      return (
        <StairsDialog
          building={building}
          startLevel={scope.level}
          onCancel={onClose}
          onSubmit={({ from, to }) => place(scope, planStairs(state, ctx, { buildingId: scope.buildingId, position, from, to }))}
        />
      );
    }
    case 'elevator': {
      const building = buildingById(state, dialog.buildingId);
      if (!building) return null;
      return (
        <ElevatorDialog
          building={building}
          onCancel={onClose}
          onSubmit={(levels) => perform(planElevator(state, ctx, { buildingId: dialog.buildingId, position: dialog.position, levels }))}
        />
      );
    }
    case 'elevator-edit': {
      const stops = stopsOf(state, dialog.elevatorId);
      const buildingId = stops[0]?.props.building_id;
      const building = buildingId ? buildingById(state, buildingId) : undefined;
      if (!building) return null;
      return (
        <ElevatorDialog
          building={building}
          initial={stops.map((n) => n.props.level!)}
          onCancel={onClose}
          onSubmit={(levels) => perform(planElevatorEdit(state, ctx, dialog.elevatorId, levels))}
        />
      );
    }
    case 'measure':
      return <MeasureDialog target={dialog.target} directions={dialog.directions} onCancel={onClose} onSubmit={(form) => addObservation(dialog.target, form)} />;
    case 'attach-report':
      return <AttachReportDialog attached={dialog.attached} failed={dialog.failed} onClose={onClose} />;
  }
}
