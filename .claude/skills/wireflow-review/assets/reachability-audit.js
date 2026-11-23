'use strict';

function exploreBrowserFlow(flow,mount,passedChecks) {
  const entries = new Set([flow.start,...(flow.entries || [])]);
  const keys = Object.keys(flow.vars || {}).sort();
  const states = new Map();
  const reached = new Map();
  const queue = [];
  const findings = [];
  const limit = 256;
  const limits = new Set();
  let clicks = 0;

  function discover(current,parent,via) {
    const key = JSON.stringify([current.screen,...keys.map(name=>current.vars[name])]);
    if (states.has(key)) return states.get(key);
    if (states.size===limit) {
      limits.add(ui(`상태 ${limit}개에서 탐색을 멈췄어요.`,`Exploration stopped at the ${limit}-state limit.`));
      return;
    }
    const node = {key,current,parent,via,next:new Set(),previous:new Set(),hasFailure:false};
    states.set(key,node);
    queue.push(node);
    if (!reached.has(current.screen)) reached.set(current.screen,[]);
    reached.get(current.screen).push(node);
    return node;
  }

  function report(node,{title,reason,expected,actual,checkId,step,expectedScreen,cause}) {
    const visits = [];
    let root = node;
    while (root.parent) {
      visits.push(root.via);
      root = root.parent;
    }
    visits.reverse();
    visits.push(step || {from:node.current.screen,label:ui('완료·복귀 경로 확인','Check for completion or return'),before:node.current.vars});
    const screen = node.current.screen;
    const action = step?.action;
    const issue = {screen,action,expectedScreen,expected,actual};
    const route = {title,kind:ui('시작점 탐색','Entry-point exploration'),start:root.current.screen,initial:root.current.vars,steps:visits,issue};
    const steps = [ui(`${auditScreenName(route.start)}에서 시작`,`Start on ${auditScreenName(route.start)}`),...visits.map(visit=>
      auditScreenName(visit.from)+' · '+visit.label+(visit.to && visit.to!==visit.from?' → '+auditScreenName(visit.to):''))];
    findings.push({...issue,title,reason,steps,initial:node.current.vars,checkId,cause,route});
    node.hasFailure = true;
  }

  for (const screen of entries) discover({screen,vars:{...flow.vars}});
  for (const node of queue) {
    const {screen,vars} = node.current;
    const actions = new Map(screens.get(screen).actions.map(action=>[action.id,action]));
    const surface = ()=>renderAuditSurface({screen,vars:{...vars}});
    const inventory = screenSurface=>mount(screenSurface,()=>renderedAuditControls(screenSurface));
    let controls;
    try {
      controls = inventory(surface());
    } catch {
      limits.add(ui('화면을 렌더링하지 못한 상태가 있어요.','Some states could not be rendered.'));
      report(node,{title:ui('화면을 구성하지 못했어요.','The screen failed to render.'),reason:'render-error',
        expected:ui('화면과 조작이 표시됩니다.','The screen and its controls should be visible.'),actual:ui('실제로 도달한 상태에서 화면을 표시하지 못했어요.','The screen could not be rendered in a reachable state.'),
        checkId:JSON.stringify(['explore-render',node.key]),step:{from:screen,label:ui('화면 표시 확인','Check that the screen is visible'),before:vars}});
      continue;
    }
    passedChecks.add(JSON.stringify(['explore-render',node.key]));
    if (controls.some(control=>!control.action && control.field && control.field!=='details')) {
      limits.add(ui('별도로 입력해야 하는 폼 값은 시작점 탐색에서 다루지 않았어요.','Entry-point exploration did not enter custom form values.'));
    }

    const visible = new Set(controls.map(control=>control.action));
    for (const action of actions.values()) {
      if (!Wireflow.available(action,vars)) continue;
      const checkId = JSON.stringify(['explore-control',node.key,action.id]);
      if (visible.has(action.id)) passedChecks.add(checkId);
      else report(node,{title:action.label,reason:'missing-control',checkId,expectedScreen:action.to,
        expected:ui('실행 조건을 충족하면 조작이 표시돼야 해요.','The control should appear when its conditions are satisfied.'),actual:ui('도달한 상태에서 실행할 조작을 찾지 못했어요.','The control was missing in the reached state.'),
        step:{from:screen,action:action.id,label:ui(`‘${action.label}’ 조작 찾기`,`Find “${action.label}”`),before:vars}});
    }
    for (const control of controls.filter(item=>item.action)) {
      const action = actions.get(control.action);
      const step = {from:screen,action:control.action,label:ui(`‘${control.label}’ 누르기`,`Click “${control.label}”`),before:vars};
      const checkId = JSON.stringify(['explore-click',node.key,control.key]);
      let result;
      try {
        const current = {screen,vars:{...vars}};
        const screenSurface = renderAuditSurface(current);
        result = mount(screenSurface,()=>{
          const rendered = renderedAuditControls(screenSurface).find(item=>item.key===control.key);
          if (!rendered) return;
          clicks++;
          return clickForAudit(current,rendered.control);
        });
      } catch {
        limits.add(ui('실행 결과를 얻지 못한 조작이 있어요.','Some actions did not return a result.'));
      }
      const next = result?.session;
      if (next) {
        Object.assign(step,{to:next.screen,after:next.vars});
        const destination = discover(next,node,step);
        if (destination) {
          node.next.add(destination);
          destination.previous.add(node);
        }
      }
      if (next && next.screen===action?.to) {
        passedChecks.add(checkId);
        passedChecks.add(JSON.stringify(['explore-condition',screen,control.action]));
        continue;
      }
      if (result?.blocked && action?.validate) {
        limits.add(ui('필수 입력으로 막힌 조작의 다른 입력값은 별도 검사에서 확인해야 해요.','Test other input values for actions blocked by required fields separately.'));
        continue;
      }
      report(node,{title:action?.label || control.label,reason:next?'wrong-destination':'missing-transition',
        expectedScreen:action?.to,cause:result?.errorCode,checkId,step,
        expected:action?.to ? ui(`${auditScreenName(action.to)}에 도달해야 해요.`,`Opens ${auditScreenName(action.to)}.`) : ui('실행할 수 있는 목적지가 있어야 해요.','The action should have a reachable destination.'),
        actual:next ? auditScreenName(next.screen) : result?.error || ui('화면 이동이나 상태 변화가 일어나지 않았어요.','The screen and state stayed the same.')});
    }
  }

  if (!limits.size) {
    for (const [screen,nodes] of reached) {
      for (const action of screens.get(screen).actions.filter(item=>Object.keys(item.when || {}).length)) {
        const checkId = JSON.stringify(['explore-condition',screen,action.id]);
        if (nodes.some(node=>Wireflow.available(action,node.current.vars))) continue;
        const conditions = Object.entries(action.when);
        const matching = node=>conditions.filter(([key,value])=>node.current.vars[key]===value).length;
        const node = nodes.reduce((closest,item)=>matching(item)>matching(closest)?item:closest);
        const actual = Object.fromEntries(conditions.map(([key])=>[key,node.current.vars[key]]));
        report(node,{title:action.label+ui(' · 실행 조건 미충족',' · Conditions unmet'),reason:'unreachable-condition',
          checkId,expectedScreen:action.to,expected:ui('실행 조건 · ','Required conditions · ')+auditValues(action.when)+
            (screens.has(action.to)?' → '+auditScreenName(action.to):''),
          actual:ui(`도달한 상태 ${nodes.length}개에서 조건이 충족되지 않았어요. 재현 상태 · ${auditValues(actual)}`,
            `The conditions were unmet in all ${nodes.length} reached states. Reproduced with · ${auditValues(actual)}`),
          step:{from:screen,action:action.id,label:ui(`‘${action.label}’ 실행 조건 확인`,`Check conditions for “${action.label}”`),before:node.current.vars}});
      }
    }

    const exits = queue.filter(node=>entries.has(node.current.screen) || screens.get(node.current.screen).end);
    const escapable = new Set(exits);
    for (const node of exits) for (const previous of node.previous) {
      if (escapable.has(previous)) continue;
      escapable.add(previous);
      exits.push(previous);
    }
    // Reuse the first concrete failure when it already explains a state with no exit.
    // A choice can enable an exit after several transitions within the entry screen.
    const canLeave = new Set(queue.filter(node=>entries.has(node.current.screen) &&
      [...node.next].some(next=>next.current.screen!==node.current.screen && escapable.has(next))));
    for (const node of canLeave) {
      for (const previous of node.previous) {
        if (previous.current.screen===node.current.screen) canLeave.add(previous);
      }
    }
    const stalled = queue.filter(node=>!screens.get(node.current.screen).end &&
      (!escapable.has(node) || (entries.has(node.current.screen) && !canLeave.has(node))));
    const stalledSet = new Set(stalled);
    const explained = new Set();
    function explain(start) {
      const pending = [start];
      for (const node of pending) {
        if (explained.has(node) || !stalledSet.has(node)) continue;
        explained.add(node);
        pending.push(...node.previous);
      }
    }
    for (const node of stalled.filter(item=>item.hasFailure)) explain(node);
    const reportExit = node=> {
      if (explained.has(node)) return;
      report(node,{title:ui('완료·복귀 경로 없음','No completion or return path'),reason:'no-exit',
        checkId:JSON.stringify(['explore-exit',node.key]),
        expected:ui('완료하거나 진입 화면으로 돌아갈 수 있어야 해요.','The flow should finish or return to the entry screen.'),
        actual:ui('이 상태에서 완료나 복귀로 이어지는 조작을 찾지 못했어요. ','No action in this state leads to completion or return. ')+auditValues(node.current.vars)});
      explain(node);
    };
    for (const node of stalled.filter(item=>[...item.next].every(next=>next===item))) reportExit(node);
    for (const node of stalled) reportExit(node);
    for (const node of queue) {
      if (!stalledSet.has(node)) passedChecks.add(JSON.stringify(['explore-exit',node.key]));
    }
  }

  return {findings,screens:reached.size,states:states.size,clicks,limits:[...limits]};
}
