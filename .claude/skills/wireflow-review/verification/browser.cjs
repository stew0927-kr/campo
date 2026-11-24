'use strict';

const { randomUUID } = require('node:crypto');
const { mkdir } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium, errors } = require('playwright');
const {translator} = require('../assets/locale.js');

const activeBoardSelector = '.artboard.is-active[data-screen]';
const defaultViewport = {width:1280,height:960};
const allowedEmbeddedProtocols = new Set(['about:', 'blob:', 'data:']);

function conditionsMatch(state, conditions = {}) {
  return Object.entries(conditions).every(([key, value]) => state[key] === value);
}

function interpolate(value, state) {
  return value.replace(/\{\{([\w-]+)\}\}/g, (_, key) => String(state[key]));
}

function normalize(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function screenSelector(screen) {
  return activeBoardSelector + '[data-screen=' + JSON.stringify(screen) + ']';
}

function actionLocator(page, screen, action) {
  const control = '[data-action=' + JSON.stringify(action) + ']';
  return page.locator(screenSelector(screen) + ' .device ' + control + ', #simulation ' + control)
    .and(page.locator(':not([inert], [inert] *)')).filter({visible:true});
}

function findingId(screen, state, ...details) {
  const variables = Object.entries(state).sort(([first], [second]) => first.localeCompare(second));
  return 'playwright/' + JSON.stringify([screen,variables,...details]);
}

function describeFinding(ui, path, labels, steps, details) {
  const {screen, state, action, selector, expectedScreen, title, reason, expected, actual, checkId, requirement} = details;
  const issue = {screen,action,selector,expectedScreen,expected,actual};
  const screenName = (id) => labels.get(id) || id;
  return {
    ...issue,title,reason,checkId,requirement,
    initial:state,
    steps:[ui(`${screenName(path.start)}에서 시작`,`Start on ${screenName(path.start)}`), ...steps.map(step => {
      const destination = step.to && step.to !== step.from ? ' → '+screenName(step.to) : '';
      return screenName(step.from)+' · '+step.label+destination;
    })],
    route:{title,kind:'Playwright',start:path.start,initial:path.initial,steps:[...steps],issue},
  };
}

async function inspectScreen(ui, page, compiled, screen, state, checks) {
  const model = compiled.screens[screen];
  const device = page.locator(screenSelector(screen)+' .device');
  const failures = [];
  const inventory = await page.locator(screenSelector(screen)+' .device, #simulation')
    .locator('[data-action], button:not([data-control]), a[href]:not([data-control]), [role="button"]:not([data-control])')
    .and(page.locator(':not([inert], [inert] *)')).filter({visible:true})
    .evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.action,
      label:(node.getAttribute('aria-label') || node.textContent || node.tagName).trim()})));
  const visibleIds = new Set(inventory.map(control=>control.id));
  const declared = new Set([...model.actions.map(action=>action.id), ...(model.unverifiedActions || [])]);
  const extra = inventory.filter(control=>!declared.has(control.id));
  const inventoryId = findingId(screen,state,'inventory');
  if (extra.length) {
    failures.push({screen,state,action:extra[0].id,checkId:inventoryId,reason:'unplanned-control',
      title:ui('기획에 없는 조작','Unplanned controls'),
      expected:ui('현재 화면의 조작이 기획 목록과 일치해야 해요.','Visible actions should be in the plan.'),
      actual:[...new Set(extra.map(control=>control.label+(control.id?' ('+control.id+')':'')))].join(', ')});
  } else checks.add(inventoryId);
  for (const action of model.actions) {
    const visible = visibleIds.has(action.id);
    const expectedVisible = conditionsMatch(state,action.when);
    const checkId = findingId(screen,state,'control',action.id);
    if (visible !== expectedVisible) {
      failures.push({
        screen,state,action:action.id,checkId,requirement:expectedVisible ? action.requirement : action.hiddenRequirement,
        title:action.label || action.id,
        reason:expectedVisible ? 'missing-control' : 'unexpected-control',
        expected:expectedVisible ? ui('실행 가능한 조작이 화면에 표시되어야 해요.','The available control should be visible.') : ui('이 상태에서는 조작이 숨겨져야 해요.','The control should be hidden in this state.'),
        actual:visible ? ui('실행 조건을 충족하지 않았지만 조작이 표시됐어요.','The control was visible while its conditions were unmet.') : ui('화면에 표시된 조작을 찾지 못했어요.','The visible control could not be found.'),
      });
    } else checks.add(checkId);
  }

  for (const assertion of model.assertions || []) {
    if (!conditionsMatch(state,assertion.when)) continue;
    const {selector, attribute} = assertion;
    const locator = device.locator('css='+selector)
      .and(page.locator(':not([inert], [inert] *)')).filter({visible:true});
    const expected = interpolate(attribute ? assertion.value : assertion.text,state);
    const matches = await locator.all();
    const values = await Promise.all(matches.map(match => attribute ? match.getAttribute(attribute) : match.innerText()));
    const matched = values.some(value => value !== null && (attribute ? value === expected : normalize(value) === normalize(expected)));
    const checkId = findingId(screen,state,'observation',selector,attribute || 'text',expected);
    if (!matched) {
      const noticed = values.map(value => value === null ? ui('속성 없음','Missing attribute') : normalize(value).slice(0,160) || ui('빈 값','Empty'));
      failures.push({
        screen,state,checkId,selector,requirement:assertion.requirement,title:ui('화면 표시 확인 · ','Check screen content · ')+(expected || selector),reason:'wrong-state',
        expected:attribute ? attribute+' · '+expected : expected,
        actual:noticed.length ? noticed.join(' / ') : ui('확인할 화면 내용이 표시되지 않았어요.','The expected screen content was missing.'),
      });
    } else checks.add(checkId);
  }
  return failures;
}

