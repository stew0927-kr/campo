'use strict';

let verificationFlow;

function modelVerificationRoute(test) {
  const start = test.start ?? model.start;
  let current = {screen:start,vars:{...model.vars,...test.initial}};
  const route = {title:test.title,kind:ui('모델 검사','Model check'),start,initial:current.vars,steps:[]};
  for (const step of test.steps) {
    const action = screens.get(current.screen).actions.find(item=>item.id===step.action);
    const result = Wireflow.act(screens,current,step.action,ui);
    const next = result.session;
    route.steps.push({from:current.screen,to:next?.screen,action:step.action,
      label:action?.label || step.action,before:current.vars,after:next?.vars});
    const wrongValues = next && Object.entries(step.vars || {}).some(([key,value])=>next.vars[key]!==value);
    if (!next || (step.screen && step.screen!==next.screen) || wrongValues) {
      route.issue = {screen:current.screen,action:step.action,expectedScreen:step.screen,
        expected:[auditScreenName(step.screen || action?.to),auditValues(step.vars || {})].filter(Boolean).join(' · '),
        actual:next ? [auditScreenName(next.screen),auditValues(Object.fromEntries(
          Object.keys(step.vars || {}).map(key=>[key,next.vars[key]])))].filter(Boolean).join(' · ') : result.error};
      break;
    }
    current = next;
  }
  return route;
}

function verificationForFinding(finding) {
  if (finding.route) return finding.route;
  const start = finding.code==='unreachable' ? model.start : finding.screen;
  const initial = finding.initial || {...model.vars,...screens.get(start).preview};
  return {title:finding.code==='missing-link'?ui('연결 누락 경로','Missing connection'):finding.title,kind:finding.code?ui('연결 구조','Navigation structure'):ui('화면 조작','Screen interaction'),start,initial,
    issue:{screen:finding.screen,action:finding.action,field:finding.field,expectedScreen:finding.expectedScreen,
      expected:finding.expected,actual:finding.actual},
    steps:[{from:finding.screen,to:finding.actualScreen,label:finding.title,action:finding.action}],
  };
}

function verificationBadges(route) {
  const badges = new Map([[route.start,[ui('시작','Start')]]]);
  route.steps.forEach((step,index)=>{
    if (step.from && !badges.has(step.from)) badges.set(step.from,[]);
    const id = step.to || step.from;
    const values = badges.get(id) || [];
    values.push(String(index+1).padStart(2,'0'));
    badges.set(id,values);
  });
  if (route.issue) {
    const labels = badges.get(route.issue.screen) || [];
    badges.set(route.issue.screen,[...labels,ui('문제','Issue')]);
  }
  return badges;
}

function verificationEdges(route) {
  const highlighted = new Map();
  for (const [index,step] of route.steps.entries()) {
    if (!step.to || step.to===step.from) continue;
    const key = connectionKey(step.from,step.to);
    const entry = highlighted.get(key) || {targets:new Set(),failed:false,steps:[]};
    entry.steps.push({...step,number:index+1,failed:Boolean(route.issue && index===route.steps.length-1)});
    entry.targets.add(step.to);
    if (route.issue && index===route.steps.length-1) entry.failed = true;
    highlighted.set(key,entry);
  }
  return highlighted;
}

function syncVerificationBoards() {
  const current = verificationFlow;
  const issue = current?.route.issue;
  for (const [id,board] of artboards) {
    const badges = current?.badges.get(id);
    const failed = issue?.screen===id;
    const expected = issue?.expectedScreen===id && !failed;
    board.classList.toggle('verification-path',Boolean(badges));
    board.classList.toggle('verification-issue',failed);
    board.classList.toggle('verification-expected',expected);
    board.querySelector('.verification-steps')?.remove();
    if (badges?.length || expected) {
      const labels = [...(badges || [])];
      if (expected) {
        const suggested = model.review.requirements?.some(item=>item.screen===issue.screen && item.action===issue.action && item.suggestedScreens?.includes(id));
        labels.push(suggested ? ui('AI 제안 (미확정)','AI proposal (unconfirmed)') :
          screens.get(id).origin==='inferred' ? ui('AI 추정 화면','AI-inferred screen') : ui('더미 기대','Expected in mockup'));
      }
      board.append(element('span','verification-steps',labels.join(' · ')));
    }
  }
}

function selectVerificationStep(index,centerScreen=true) {
  const current = verificationFlow;
  const {route} = current;
  const step = route.steps[index-1];
  const failure = route.issue && index===route.steps.length && step;
  const id = failure ? route.issue.screen : step?.to || step?.from || route.start;
  const variables = index===0 ? route.initial : failure ? step.before : step?.after || step?.before;
  if (variables) current.snapshots.set(id,variables);
  current.index = index;
  for (const [i,button] of [...$('flow-steps').querySelectorAll('button')].entries()) {
    if (i===index) button.setAttribute('aria-current','step');
    else button.removeAttribute('aria-current');
  }
  $('flow-step-detail').textContent = step ?
    auditScreenName(step.from)+' · '+step.label+(step.to ? ' → '+auditScreenName(step.to) : '') :
    ui(`${auditScreenName(route.start)}에서 검증 시작`,`Start on ${auditScreenName(route.start)}`);
  select(id);
  if (centerScreen) center(true,true);
}

