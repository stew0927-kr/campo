'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compilePlan } = require('./plan.cjs');

function rentalPlan() {
  return {
    title: '공구 대여 검증 기획',
    start: 'start',
    initial: { date: '', reserved: false },
    screens: {
      start: { title: '공구 목록', actions: [
        { id: 'choose-date', label: '날짜 선택 열기', to: 'date' },
        { id: 'inspect', to: 'inspect' },
      ] },
      inspect: { actions: [{ id: 'date-from-inspect', to: 'date' }] },
      date: {
        actions: [
          { id: 'friday', to: 'date', set: { date: '금요일' } },
          { id: 'saturday', to: 'date', set: { date: '토요일' } },
          { id: 'open-confirm', to: 'confirm', when: { date: '금요일' } },
          { id: 'back', to: 'start' },
        ],
        assertions: [{ selector: '.selected-date', attribute: 'data-date', value: '{{date}}' }],
      },
      confirm: { actions: [
        { id: 'dismiss', to: 'date' },
        { id: 'reserve', to: 'done', set: { reserved: true } },
      ] },
      done: { end: true, actions: [] },
    },
  };
}

test('builds a shortest prefix and a test for every enabled edge, including back and self actions', () => {
  const input = rentalPlan();
  const verified = compilePlan(input);
  assert.deepEqual(verified.findings, []);
  assert.equal(verified.screens, input.screens);
  assert.equal(verified.totalStates, 11);
  assert.equal(verified.cases.length, 22);
  assert.equal(new Set(verified.cases.map(item => item.id)).size, verified.cases.length);
  assert.deepEqual(verified.cases, compilePlan(rentalPlan()).cases);

  const edgeCases = verified.cases.filter(({ steps }) => steps.length);
  const dismiss = edgeCases.find(({ steps }) => steps.at(-1).action === 'dismiss');
  assert.deepEqual(dismiss.steps.map(step => step.action), ['choose-date', 'friday', 'open-confirm', 'dismiss']);
  assert.deepEqual(dismiss.steps.at(-1).before, dismiss.steps.at(-1).after);
  const stationary = edgeCases.find(({ steps }) => {
    const step = steps.at(-1);
    return step.action === 'friday' && step.before.date === '금요일';
  });
  assert.equal(stationary.steps.at(-1).from, 'date');
  assert.equal(stationary.steps.at(-1).to, 'date');
  assert.deepEqual(stationary.steps.at(-1).before, stationary.steps.at(-1).after);
  const confirmation = edgeCases.filter(({ steps }) => steps.at(-1).action === 'open-confirm');
  assert.equal(confirmation.length, 1);
  assert.equal(confirmation[0].steps.at(-1).before.date, '금요일');
  const finishes = edgeCases.filter(({ steps }) => steps.at(-1).to === 'done');
  assert.equal(finishes.length, 2);
  assert(finishes.every(({ steps }) => steps.at(-1).after.reserved));
});

test('reports an impossible guard once with its first reachable source state and tracks resolution', () => {
  const input = rentalPlan();
  input.screens.confirm.actions.push({ id: 'weekend-pickup', label: '주말 수령', to: 'pickup', when: { date: '토요일' } });
  input.screens.pickup = { title: '수령 시간', actions: [{ id: 'pickup-done', to: 'receipt' }] };
  input.screens.receipt = { end: true, actions: [] };
  input.screens.detached = { title: '독립 화면', end: true, actions: [] };
  const { findings, passedChecks } = compilePlan(input);
  assert.deepEqual(findings.map(issue => issue.reason).sort(), ['unreachable-condition', 'unreachable-screen']);
  const guard = findings.find(issue => issue.reason === 'unreachable-condition');
  assert.equal(guard.screen, 'confirm');
  assert.equal(guard.expectedScreen, 'pickup');
  assert.deepEqual(guard.route.steps.map(step => step.action), ['choose-date', 'friday', 'open-confirm', 'weekend-pickup']);
  assert.equal(guard.initial.date, '금요일');
  assert.match(guard.expected, /토요일/);
  assert(!passedChecks.includes(guard.checkId));
  assert.equal(findings.find(issue => issue.reason === 'unreachable-screen').screen, 'detached');

  delete input.screens.confirm.actions[2].when;
  const repaired = compilePlan(input);
  assert(repaired.passedChecks.includes(guard.checkId));
  assert.equal(repaired.findings.length, 1);
});