async function activeScreen(page) {
  const boards = page.locator(activeBoardSelector).filter({visible:true});
  return (await boards.count()) === 1 ? await boards.getAttribute('data-screen') : null;
}

async function waitForScreen(page,screen) {
  try {
    await page.locator(screenSelector(screen)+' .device').first().waitFor({state:'visible'});
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error;
    const observed = await activeScreen(page);
    return observed === screen ? null : observed;
  }
  return activeScreen(page);
}

async function actionabilityFailure(ui, control, error) {
  if (/intercepts pointer events/i.test(error.message)) return ui('다른 요소가 조작을 가려서 클릭할 수 없었어요.','Another element blocked the click.');
  if (!await control.isVisible()) return ui('조작이 화면에서 사라졌어요.','The control disappeared.');
  try {
    if (!await control.isEnabled({timeout:300})) return ui('조작이 비활성화되어 클릭할 수 없었어요.','The control was disabled.');
  } catch (statusError) {
    if (!(statusError instanceof errors.TimeoutError)) throw statusError;
  }
  return ui('브라우저에서 조작을 안정적으로 클릭할 수 없었어요.','The browser could not reliably click the control.');
}

async function replayPath(page, compiled, path, finalVariant, checks) {
  const ui = translator(compiled.locale);
  const result = {findings:[],variants:1};
  const visits = [];
  const labels = new Map(Object.entries(compiled.screens).map(([id,screen]) => [id,screen.title || id]));
  const visibleLabels = await page.locator('.artboard[data-screen][aria-label]').evaluateAll(
    (boards) => boards.map(board => [board.dataset.screen,board.getAttribute('aria-label')]),
  );
  for (const [id,label] of visibleLabels) labels.set(id,label);
  const addFinding = (details,step) => {
    result.findings.push(describeFinding(ui,path,labels,[...visits,step],details));
  };
  const observe = async (screen,state) => {
    for (const failure of await inspectScreen(ui,page,compiled,screen,state,checks)) {
      addFinding(failure,{from:screen,action:failure.action,label:failure.title,before:state});
    }
  };

  const entry = await waitForScreen(page,path.start);
  if (entry !== path.start) {
    addFinding({
      screen:path.start,state:path.initial, title:ui('시작 화면 확인','Check entry screen'),reason:'wrong-start',
      expected:labels.get(path.start) || path.start,actual:labels.get(entry) || entry || ui('활성 화면을 하나로 확인하지 못했어요.','Could not identify a single active screen.'),
      checkId:findingId(path.start,path.initial,'entry'),
    },{from:path.start,label:ui('시작 화면 확인','Check entry screen'),before:path.initial});
    return result;
  }
  checks.add(findingId(path.start,path.initial,'entry'));
  await observe(path.start,path.initial);

  for (const [index,step] of path.steps.entries()) {
    const action = compiled.screens[step.from].actions.find(item => item.id === step.action);
    const title = action.label || step.action;
    const controls = actionLocator(page,step.from,step.action);
    const isFinal = index === path.steps.length - 1;
    const count = await controls.count();
    if (isFinal) result.variants = Math.max(count,1);
    if (count === 0) return result; // The state observation already records the missing control.

    const variant = isFinal ? finalVariant : 0;
    const checkId = findingId(step.from,step.before,'click',step.action,step.to,variant);
    if (variant >= count) {
      addFinding({
        screen:step.from,state:step.before,action:step.action,checkId,title,requirement:action.requirement,reason:'missing-control',
        expected:ui('이전 재현에서 확인한 조작이 같은 상태에 표시되어야 해요.','The control from the earlier run should appear in the same state.'),actual:ui('같은 절차로 도달했지만 조작이 표시되지 않았어요.','The same steps reached this screen, but the control was missing.'),
      },{from:step.from,action:step.action,label:title,before:step.before});
      return result;
    }
    const control = controls.nth(variant);
    const controlLabel = await control.getAttribute('aria-label') || normalize(await control.innerText()) || title;
    const selector = count > 1 ? await control.evaluate(node => {
      if (node.matches('.paper-dismiss')) return '.paper-dismiss';
      if (node.closest('.paper-modal-actions')) return '.paper-modal-actions [data-action]';
    }) : undefined;
    const replayStep = {...step,label:controlLabel};
    try {
      await control.click();
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
      addFinding({
        screen:step.from,state:step.before,action:step.action,selector,checkId,title,
        reason:'not-actionable',expected:ui(`사용자가 ‘${controlLabel}’ 조작을 클릭할 수 있어야 해요.`,`The user can click “${controlLabel}”.`),
        actual:await actionabilityFailure(ui,control,error),
      },{from:step.from,action:step.action,label:controlLabel,before:step.before});
      return result;
    }

    const observed = await waitForScreen(page,step.to);
    if (observed !== step.to) {
      const destination = observed === step.from ? undefined : observed;
      const name = labels.get(observed) || observed;
      addFinding({
        screen:step.from,state:step.before,action:step.action,selector,checkId,title,expectedScreen:step.to,
        reason:destination ? 'wrong-destination' : 'missing-transition',
        expected:ui(`${labels.get(step.to) || step.to} 화면으로 이동해야 해요.`,`Opens ${labels.get(step.to) || step.to}.`),
        actual:name ? ui(`${name} 화면이 표시됐어요.`,`Opened ${name}.`) : ui('활성 화면을 하나로 확인하지 못했어요.','Could not identify a single active screen.'),
      },{from:step.from,to:destination,action:step.action,label:controlLabel,before:step.before});
      return result;
    }
    visits.push(replayStep);
    checks.add(checkId);
    await observe(step.to,step.after);
  }
  return result;
}