function verificationBounds() {
  const {route} = verificationFlow;
  const ids = new Set([route.start,route.issue?.screen,route.issue?.expectedScreen,
    ...route.steps.flatMap(step=>[step.from,step.to])]);
  const frames = [...ids].filter(id=>artboards.has(id)).map(id=>{
    const board = artboards.get(id);
    const {x,y} = position(id);
    const label = board.querySelector('.verification-steps');
    return {x,y,left:x+Math.min(0,label?.offsetLeft ?? 0),
      width:Math.max(screenWidth,board.querySelector('.screen-heading').offsetWidth)};
  });
  return {
    left:Math.min(...frames.map(frame=>frame.left)),
    right:Math.max(...frames.map(frame=>frame.x+frame.width)),
    top:Math.min(...frames.map(frame=>frame.y))-82,
    bottom:Math.max(...frames.map(frame=>frame.y))+screenHeight,
  };
}

function visibleCanvasFrame(contentWidth,contentHeight) {
  const view = canvas.getBoundingClientRect();
  const base = {left:14,top:14,right:view.width-14,bottom:view.height-14};
  const panel = document.querySelector('.review-sidebar').getBoundingClientRect();
  const available = panel.bottom>view.top+base.top && panel.right>view.left+base.left ?
    [{...base,left:panel.right-view.left+14},{...base,top:panel.bottom-view.top+14}] : [base];
  let best = {...base,scale:0};
  for (const frame of available) {
    const scale = Math.min((frame.right-frame.left)/contentWidth,(frame.bottom-frame.top)/contentHeight);
    if (scale>best.scale) best = {...frame,scale};
  }
  return best;
}

function fitVerificationPath() {
  const {left,right,top,bottom} = verificationBounds();
  const frame = visibleCanvasFrame(right-left,bottom-top);
  const scale = Math.min(.83,Math.max(.001,frame.scale));
  centeredSize = {width:canvas.clientWidth,height:canvas.clientHeight};
  fittingOverview = false;
  verificationFlow.fitted = true;
  moveCamera({x:(frame.left+frame.right-(left+right)*scale)/2,
    y:(frame.top+frame.bottom-(top+bottom)*scale)/2},scale);
}

function openVerificationFlow(route, {inspectEnd = false,keepFocus = false} = {}) {
  if (layoutEditing) setLayoutEditing(false);
  const previous = verificationFlow?.previous || {fittingOverview,zoom,offset,active,device:selectedDevice};
  closeRequestEditor();
  const snapshots = new Map([[route.start,route.initial]]);
  for (const {from,to,before,after} of route.steps) {
    if (before && !snapshots.has(from)) snapshots.set(from,before);
    if (after && !snapshots.has(to)) snapshots.set(to,after);
  }
  verificationFlow = {route,previous,snapshots,badges:verificationBadges(route),edges:verificationEdges(route)};
  $('route-picker').hidden = true;
  $('route-warning').hidden = true;
  renderScenarioGuide();
  const flowPanel = $('verification-flow');
  const inReview = !$('review').hidden;
  if (inReview) $('review').before(flowPanel);
  else $('scenario-guide').after(flowPanel);
  flowPanel.hidden = false;
  flowPanel.toggleAttribute('data-issue',Boolean(route.issue));
  flowPanel.toggleAttribute('data-panel-route',inReview);
  $('flow-status').textContent = route.issue ? ui('검증 필요','Needs review') : ui('통과','Pass');
  $('flow-title').textContent = route.title+' · '+route.kind;
  $('flow-issue').hidden = !route.issue;
  const planning = route.issue ? findingPlanning(route.issue) : [];
  $('flow-planning').replaceChildren(...evidenceNodes(planning));
  $('flow-planning').hidden = !planning.length;
  if (route.issue) {
    $('flow-expected').textContent = route.issue.expected;
    $('flow-actual').textContent = route.issue.actual;
  }
  const labels = [ui('시작 · ','Start · ')+auditScreenName(route.start),...route.steps.map((step,index)=>
    String(index+1).padStart(2,'0')+' · '+(route.issue && index===route.steps.length-1 ?
      auditScreenName(route.issue.screen) : auditScreenName(step.to || step.from)))];
  $('flow-steps').replaceChildren(...labels.map((label,index)=>{
    const control = button(label,'tool',()=>selectVerificationStep(index));
    if (route.issue && index===route.steps.length && index>0) control.setAttribute('data-failed','');
    return write(element('li'),control);
  }));
  canvas.setAttribute('data-verification','');
  closeRequestEditor();
  closeDescription();
  for (const id of artboards.keys()) renderBoard(id);
  syncVerificationBoards();
  selectVerificationStep(route.issue || inspectEnd ? route.steps.length : 0,false);
  fitVerificationPath();
  const selected = $('flow-steps').querySelector('[aria-current="step"]');
  if (!keepFocus) selected.focus({preventScroll:true});
  $('flow-steps').scrollLeft = Math.max(0,selected.offsetLeft-$('flow-steps').offsetLeft-10);
}

function closeVerificationFlow(restoreFocus = true, keepScreen = false) {
  if (!verificationFlow) return;
  const {previous} = verificationFlow;
  verificationFlow = undefined;
  $('route-picker').hidden = $('route-picker').options.length===1;
  updateScreenNotes();
  $('verification-flow').hidden = true;
  $('scenario-guide').after($('verification-flow'));
  canvas.removeAttribute('data-verification');
  closeRequestEditor();
  closeDescription();
  select(keepScreen ? active : previous.active);
  for (const id of artboards.keys()) renderBoard(id);
  syncVerificationBoards();
  if (keepScreen) focusWithNeighbors();
  else if (previous.device===selectedDevice) {
    slide = undefined;
    zoom = previous.zoom ?? fitZoom();
    fittingOverview = previous.fittingOverview;
    offset = previous.offset;
    placeWorld();
  } else center();
  if (restoreFocus) $('review-open').focus({preventScroll:true});
}
