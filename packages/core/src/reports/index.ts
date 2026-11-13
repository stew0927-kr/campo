// Report pipeline (SPEC-v0.2 7.3).
export * from './types.ts';
export { BUNDLE_DISTANCE_M } from './constants.ts';
export { REPORT_KIND_INFO, isPermanentKind, isTemporaryKind, reportSource, type ReportHandling, type ReportKindInfo } from './kinds.ts';
export {
  STATUS_LABELS,
  attachPrUrl,
  canTransition,
  expireReports,
  isFinished,
  isInQueue,
  reopenReport,
  transitionReport,
  withStatus,
  type TransitionInput,
  type TransitionResult,
} from './status.ts';
export {
  bundleIdFor,
  bundleMembers,
  bundleReports,
  canBundle,
  duplicateOverride,
  findBundles,
  removeFromBundle,
  reportDistanceM,
  settleBundle,
  type Bundle,
} from './bundle.ts';
export {
  addOverrides,
  changedFeatureIds,
  planBundle,
  planReport,
  type AlreadyFixedPlan,
  type DuplicatePlan,
  type EditPlan,
  type ExpiredPlan,
  type ManualPlan,
  type OverridePlan,
  type PlanOptions,
  type ReportPlan,
} from './plan.ts';
export { isReport, validateReport } from './schema.ts';
