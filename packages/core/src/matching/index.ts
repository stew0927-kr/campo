// Pedestrian GPS map matching (docs/MAP_MATCHING.md): matcher network, incremental Viterbi, navigation state machine.
export * from './types.ts';
export {
  signedAngleDiffDeg,
  bearingDeg,
  createFrame,
  toLat,
  toLng,
  toLngLat,
  toLocal,
  toX,
  toY,
  type LocalFrame,
} from './geo.ts';
export {
  EDGE_ESCALATOR,
  EDGE_GROUND,
  EDGE_INDOOR,
  EDGE_PORTAL,
  EDGE_STEPS,
  buildMatchNetwork,
  createCandidateSet,
  edgeIndexOf,
  findCandidates,
  isInsideBuilding,
  nearestPortal,
  portalDistance,
  positionAt,
  routeDistance,
  searchFrom,
  type BuildMatchNetworkOptions,
  type CandidateSet,
  type MatchBuilding,
  type MatchNetwork,
} from './network.ts';
export { createMatcherState, matchStep, resetMatcher, setMatchScope, smoothedPath } from './hmm.ts';
export { buildNavRoute, initialNavState, navEventMessage, navStep, scopeForNav, type NavRoute } from './nav.ts';
