'use strict';

const Wireflow = (() => {
  const maxArtboardDimension = 8192;
  const identifier = /^[a-z][a-z0-9-]*$/;
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isScalar = value => typeof value === 'boolean' || typeof value === 'string' || Number.isFinite(value);
  const screensById = model => new Map(model.screens.map(screen => [screen.id, screen]));
  const entryPoints = model => new Set([model.start, ...(model.entries || [])]);

  function requireValue(condition, message) {
    if (!condition) throw new Error(message);
  }

  function validateFields(fields, vars, path, mode) {
    if (fields === undefined) return;
    requireValue(isObject(fields), `${path} must be an object`);
    for (const [key, value] of Object.entries(fields)) {
      requireValue(Object.hasOwn(vars, key), `${path}.${key} is not declared in vars`);
      requireValue(mode === 'inc' ? Number.isFinite(value) && Number.isFinite(vars[key]) :
        isScalar(value) && typeof value === typeof vars[key], `${path}.${key} has an invalid type`);
    }
  }

  function validateAction(action, vars, path) {
    requireValue(action && identifier.test(action.id || '') && typeof action.label === 'string' && action.label.trim(),
      `${path} needs a valid id and label`);
    requireValue(action.to === null || typeof action.to === 'string' && identifier.test(action.to),
      `${path}.to must be a screen ID or null`);
    requireValue(action.kind === undefined || ['primary','secondary','inline','choice','simulation','back','close','tab'].includes(action.kind),
      `${path}/${action.id} has an unknown action kind`);
    for (const mode of ['when', 'set', 'inc']) validateFields(action[mode], vars, `${path}.${mode}`, mode);
    requireValue(action.validate === undefined || typeof action.validate === 'boolean', `${path}.validate must be boolean`);
  }

  function validateBlock(block, vars, path) {
    requireValue(isObject(block), `${path} has an invalid layout block`);
    const text = key => typeof block[key] === 'string';
    const state = type => text('field') && Object.hasOwn(vars, block.field) && typeof vars[block.field] === type;
    const options = Array.isArray(block.options) && block.options.length > 0 &&
      block.options.every(option => typeof option === 'string') && block.options.includes(vars[block.field]);
    const valid =
      (block.type === 'visual' && text('label') && (block.symbol === undefined || text('symbol')) &&
        (block.aspect === undefined || ['wide','landscape','square','portrait'].includes(block.aspect))) ||
      (block.type === 'rows' && Array.isArray(block.rows) && block.rows.every(row =>
        row && typeof row.label === 'string' && typeof row.value === 'string')) ||
      (block.type === 'search' && text('placeholder') && (block.value === undefined || text('value')) &&
        (block.field === undefined || state('string'))) ||
      (['text', 'notice'].includes(block.type) && text('label')) ||
      (block.type === 'accordion' && text('label') && text('copy')) ||
      (block.type === 'input' && text('label') && state('string') &&
        (block.inputType === undefined || ['text', 'email', 'tel', 'url', 'textarea'].includes(block.inputType))) ||
      (['select', 'radio'].includes(block.type) && text('label') && state('string') && options) ||
      (['toggle', 'checkbox'].includes(block.type) && text('label') && state('boolean'));
    requireValue(valid, `${path} has an invalid layout block`);
  }

  function validateModel(model) {
    requireValue(isObject(model) && typeof model.title === 'string' && model.title.trim() &&
      typeof model.goal === 'string' && model.goal.trim(), 'A title and goal are required');
    requireValue(model.device === undefined || ['mobile','watch','tablet','desktop'].includes(model.device), 'Unknown device preset');
    requireValue(Array.isArray(model.stages) && model.stages.length > 0 &&
      model.stages.every(stage => typeof stage === 'string' && stage.trim()), 'stages must contain labels');
    requireValue(Array.isArray(model.screens) && model.screens.length > 0, 'At least one screen is required');
    requireValue(model.id === undefined || (typeof model.id === 'string' && identifier.test(model.id)),
      'Flow ID must use lowercase letters, numbers, and hyphens');
    requireValue(model.review === undefined || isObject(model.review), 'review must be an object');
    requireValue(model.review?.locale === undefined || ['ko','en'].includes(model.review.locale),
      'review.locale must be ko or en');
    requireValue(model.review?.audit?.explore === undefined || typeof model.review.audit.explore === 'boolean',
      'review.audit.explore must be a boolean');
    if (model.review?.groupDirection !== undefined) {
      requireValue(['vertical','horizontal'].includes(model.review.groupDirection),
        'review.groupDirection must be vertical or horizontal');
    }
    if (model.review?.artboard !== undefined) {
      const {width,height} = model.review.artboard || {};
      requireValue([width,height].every(value => Number.isInteger(value) && value > 0 && value <= maxArtboardDimension),
        `Artboard dimensions must be integers between 1 and ${maxArtboardDimension}`);
    }
    for (const key of ['entries', 'scenarios', 'proposals', 'decisions']) {
      requireValue(model[key] === undefined || Array.isArray(model[key]), `${key} must be an array`);
    }
    const vars = model.vars ?? {};
    requireValue(isObject(vars) && Object.values(vars).every(isScalar), 'vars must contain scalar values');
    const ids = new Set();
    const numbers = new Set();
    if (model.images !== undefined) {
      requireValue(isObject(model.images) && Object.entries(model.images).every(([id,data]) =>
        identifier.test(id) && typeof data==='string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(data)),
      'images must contain named, embedded PNG, JPEG or WebP images');
    }
    for (const screen of model.screens) {
      requireValue(screen && identifier.test(screen.id || '') && !ids.has(screen.id), 'Screen IDs must be valid and unique');
      ids.add(screen.id);
      requireValue(typeof screen.title === 'string' && screen.title.trim() && Array.isArray(screen.actions),
        `${screen.id} requires a title and actions array`);
      requireValue(Number.isInteger(screen.stage) && screen.stage >= 0 && screen.stage < model.stages.length,
        `${screen.id}.stage must reference a stage`);
      requireValue(['source', 'inferred'].includes(screen.origin), `${screen.id}.origin must be source or inferred`);
      requireValue(screen.brief === undefined || (typeof screen.brief === 'string' && screen.brief.trim()),
        `${screen.id}.brief must contain the screen's planning context`);
      requireValue(screen.end === undefined || typeof screen.end === 'boolean', `${screen.id}.end must be boolean`);
      const blocks = screen.ui?.blocks || [];
      const renderedText = [screen.body,screen.detail,screen.ui?.heading];
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (!isObject(block)) continue;
          renderedText.push(block.label,block.symbol,block.value,block.copy,block.placeholder);
          if (Array.isArray(block.rows)) for (const row of block.rows) renderedText.push(row?.label,row?.value);
        }
      }
      for (const text of renderedText) {
        if (typeof text !== 'string') continue;
        for (const [,key] of text.matchAll(/{{([^{}]+)}}/g)) {
          requireValue(Object.hasOwn(vars,key), `${screen.id}: undeclared text variable ${key}`);
        }
      }
      if (screen.number !== undefined) {
        requireValue(typeof screen.number === 'string' && screen.number.trim() && !numbers.has(screen.number),
          `${screen.id}.number must be a unique screen number`);
        numbers.add(screen.number);
      }
      validateFields(screen.preview, vars, `${screen.id}.preview`, 'set');
      if (screen.ui !== undefined) {
        const ui = screen.ui;
        requireValue(isObject(ui) && (ui.bar === undefined || typeof ui.bar === 'string') &&
          (ui.heading === undefined || typeof ui.heading === 'string') &&
          (ui.choiceLabel === undefined || typeof ui.choiceLabel === 'string') &&
          (ui.blocks === undefined || Array.isArray(ui.blocks)), `${screen.id}.ui has an invalid layout`);
        requireValue(ui.layout === undefined || (ui.layout==='split' && blocks[0]?.type==='visual'),
          `${screen.id}: split layout needs a leading visual`);
        for (const block of ui.blocks || []) {
          validateBlock(block, vars, `${screen.id}.ui`);
          requireValue(block.image===undefined || (block.type==='visual' && typeof block.image==='string' &&
            Object.hasOwn(model.images || {},block.image)), `${screen.id}: unknown visual image`);
        }
      }
      const actions = new Set();
      for (const action of screen.actions) {
        validateAction(action, vars, screen.id);
        requireValue(!actions.has(action.id), `Duplicate action ${screen.id}/${action.id}`);
        actions.add(action.id);
      }
      const placed = new Set();
      for (const block of blocks) {
        if (block.hotspots === undefined) continue;
        requireValue(block.type==='visual' && Array.isArray(block.hotspots), `${screen.id}: hotspots need a visual block`);
        for (const spot of block.hotspots) {
          const action = screen.actions.find(item=>item.id===spot?.action);
          requireValue(action && !placed.has(action.id) && [undefined,'primary','secondary','inline'].includes(action.kind),
            `${screen.id}: a hotspot must reference a unique in-app button`);
          requireValue([spot.x,spot.y,spot.width,spot.height].every(Number.isFinite) &&
            spot.x>=0 && spot.y>=0 && spot.width>0 && spot.height>0 &&
            spot.x+spot.width<=100 && spot.y+spot.height<=100, `${screen.id}: hotspot must fit in the image (0–100%)`);
          placed.add(action.id);
        }
      }
    }
    for (const screen of model.screens) {
      const overlay = screen.ui?.overlay;
      requireValue(overlay === undefined || (ids.has(overlay) && overlay!==screen.id), `${screen.id}.ui.overlay must reference another screen`);
    }
    for (const entry of entryPoints(model)) requireValue(ids.has(entry), `Unknown entry: ${entry}`);
    const scenarioIds = new Set();
    for (const scenario of model.scenarios || []) {
      requireValue(scenario && identifier.test(scenario.id || '') && !scenarioIds.has(scenario.id) &&
        typeof scenario.title === 'string' && scenario.title.trim() &&
        Array.isArray(scenario.steps) && scenario.steps.length > 0 && ids.has(scenario.start ?? model.start),
      'Each scenario needs a unique ID, title, valid start, and steps');
      scenarioIds.add(scenario.id);
      validateFields(scenario.initial, vars, `${scenario.id}.initial`, 'set');
      for (const step of scenario.steps) {
        requireValue(step && identifier.test(step.action || '') && (step.screen === undefined || ids.has(step.screen)),
          `${scenario.id} has an invalid action or expected screen`);
        requireValue(step.hint === undefined || (typeof step.hint === 'string' && step.hint.trim()),
          `${scenario.id}.hint must contain a manual step instruction`);
        validateFields(step.vars, vars, `${scenario.id}.vars`, 'when');
      }
    }
    const proposalIds = new Set();
    for (const proposal of model.proposals || []) {
      requireValue(proposal && identifier.test(proposal.id || '') && !proposalIds.has(proposal.id) &&
        typeof proposal.title === 'string' && proposal.title.trim() && typeof proposal.reason === 'string' &&
        Array.isArray(proposal.changes) && proposal.changes.length > 0,
      'Each proposal needs a unique ID, title, reason, and changes');
      proposalIds.add(proposal.id);
      for (const change of proposal.changes) {
        requireValue(change && ids.has(change.screen), `${proposal.id} references an unknown screen`);
        validateAction(change.action, vars, `${proposal.id}/${change.screen}`);
        requireValue(ids.has(change.action.to), `${proposal.id} must link to an existing screen`);
      }
    }
    for (const decision of model.decisions || []) {
      requireValue(decision && ids.has(decision.screen) && typeof decision.question === 'string' && decision.question.trim(),
        'Each decision needs a valid screen and question');
    }
    const requirements = model.review?.requirements;
    requireValue(requirements === undefined || Array.isArray(requirements), 'review.requirements must be an array');
    const requirementIds = new Set();
    for (const item of requirements || []) {
      requireValue(isObject(item) && identifier.test(item.id || '') && !requirementIds.has(item.id) &&
        ids.has(item.screen) && ['title','group','expected'].every(key=>typeof item[key]==='string' && item[key].trim()) &&
        (item.action === undefined || (typeof item.action==='string' && identifier.test(item.action))),
      'Each review requirement needs a unique ID, screen, group, title, and expected behavior');
      requireValue(item.origin === undefined || ['source','inferred'].includes(item.origin),
        item.id+'.origin must be source or inferred');
      requireValue(item.suggestedScreens === undefined || (Array.isArray(item.suggestedScreens) &&
        item.suggestedScreens.every(id=>ids.has(id)) && new Set(item.suggestedScreens).size===item.suggestedScreens.length),
        item.id+'.suggestedScreens must reference distinct screens');
      requirementIds.add(item.id);
    }
    for (const test of [...(model.review?.audit?.journeys || []),...(model.review?.audit?.recovery || [])]) {
      requireValue(test.start === undefined || ids.has(test.start), 'Unknown browser check start: '+test.start);
      for (const step of test.steps || []) {
        requireValue(step.requirement === undefined || requirementIds.has(step.requirement),
          'The browser check references an unknown requirement: '+step.requirement);
      }
    }
    return model;
  }

  function available(action, vars) {
    return Object.entries(action.when || {}).every(([key, value]) => vars[key] === value);
  }

  function act(screens, session, actionId, text = korean => korean) {
    const current = screens.get(session.screen);
    const action = current?.actions.find(item => item.id === actionId);
    if (!action || !available(action, session.vars)) {
      const label = action?.label || actionId;
      return { errorCode: 'unavailable-action',
        error: text(`이 상태에서는 ‘${label}’ 동작을 실행할 수 없어요.`,`“${label}” is unavailable in this state.`) };
    }
    if (!action.to || !screens.has(action.to)) {
      const destination = action.to ? ` (${action.to})` : '';
      return { errorCode: 'missing-link',
        error: text(`‘${action.label}’의 연결이 끊겼어요${destination}. 검토에서 개선안을 확인하세요.`,
          `“${action.label}” has a broken link${destination}. Review the connection.`) };
    }
    const vars = { ...session.vars, ...action.set };
    for (const [key, amount] of Object.entries(action.inc || {})) vars[key] += amount;
    return { session: { screen: action.to, vars }, action };
  }

  function visit(start, neighbors) {
    const found = new Set(start);
    const pending = [...start];
    while (pending.length) {
      for (const next of neighbors.get(pending.pop()) || []) {
        if (found.has(next)) continue;
        found.add(next);
        pending.push(next);
      }
    }
    return found;
  }

  function check(model, text = korean => korean) {
    const screens = screensById(model);
    const entries = entryPoints(model);
    const findings = [];
    const graph = new Map(model.screens.map(screen => [screen.id, new Set()]));
    const incoming = new Map(model.screens.map(screen => [screen.id, new Set()]));
    const exits = new Set(entries);
    for (const screen of model.screens) {
      if (screen.end) exits.add(screen.id);
      for (const action of screen.actions) {
        if (!screens.has(action.to)) {
          findings.push({ id: `link/${screen.id}/${action.id}`, code: 'missing-link', screen: screen.id, action: action.id,
            message: text(`‘${screen.title}’의 ‘${action.label}’ ${action.to ? `대상 ‘${action.to}’ 화면이 없어요` : '목적지가 비어 있어요'}.`,
              `“${action.label}” on “${screen.title}” ${action.to ? `points to a missing screen (${action.to})` : 'has no destination'}.`) });
          continue;
        }
        graph.get(screen.id).add(action.to);
        incoming.get(action.to).add(screen.id);
      }
    }
    const reachable = visit(entries, graph);
    const canExit = visit(exits, incoming);
    for (const screen of model.screens) {
      if (!reachable.has(screen.id)) {
        findings.push({ id: `unreachable/${screen.id}`, code: 'unreachable', screen: screen.id,
          message: text(`시작점에서 ‘${screen.title}’에 도달하는 연결이 없어요.`,`No entry point leads to “${screen.title}”.`) });
      }
      const forward = [...graph.get(screen.id)].some(next => next !== screen.id && canExit.has(next));
      if (!screen.end && (entries.has(screen.id) ? !forward : !canExit.has(screen.id))) {
        findings.push({ id: `exit/${screen.id}`, code: 'no-exit', screen: screen.id,
          message: text(`‘${screen.title}’에서 완료 또는 복귀로 이어지는 경로가 없어요.`,`“${screen.title}” has no path to completion or return.`) });
      }
    }
    const scenarios = (model.scenarios || []).map(scenario => {
      let session = { screen: scenario.start ?? model.start, vars: { ...model.vars, ...scenario.initial } };
      const trace = [session.screen];
      for (const [index, step] of scenario.steps.entries()) {
        const previous = session.screen;
        const result = act(screens, session, step.action, text);
        if (result.session) {
          session = result.session;
          trace.push(session.screen);
        }
        const wrongScreen = step.screen !== undefined && step.screen !== session.screen;
        const wrongValue = Object.entries(step.vars || {}).find(([key, value]) => session.vars[key] !== value);
        const error = result.error || (wrongScreen ?
          text(`예상 화면: ${step.screen} · 현재 화면: ${session.screen}`,`Expected screen: ${step.screen} · Current screen: ${session.screen}`) :
          wrongValue ? text(`예상 ${wrongValue[0]}: ${wrongValue[1]} · 현재: ${session.vars[wrongValue[0]]}`,
            `Expected ${wrongValue[0]}: ${wrongValue[1]} · Current: ${session.vars[wrongValue[0]]}`) : '');
        if (!error) continue;
        const message = text(`${scenario.title} · ${index + 1}단계: ${error}`,`${scenario.title} · Step ${index + 1}: ${error}`);
        findings.push({ id: `scenario/${scenario.id}`, code: 'scenario-failed', screen: previous,
          action: step.action, stepIndex: index, cause: result.errorCode, message });
        return { id: scenario.id, title: scenario.title, passed: false, trace, message };
      }
      return { id: scenario.id, title: scenario.title, passed: true, trace };
    });
    return { findings, scenarios };
  }

  function applyProposals(model, selected) {
    const remaining = [...(model.proposals || [])];
    const replacements = new Map();
    for (const id of new Set(selected)) {
      const index = remaining.findIndex(proposal => proposal.id === id);
      requireValue(index >= 0, `Unknown proposal: ${id}`);
      const [proposal] = remaining.splice(index, 1);
      for (const { screen, action } of proposal.changes) {
        if (!replacements.has(screen)) replacements.set(screen, new Map());
        const actions = replacements.get(screen);
        const key = `${screen}/${action.id}`;
        requireValue(!actions.has(action.id), `같은 동작을 바꾸는 개선안이 겹쳐요: ${key}`);
        actions.set(action.id, action);
      }
    }
    const screens = model.screens.map(screen => {
      const replacement = replacements.get(screen.id);
      if (!replacement) return screen;
      const actions = new Map(screen.actions.map(action => [action.id, action]));
      for (const [id, action] of replacement) actions.set(id, action);
      return { ...screen, actions: [...actions.values()] };
    });
    return { ...model, screens, proposals: remaining };
  }

  return { maxArtboardDimension, validateModel, screensById, available, act, check, applyProposals };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Wireflow;
