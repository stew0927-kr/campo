'use strict';

const {translator} = require('../assets/locale.js');

const { assign, createMachine } = require('xstate');
const { getAdjacencyMap } = require('xstate/graph');

const maxStates = 256;
const maxTransitions = 4096;
const eventPrefix = 'wireflow.action.';
const screenId = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const variableId = /^[A-Za-z][A-Za-z0-9_]*$/;
const attributeName = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const plainRecord = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const isScalar = value => typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value);
const matches = (vars, requirements) => Object.entries(requirements || {}).every(([key, value]) => vars[key] === value);

function requirePlan(condition, message) {
  if (!condition) throw new TypeError(message);
}

function record(value, allowed, where) {
  requirePlan(plainRecord(value), where + ' 항목에는 객체가 필요해요.');
  if (!allowed) return;
  for (const key of Object.keys(value)) {
    requirePlan(allowed.includes(key), where + '에 정의되지 않은 항목이 있어요: ' + key);
  }
}

function validateVars(values, initial, where) {
  record(values, null, where);
  for (const [key, value] of Object.entries(values)) {
    requirePlan(variableId.test(key) && !Object.hasOwn(Object.prototype, key),
      where + '의 상태 변수 이름이 올바르지 않아요: ' + key);
    requirePlan(Object.hasOwn(initial, key) && isScalar(value) && typeof value === typeof initial[key],
      where + '의 상태 변수 값이 초기 정의와 맞아야 해요: ' + key);
  }
}

function validateAssertion(assertion, initial, where) {
  record(assertion, ['selector', 'text', 'attribute', 'value', 'when', 'requirement'], where);
  requirePlan(nonempty(assertion.selector), where + '에 화면 선택자(selector)가 필요해요.');
  requirePlan(assertion.requirement===undefined || (typeof assertion.requirement==='string' && screenId.test(assertion.requirement)), where + '의 기획 항목 ID가 올바르지 않아요.');
  if (Object.hasOwn(assertion, 'when')) validateVars(assertion.when, initial, where + '.when');
  const hasText = Object.hasOwn(assertion, 'text');
  const hasAttribute = Object.hasOwn(assertion, 'attribute');
  const hasValue = Object.hasOwn(assertion, 'value');
  requirePlan(hasText ? !hasAttribute && !hasValue && nonempty(assertion.text) :
    hasAttribute && hasValue && typeof assertion.attribute === 'string' &&
      attributeName.test(assertion.attribute) && typeof assertion.value === 'string',
  where + '에 비교할 text 또는 attribute와 value가 필요해요.');
  const template = hasText ? assertion.text : assertion.value;
  for (const match of template.matchAll(/{{([^{}]*)}}/g)) {
    requirePlan(Object.hasOwn(initial, match[1]), where + '의 상태 변수를 찾을 수 없어요: ' + match[1]);
  }
}