async function localContext(browser,url,viewport) {
  const context = await browser.newContext({viewport,reducedMotion:'reduce',serviceWorkers:'block'});
  try {
    await context.route(/.*/, route => {
      const requestUrl = new URL(route.request().url());
      return requestUrl.href === url || allowedEmbeddedProtocols.has(requestUrl.protocol) ?
        route.continue() : route.abort('blockedbyclient');
    });
    await context.routeWebSocket(/.*/, socket => socket.close({code:1008,reason:'Local verification only'}));
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function verifyBrowser(htmlPath, compiled, options = {}) {
  const url = pathToFileURL(resolve(htmlPath)).href;
  const viewport = options.viewport || defaultViewport;
  const timeout = options.timeoutMs ?? 1400;
  const traceDir = options.traceDir && resolve(options.traceDir);
  if (traceDir) await mkdir(traceDir,{recursive:true});
  const browser = await chromium.launch({timeout:10000});
  const findings = new Map();
  const checks = new Set();
  let passedCases = 0;
  const paths = [...compiled.cases].sort((a,b) => a.steps.length - b.steps.length);

  async function runVariant(path,index,variant) {
    const context = await localContext(browser,url,viewport);
    try {
      if (traceDir) await context.tracing.start({screenshots:true,snapshots:true});
      const page = await context.newPage();
      page.setDefaultTimeout(timeout);
      await page.goto(url,{waitUntil:'load',timeout:10000});
      const entry = page.locator('.artboard.is-active .overview-hit');
      if (await entry.isVisible()) await entry.click();
      const result = await replayPath(page,compiled,path,variant,checks);
      const fresh = result.findings.filter(finding => !findings.has(finding.checkId));
      if (traceDir) {
        if (fresh.length) {
          const name = 'playwright-'+(index+1)+'-'+(variant+1)+'-'+randomUUID()+'.zip';
          await context.tracing.stop({path:join(traceDir,name)});
          for (const finding of fresh) finding.trace = name;
        } else await context.tracing.stop();
      }
      for (const finding of fresh) {
        if (!findings.has(finding.checkId)) findings.set(finding.checkId,finding);
      }
      return result;
    } finally {
      await context.close();
    }
  }

  try {
    for (const [index,path] of paths.entries()) {
      const first = await runVariant(path,index,0);
      let passed = first.findings.length === 0;
      for (let variant = 1; variant < first.variants; variant++) {
        const other = await runVariant(path,index,variant);
        if (other.findings.length) passed = false;
      }
      if (passed) passedCases++;
    }
  } finally {
    await browser.close();
  }

  return {
    totalCases:paths.length,passedCases,totalStates:compiled.totalStates,
    unverifiedActions:Object.entries(compiled.screens).flatMap(([screen,definition])=>
      (definition.unverifiedActions || []).map(action=>screen+'/'+action)),
    findings:[...findings.values()],passedChecks:[...checks].filter(id => !findings.has(id)),
  };
}

module.exports = {verifyBrowser};