test('finds a Friday-only trap even though the same screen allows Saturday to return', () => {
  const input = rentalPlan();
  input.screens.date.actions.push(
    { id: 'details', to: 'details', when: { date: '금요일' } },
    { id: 'details-weekend', to: 'details', when: { date: '토요일' } },
  );
  input.screens.details = { actions: [{ id: 'return', to: 'date', when: { date: '토요일' } }] };
  const { findings } = compilePlan(input);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].reason, 'no-exit');
  assert.equal(findings[0].screen, 'details');
  assert.equal(findings[0].initial.date, '금요일');
  assert.deepEqual(findings[0].route.steps.map(step => step.action),
    ['choose-date', 'friday', 'details', undefined]);

  delete input.screens.details.actions[0].when;
  const repaired = compilePlan(input);
  assert.deepEqual(repaired.findings, []);
  assert(repaired.passedChecks.includes(findings[0].checkId));
});

test('locates a closed cycle at its first reached screen and accepts cycles with a return to entry', () => {
  const input = {
    title: '닫힌 경로 검증',
    start: 'start',
    initial: {},
    screens: {
      start: { actions: [{ id: 'enter', to: 'before' }] },
      before: { actions: [{ id: 'next', to: 'one' }] },
      one: { actions: [{ id: 'repeat', to: 'two' }] },
      two: { actions: [{ id: 'repeat', to: 'one' }] },
    },
  };
  const { findings } = compilePlan(input);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].screen, 'one');
  assert.deepEqual(findings[0].route.steps.map(step => step.action), ['enter', 'next', undefined]);
  input.screens.two.actions.push({ id: 'return', to: 'start' });
  assert.deepEqual(compilePlan(input).findings, []);
});

test('accepts an entry screen that needs a same-screen action before it can leave', () => {
  const input = {
    title: '진입 화면 조건 검증',
    start: 'start',
    initial: { agreed: false },
    screens: {
      start: { actions: [
        { id: 'agree', to: 'start', set: { agreed: true } },
        { id: 'continue', to: 'finish', when: { agreed: true } },
      ] },
      finish: { actions: [], end: true },
    },
  };
  const verified = compilePlan(input);
  assert.deepEqual(verified.findings, []);
  assert.equal(verified.totalStates, 3);
  assert(verified.cases.some(({ steps }) => steps.map(step => step.action).join(',') === 'agree,continue'));
});

test('keeps an initial state-only case and respects intentional termination', () => {
  const input = { title: '시작 화면 검증', start: 'start', initial: {}, screens: { start: { actions: [] } } };
  const blocked = compilePlan(input);
  assert.equal(blocked.findings[0].reason, 'no-exit');
  assert.deepEqual(blocked.cases.map(item => item.steps), [[]]);
  input.screens.start.end = true;
  assert.deepEqual(compilePlan(input).findings, []);
});

test('rejects malformed expectations rather than dropping them from the verification', () => {
  const changes = [
    p => { p.screens.date.actions[0].to = 'absent'; },
    p => { p.screens.date.actions.push(p.screens.date.actions[0]); },
    p => { p.screens.date.actions[0].set.undeclared = true; },
    p => { p.screens.date.actions[0].set.date = false; },
    p => { p.screens.date.assertions[0].text = 'both'; },
    p => { p.screens.date.assertions[0].selector = ' '; },
    p => { p.screens.date.assertions[0].value = '{{undeclared}}'; },
    p => { p.screens.start.actions[0].whnen = { date: '' }; },
  ];
  for (const change of changes) {
    const malformed = rentalPlan();
    change(malformed);
    assert.throws(() => compilePlan(malformed), TypeError);
  }
});

test('fails clearly when assignment combinations exceed the model exploration bound', () => {
  const initial = Object.fromEntries(Array.from({ length: 9 }, (_, index) => ['flag' + index, false]));
  const actions = Object.keys(initial).map((name, index) => ({
    id: 'flag-' + index,
    to: 'start',
    set: { [name]: true },
  }));
  const input = { title: '탐색 상한 검증', start: 'start', initial, screens: { start: { actions } } };
  assert.throws(() => compilePlan(input), { name: 'RangeError', message: /256/ });
});