function validatePlan(plan) {
  record(plan, ['title', 'start', 'initial', 'screens'], '검증 기획');
  requirePlan(nonempty(plan.title), '검증 기획에 제목(title)이 필요해요.');
  validateVars(plan.initial, plan.initial, '초기 상태(initial)');
  record(plan.screens, null, '화면(screens)');
  requirePlan(typeof plan.start === 'string' && Object.hasOwn(plan.screens, plan.start),
    '진입 화면(start)이 화면 목록에 있어야 해요.');
  for (const [id, screen] of Object.entries(plan.screens)) {
    requirePlan(screenId.test(id) && !Object.hasOwn(Object.prototype, id), '화면 ID가 올바르지 않아요: ' + id);
    record(screen, ['title', 'end', 'actions', 'assertions', 'unverifiedActions'], id);
    requirePlan(!Object.hasOwn(screen, 'title') || nonempty(screen.title), id + '.title에 화면 이름이 필요해요.');
    requirePlan(!Object.hasOwn(screen, 'end') || typeof screen.end === 'boolean', id + '.end에는 불리언 값이 필요해요.');
    requirePlan(Array.isArray(screen.actions), id + '.actions에 조작 목록이 필요해요.');
    const seen = new Set();
    for (const [index, action] of screen.actions.entries()) {
      const where = id + '.actions[' + index + ']';
      record(action, ['id', 'label', 'to', 'when', 'set', 'requirement', 'hiddenRequirement'], where);
      requirePlan(typeof action.id === 'string' && screenId.test(action.id) && !seen.has(action.id),
        where + '에 중복되지 않는 조작 ID가 필요해요.');
      seen.add(action.id);
      requirePlan(typeof action.to === 'string' && Object.hasOwn(plan.screens, action.to),
        where + '의 목적지(to)가 화면 목록에 있어야 해요.');
      requirePlan(!Object.hasOwn(action, 'label') || nonempty(action.label), where + '.label에 조작 이름이 필요해요.');
      for (const key of ['requirement','hiddenRequirement']) {
        requirePlan(action[key]===undefined || (typeof action[key]==='string' && screenId.test(action[key])), where + '의 기획 항목 ID가 올바르지 않아요.');
      }
      for (const field of ['when', 'set']) {
        if (Object.hasOwn(action, field)) validateVars(action[field], plan.initial, where + '.' + field);
      }
    }
    if (Object.hasOwn(screen, 'unverifiedActions')) {
      requirePlan(Array.isArray(screen.unverifiedActions) && screen.unverifiedActions.every(id =>
        typeof id === 'string' && screenId.test(id) && !seen.has(id)),
        id + '.unverifiedActions에는 별도 시험할 조작 ID가 필요해요.');
    }
    if (Object.hasOwn(screen, 'assertions')) {
      requirePlan(Array.isArray(screen.assertions), id + '.assertions에 검사 목록이 필요해요.');
      for (const [index, assertion] of screen.assertions.entries()) {
        validateAssertion(assertion, plan.initial, id + '.assertions[' + index + ']');
      }
    }
  }
}

function actionLabel(plan, screen, action) {
  const control = plan.screens[screen].actions.find(item => item.id === action);
  return control.label || control.id;
}

function screenLabel(plan, screen) {
  return plan.screens[screen].title || screen;
}

function explorePlan(plan) {
  const nodeId = screen => 'wireflow-screen-' + screen;
  const machine = createMachine({
    id: 'wireflow-plan',
    initial: plan.start,
    context: { ...plan.initial },
    states: Object.fromEntries(Object.entries(plan.screens).map(([screen, definition]) => [screen, {
      id: nodeId(screen),
      on: Object.fromEntries(definition.actions.map(action => [eventPrefix + action.id, {
        target: '#' + nodeId(action.to),
        ...(action.when && { guard: ({ context }) => matches(context, action.when) }),
        ...(action.set && { actions: assign(() => action.set) }),
      }])),
    }])),
  });
  const vars = Object.keys(plan.initial).sort();
  const stateKey = state => JSON.stringify([state.value, ...vars.map(key => state.context[key])]);
  let statesVisited = 0;
  let transitionsVisited = 0;
  const adjacency = getAdjacencyMap(machine, {
    serializeState: stateKey,
    events: state => {
      if (++statesVisited > maxStates) throw new RangeError('검증 기획의 상태가 ' + maxStates + '개를 초과했어요.');
      const events = plan.screens[state.value].actions.map(action => ({ type: eventPrefix + action.id }))
        .filter(event => state.can(event));
      transitionsVisited += events.length;
      if (transitionsVisited > maxTransitions) throw new RangeError('검증 기획의 전환이 ' + maxTransitions + '개를 초과했어요.');
      return events;
    },
  });
  const start = JSON.stringify([plan.start, ...vars.map(key => plan.initial[key])]);
  const nodes = new Map(Object.entries(adjacency).map(([key, { state, transitions }]) => [key, {
    key,
    screen: state.value,
    vars: state.context,
    next: Object.values(transitions).map(({ event, state: next }) => {
      const action = event.type.slice(eventPrefix.length);
      return { target: stateKey(next), step: {
        from: state.value, to: next.value, action, label: actionLabel(plan, state.value, action),
        before: state.context, after: next.context,
      } };
    }),
  }]));
  const previous = new Map([...nodes.keys()].map(key => [key, new Set()]));
  const paths = new Map([[start, []]]);
  const queue = [start];
  for (const key of queue) {
    const node = nodes.get(key);
    for (const { target, step } of node.next) {
      previous.get(target).add(key);
      if (paths.has(target)) continue;
      paths.set(target, [...paths.get(key), step]);
      queue.push(target);
    }
  }
  return { nodes, previous, paths };
}

function reverseReach(seeds, previous, allowed) {
  const reached = new Set(seeds);
  for (const key of reached) {
    for (const source of previous.get(key)) {
      if (!allowed || allowed.has(source)) reached.add(source);
    }
  }
  return reached;
}

function closedComponents(stalled, nodes, previous) {
  const visited = new Set();
  const finishOrder = [];
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    for (const { target } of nodes.get(key).next) {
      if (stalled.has(target)) visit(target);
    }
    finishOrder.push(key);
  }
  for (const key of stalled) visit(key);

  const remaining = new Set(stalled);
  const closed = [];
  for (const key of finishOrder.reverse()) {
    if (!remaining.has(key)) continue;
    const component = reverseReach([key], previous, remaining);
    for (const member of component) remaining.delete(member);
    const hasExit = [...component].some(member => nodes.get(member).next.some(({ target }) => !component.has(target)));
    if (!hasExit) closed.push(component);
  }
  return closed;
}

const checkKey = (reason, screen, action = null) => JSON.stringify(['xstate', reason, screen, action]);

function finding(ui, plan, node, path, { title, reason, action, expectedScreen, expected, actual, observation }) {
  const state = node?.vars || plan.initial;
  const screen = node?.screen || expectedScreen;
  const steps = [...path, { from: node?.screen || plan.start, action, before: state, label: observation }];
  const issue = { screen, action, expectedScreen, expected, actual };
  return {
    ...issue, title, reason, initial: state,
    checkId: checkKey(reason, screen, action),
    steps: [ui(`${screenLabel(plan, plan.start)}에서 시작`,`Start on ${screenLabel(plan, plan.start)}`), ...steps.map(step =>
      screenLabel(plan, step.from) + ' · ' + step.label + (step.to && step.to !== step.from ? ' → ' + screenLabel(plan, step.to) : ''))],
    route: { title, kind: 'XState', start: plan.start, initial: plan.initial, steps, issue },
  };
}

function checkPlan(plan, { nodes, previous, paths }, ui) {
  const findings = [];
  const passedChecks = [];
  const reached = new Map();
  for (const node of nodes.values()) {
    if (!reached.has(node.screen)) reached.set(node.screen, []);
    reached.get(node.screen).push(node);
  }
  const blockedTargets = new Set();
  const blockingActions = new Map();
  for (const [screen, states] of reached) {
    const enabled = new Set(states.flatMap(node => node.next.map(({ step }) => step.action)));
    passedChecks.push(checkKey('unreachable-screen', screen));
    for (const action of plan.screens[screen].actions) {
      if (enabled.has(action.id)) {
        passedChecks.push(checkKey('unreachable-condition', screen, action.id));
        continue;
      }
      const requirements = Object.entries(action.when || {});
      const score = node => requirements.filter(([key, value]) => node.vars[key] === value).length;
      const node = states.reduce((best, candidate) => score(candidate) > score(best) ? candidate : best);
      const label = actionLabel(plan, screen, action.id);
      const requirement = requirements.map(([key, value]) => key + ' = ' + JSON.stringify(value)).join(', ');
      findings.push(finding(ui, plan, node, paths.get(node.key), {
        title: label + ui(' · 실행 조건 미충족',' · Conditions unmet'),
        reason: 'unreachable-condition',
        action: action.id,
        expectedScreen: action.to,
        expected: ui(`${screenLabel(plan, action.to)}로 이동할 수 있어야 해요`,`Opens ${screenLabel(plan, action.to)}`) + (requirement ? ' · ' + requirement : ''),
        actual: ui(`기획에서 ${screenLabel(plan, screen)}에 도달한 ${states.length}개 상태 모두에서 실행할 수 없어요.`,
          `The plan cannot execute this action in any of the ${states.length} states reached on ${screenLabel(plan, screen)}.`),
        observation: ui(`‘${label}’의 실행 조건 확인`,`Check conditions for “${label}”`),
      }));
      if (!blockingActions.has(screen)) blockingActions.set(screen, new Set());
      blockingActions.get(screen).add(action.to);
      if (!reached.has(action.to)) blockedTargets.add(action.to);
    }
  }
  for (const screen of blockedTargets) {
    for (const action of plan.screens[screen].actions) {
      if (!reached.has(action.to)) blockedTargets.add(action.to);
    }
  }
  for (const screen of Object.keys(plan.screens)) {
    if (reached.has(screen) || blockedTargets.has(screen)) continue;
    findings.push(finding(ui, plan, null, [], {
      title: ui('기획 화면에 도달할 수 없음','Planned screen is unreachable'),
      reason: 'unreachable-screen',
      expectedScreen: screen,
      expected: ui(`${screenLabel(plan, plan.start)}에서 ${screenLabel(plan, screen)}에 도달할 수 있어야 해요.`,
        `${screenLabel(plan, plan.start)} should lead to ${screenLabel(plan, screen)}.`),
      actual: ui('기획에 정의된 조작으로 이 화면까지 이어지는 경로를 찾지 못했어요.','No sequence of planned actions leads to this screen.'),
      observation: ui(`${screenLabel(plan, screen)}로 이어지는 경로 확인`,`Check for a path to ${screenLabel(plan, screen)}`),
    }));
  }
  const exitStates = [...nodes.values()].filter(node => node.screen === plan.start || plan.screens[node.screen].end);
  const canExit = reverseReach(exitStates.map(node => node.key), previous);
  const entryStates = new Set(reached.get(plan.start).map(node => node.key));
  const entryWithExit = [...entryStates].filter(key => plan.screens[plan.start].end ||
    nodes.get(key).next.some(({ target }) => !entryStates.has(target) && canExit.has(target)));
  const canLeaveEntry = reverseReach(entryWithExit, previous, entryStates);
  const stalled = new Set([...nodes.keys()].filter(key => !canExit.has(key) ||
    (entryStates.has(key) && !canLeaveEntry.has(key))));
  const reported = new Set();

  for (const component of closedComponents(stalled, nodes, previous)) {
    const group = [...component].map(key => nodes.get(key));
    const screens = new Set(group.map(node => node.screen));
    const explainedByGuard = group.some(node => [...(blockingActions.get(node.screen) || [])]
      .some(target => !screens.has(target)));
    if (explainedByGuard) continue;
    const node = group.reduce((nearest, candidate) =>
      paths.get(candidate.key).length < paths.get(nearest.key).length ? candidate : nearest);
    if (reported.has(node.screen)) continue;
    reported.add(node.screen);
    findings.push(finding(ui, plan, node, paths.get(node.key), {
      title: ui('완료·복귀 경로 없음','No completion or return path'),
      reason: 'no-exit',
      expected: ui('완료 화면에 도달하거나 진입 화면으로 돌아갈 수 있어야 해요.','The route should finish or return to the entry screen.'),
      actual: node.next.length ?
        ui('이 상태에서 이동을 반복해도 완료하거나 돌아갈 수 없어요.','Continuing from this state never reaches completion or return.') :
        ui('이 상태에서 실행할 조작이 없어요.','No action is available in this state.'),
      observation: ui('완료·복귀 경로 확인','Check for completion or return'),
    }));
  }
  const stalledScreens = new Set([...stalled].map(key => nodes.get(key).screen));
  for (const screen of reached.keys()) {
    if (!stalledScreens.has(screen)) passedChecks.push(checkKey('no-exit', screen));
  }
  return { findings, passedChecks };
}

function compilePlan(plan, locale = 'ko') {
  const ui = translator(locale);
  validatePlan(plan);
  const graph = explorePlan(plan);
  const cases = [];
  for (const node of graph.nodes.values()) {
    const prefix = graph.paths.get(node.key);
    const title = screenLabel(plan, node.screen);
    const base = { start: plan.start, initial: plan.initial };
    if (!node.next.length) cases.push({ ...base, id: JSON.stringify([node.key, null]), title: title + ui(' · 화면 확인',' · Inspect screen'), steps: prefix });
    for (const { step } of node.next) {
      cases.push({ ...base, id: JSON.stringify([node.key, step.action]), title: title + ' · ' + step.label, steps: [...prefix, step] });
    }
  }
  return {
    locale, title: plan.title, start: plan.start, initial: plan.initial, screens: plan.screens,
    totalStates: graph.nodes.size, cases, ...checkPlan(plan, graph, ui),
  };
}

module.exports = { compilePlan };
