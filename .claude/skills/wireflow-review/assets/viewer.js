'use strict';

const $ = id => document.getElementById(id);
const inputModel = Wireflow.validateModel(JSON.parse($('flow-data').textContent));
const original = {...inputModel,review:inputModel.review || {},scenarios:inputModel.scenarios || [],decisions:inputModel.decisions || []};
const {flowPath,verification:buildVerification} = JSON.parse($('build-data').textContent);
const workshop = original.review.renderer === 'workshop';
const flowIdentity = original.id || original.title;
const legacyWorkshop = workshop && !original.id;
const storagePrefix = legacyWorkshop ? 'ui-wire-flow-workshop' : 'ui-wire-flow:'+JSON.stringify([location.pathname,flowIdentity]);
const storageKey = storagePrefix+'-requests';
const layoutKey = storagePrefix+'-layout';
const artboards = new Map();
const screenIssues = new Map();
const defaultPlacement = defaultCanvasPlacement(original);
const publishedLayout = {...defaultPlacement,numbers:defaultScreenNumbers(original,defaultPlacement.groups)};
const layout = {...publishedLayout};
let experimentalLayout;
let layoutEditing = false;
let previousPlacement;
let numberPreview = [];
const devicePresets = [
  ...(original.review.artboard ? [{id:'compact', kind:original.device || 'mobile', ...original.review.artboard}] : []),
  {id:'mobile', kind:'mobile', width:390, height:844},
  {id:'mobile-large', kind:'mobile', width:430, height:932},
  {id:'tablet-portrait', kind:'tablet', width:768, height:1024},
  {id:'tablet-landscape', kind:'tablet', width:1024, height:768},
  {id:'watch', kind:'watch', width:198, height:242},
  ...(!workshop ? [{id:'desktop', kind:'desktop', width:1280, height:800}] : []),
];
const defaultDevice = original.review.artboard ? devicePresets[0] :
  devicePresets.find(preset=>preset.kind===original.device) || devicePresets[0];
let selectedDevice = defaultDevice;
let customDevice;
let {width:screenWidth,height:screenHeight} = defaultDevice;
let trace = [];
let traversals = [];
let focusedStep;
const screenToolsWidth = 78;
const touches = new Map();
let pinch;
let systemPinch;
const pitch = { x: screenWidth + 140, y: screenHeight + 164 };
let previews = new Map();
let model = original;
let screens = Wireflow.screensById(model);
let session = newSession(model.start);
let active = session.screen;
let edges;
let paintConnections;
let cameraFrame;
let slide;
let appliedProposals = new Set();
let testRun;
let scenarioRun;
let overviewRoute;
let zoom;
let fittingOverview = false;
let offset = { x: 0, y: 0 };
let centeredSize;
let drag;
let cancelClick = false;
let deferredSelect;
let message = '';
let auditRun;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const savedRequests = {...readRequestState(),copyChoices:new Map()};
let {requests,drafts,copyChoices} = savedRequests;
let editingRequest;
let requestHighlight;
$('sample-name').textContent = original.title;
document.title = 'XU Wireflow Review | '+original.title;
$('review-source').textContent = original.review.source || original.source || '';
$('manual-review').hidden = !original.scenarios.length;
$('test-mode').hidden = !original.review.audit?.testMode;
$('screen-tools').style.setProperty('--screen-tools-width',screenToolsWidth+'px');

function element(tag, classes, text) {
  const node = document.createElement(tag);
  if (classes) node.className = classes;
  if (text) node.textContent = text;
  return node;
}

function button(text, classes, run) {
  const node = element('button', classes, text);
  node.type = 'button';
  node.addEventListener('click', run);
  return node;
}

function write(node, ...children) {
  node.append(...children.filter(Boolean));
  return node;
}

function readRequestState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    const legacyMemos = saved || !legacyWorkshop ? {} : JSON.parse(localStorage.getItem('ui-wire-flow-workshop-memos') || '{}');
    return {
      requests: (saved?.requests || []).filter(request=>screens.has(request.screen)).map(request=>{
        // Relabel the generated expected/actual pair in older issue reports; keep personal notes.
        if (request.issueKey && !request.planning && typeof request.text==='string') {
          request.text = request.text.replace(/^기대 결과 — (.+)(?=\n실제 결과 — )/m,'더미 검사 기준 — $1')
            .replace(/^Expected — (.+)(?=\nActual — )/m,'Expected in mockup — $1');
        }
        return request;
      }),
      drafts: new Map(Object.entries(saved?.drafts || legacyMemos)),
    };
  } catch {
    return {requests:[],drafts:new Map()};
  }
}

function persistRequests() {
  if (testRun) return;
  try {
    localStorage.setItem(storageKey,JSON.stringify({requests,drafts:Object.fromEntries(drafts)}));
  } catch {
    // Storage may be unavailable for a standalone HTML file.
  }
}

function newSession(id, initial) {
  return { screen: id, vars: { ...model.vars, ...initial } };
}

function context(id) {
  const verified = verificationFlow?.snapshots.get(id);
  if (verified) return newSession(id,verified);
  if (session.screen === id) return session;
  if (!previews.has(id)) previews.set(id,newSession(id,screens.get(id).preview));
  return previews.get(id);
}

function position(id) {
  const {x,y} = layout.positions.get(id);
  return {x:x*pitch.x,y:y*pitch.y};
}

const screenNumber = id => layout.numbers.get(id);

function fitZoom() {
  const {clientWidth:w, clientHeight:h} = $('canvas');
  const fitted = Math.min(1, Math.max(1,w-30)/screenWidth, Math.max(1,h-105)/screenHeight);
  return (w-screenWidth*fitted)/2 >= screenToolsWidth+16 ? fitted :
    Math.min(fitted,Math.max(1,h-190)/screenHeight);
}

function positionInspector() {
  const tools = $('screen-tools');
  const {x,y} = position(active);
  const left = offset.x+x*zoom;
  const top = offset.y+y*zoom;
  const right = left+screenWidth*zoom;
  const bottom = top+screenHeight*zoom;
  const {width,height} = centeredSize;
  const above = left<screenToolsWidth+16 && top>=89;
  let xAnchor = Math.max(8,Math.min(width-screenToolsWidth-8,above ? left : left-screenToolsWidth-8));
  let yAnchor = Math.max(8,Math.min(height-76,above ? top-89 : top));
  if (!$('review').hidden) {
    const panel = $('review').closest('.review-sidebar').getBoundingClientRect();
    const view = canvas.getBoundingClientRect();
    const beside = panel.right-view.left+8;
    const below = panel.bottom-view.top+8;
    if (xAnchor<beside && yAnchor<below) {
      if (beside+screenToolsWidth<=width) xAnchor = beside;
      else yAnchor = Math.min(height-76,below);
    }
  }
  tools.hidden = layoutEditing || fittingOverview || right<=0 || left>=width || bottom<=0 || top>=height;
  tools.style.left = xAnchor+'px';
  tools.style.top = yAnchor+'px';
  for (const [panelId,triggerId] of [['request-editor','request-open'],['screen-description','description-open']]) {
    const panel = $(panelId);
    if (panel.hidden) continue;
    panel.style.visibility = tools.hidden ? 'hidden' : '';
    const rightSpace = width-xAnchor-screenToolsWidth-16;
    const useLeft = xAnchor>=288 || xAnchor-16>rightSpace;
    const panelWidth = Math.min(272,Math.max(1,useLeft ? xAnchor-16 : rightSpace));
    panel.style.width = panelWidth+'px';
    panel.style.maxHeight = Math.max(1,height-16)+'px';
    panel.style.left = (useLeft ? xAnchor-panelWidth-8 : xAnchor+screenToolsWidth+8)+'px';
    const y = yAnchor+$(triggerId).offsetTop;
    panel.style.top = canvas.offsetTop+Math.max(8,Math.min(y,height-panel.offsetHeight-8))+'px';
  }
}

function placeWorld() {
  cameraFrame ??= requestAnimationFrame(renderCamera);
}

function renderCamera(now) {
  cameraFrame = undefined;
  if (slide) {
    const {from,to,duration,fromZoom,toZoom} = slide;
    // Keep a delayed frame, such as after a native picker closes, from skipping the slide.
    slide.elapsed += Math.min(48,Math.max(0,now-slide.lastFrame));
    slide.lastFrame = now;
    const progress = reducedMotion.matches ? 1 : Math.min(1,slide.elapsed/duration);
    const eased = progress*progress*(3-2*progress);
    offset = {x:from.x+(to.x-from.x)*eased, y:from.y+(to.y-from.y)*eased};
    zoom = fromZoom+(toZoom-fromZoom)*eased;
    if (progress===1) slide = undefined;
  }
  const keepDragging = trackLayoutDrag(now);
  const transform = 'translate(' + offset.x + 'px,' + offset.y + 'px) scale(' + zoom + ')';
  canvas.toggleAttribute('data-overview',fittingOverview);
  canvas.style.setProperty('--screen-label-size',Math.min(52,Math.max(16,11/zoom))+'px');
  canvas.style.setProperty('--group-title-size',Math.min(64,Math.max(23,14/zoom))+'px');
  canvas.style.setProperty('--route-ring',Math.max(3,2/zoom)+'px');
  $('world').style.transform = transform;
  $('groups').style.transform = transform;
  positionInspector();
  $('zoom-readout').textContent = Math.round(zoom * 100) + '%';
  if (!canvas.hasAttribute('data-layout-moving')) {
    paintConnections(edges,focusedStep,offset,zoom,layoutEditing ? undefined : verificationFlow?.edges ?? overviewRoute?.edges);
  }
  if (slide || keepDragging) placeWorld();
}

function moveCamera(to,toZoom,animate = false) {
  const distance = Math.hypot(to.x-offset.x,to.y-offset.y);
  const canSlide = animate && !reducedMotion.matches && zoom!==undefined;
  if (canSlide && (distance>=1 || Math.abs(toZoom-zoom)>.001)) {
    const duration = Math.min(740,Math.max(340,250+distance*.22));
    slide = {from:offset,to,fromZoom:zoom,toZoom,lastFrame:performance.now(),elapsed:0,duration};
  } else {
    slide = undefined;
    offset = to;
    zoom = toZoom;
  }
  placeWorld();
}

function center(animate = false, fit = false) {
  const {clientWidth:width,clientHeight:height} = canvas;
  centeredSize = {width,height};
  const p = position(active);
  const reviewing = verificationFlow || !$('review').hidden;
  const frame = reviewing ? visibleCanvasFrame(screenWidth+100,screenHeight+82) : {left:0,right:width,top:0,bottom:height};
  const next = fit || zoom === undefined ? reviewing && frame.scale ? Math.min(1,frame.scale) : fitZoom() : slide?.toZoom ?? zoom;
  fittingOverview = false;
  if (verificationFlow) verificationFlow.fitted = false;
  moveCamera({x:(frame.left+frame.right)/2-(p.x+screenWidth/2)*next,
    y:(frame.top+frame.bottom)/2-(p.y+screenHeight/2)*next},next,animate);
}

function zoomAt(factor,point,target = point) {
  const current = zoom ?? fitZoom();
  const minimum = Math.min(.005,current);
  const next = Math.min(1.75,Math.max(minimum,current*factor));
  slide = undefined;
  fittingOverview = false;
  if (verificationFlow) verificationFlow.fitted = false;
  const ratio = next/current;
  offset = {x:target.x-(point.x-offset.x)*ratio,y:target.y-(point.y-offset.y)*ratio};
  zoom = next;
  placeWorld();
}

function changeZoom(factor) {
  const {width,height} = centeredSize;
  if (!verificationFlow) return zoomAt(factor,{x:width/2,y:height/2});
  const {left,right,top,bottom} = verificationBounds();
  const frame = visibleCanvasFrame(right-left,bottom-top);
  zoomAt(factor,{x:(frame.left+frame.right)/2,y:(frame.top+frame.bottom)/2});
}

function addEdge(from,to) {
  if (!screens.has(to)) return;
  const key=connectionKey(from,to);
  if (!edges.has(key)) edges.set(key,new Set());
  edges.get(key).add(to);
}

function collectEdges() {
  edges = new Map();
  for (const screen of model.screens) for (const action of screen.actions) addEdge(screen.id,action.to);
  for (const {from,to} of traversals) addEdge(from,to);
  refreshOverviewRoute();
}

function record(from,to,label,error='') {
  const step = {from,to,label,error};
  trace.push(step);
  if (to) {
    traversals.push(step);
    addEdge(from,to);
    focusedStep = step;
  }
}

function markRouteControls(device,id) {
  const route = verificationFlow?.route || overviewRoute;
  for (const node of device.querySelectorAll('[data-route-control]')) {
    node.removeAttribute('data-route-control');
    node.removeAttribute('data-route-failed');
  }
  if (!route) return;
  const steps = route.steps.filter(step => step.from===id);
  for (const control of device.querySelectorAll('[data-action], [data-control]')) {
    const inert = control.closest('[inert]');
    if (inert && inert!==device) continue;
    const match = steps.find(step => (step.action && step.action===control.dataset.action) ||
      (step.field && step.field===control.dataset.control));
    if (!match) continue;
    control.dataset.routeControl = String(route.steps.indexOf(match)+1);
    const issue = route.issue;
    control.toggleAttribute('data-route-failed',Boolean(issue?.screen===id &&
      ((issue.action && issue.action===control.dataset.action) || (issue.field && issue.field===control.dataset.control))));
  }
}

function populateRoutePicker() {
  const picker = $('route-picker');
  picker.replaceChildren(new Option(ui('전체 연결','All connections'),''));
  for (const scenario of model.scenarios) picker.add(new Option(scenario.title,scenario.id));
  if (!model.scenarios.length) {
    for (const screen of model.screens) {
      if (!screen.actions.length) continue;
      const options = element('optgroup');
      options.label = screen.title;
      for (const action of screen.actions) options.append(new Option(action.label,screen.id+'/'+action.id));
      picker.append(options);
    }
  }
  picker.hidden = picker.options.length===1;
}

function routeProposals() {
  const issue = overviewRoute?.issue;
  if (testRun) return [];
  if (issue?.screen!==active) return (model.proposals || []).filter(p=>!appliedProposals.has(p.id) && p.changes.some(c=>c.screen===active));
  const scenarioFinding = 'scenario/'+$('route-picker').value;
  return (model.proposals || []).filter(proposal=>proposal.finding===scenarioFinding ||
    proposal.changes.some(change=>change.screen===issue.screen && change.action.id===issue.action));
}

function openRouteProposals() {
  const dialog = $('route-proposals');
  const choices = routeProposals();
  if (!choices.length) return;
  $('route-proposals-title').textContent = ui('개선안 · ','Proposed fixes · ')+auditScreenName(active);
  $('route-proposal-error').textContent = '';
  $('route-proposal-list').replaceChildren(...choices.map(proposal=>{
    const control = button(ui('개선안 적용','Apply fix'),'tool primary',()=>{
      if (applyReview(proposal.id)) {
        dialog.close();
        artboards.get(active).querySelector('.screen-label').focus({preventScroll:true});
      } else {
        $('route-proposal-error').textContent = $('review-request-status').textContent;
      }
    });
    control.dataset.proposal = proposal.id;
    control.setAttribute('aria-label',control.textContent+' · '+proposal.title);
    return write(element('section'),element('h3','',proposal.title),element('p','',proposal.reason),control);
  }));
  dialog.showModal();
}

function refreshOverviewRoute() {
  const value = $('route-picker').value;
  let scenario = model.scenarios.find(item => item.id===value);
  if (!scenario && value.includes('/')) {
    const [start,action] = value.split('/');
    scenario = {start,initial:screens.get(start).preview,steps:[{action}]};
  }
  overviewRoute = scenario ? modelVerificationRoute(scenario) : undefined;
  if (overviewRoute) overviewRoute.edges = verificationEdges(overviewRoute);
  updateScreenNotes();
  markRouteControls($('simulation'),active);
  for (const [id,board] of artboards) {
    const device = board.querySelector('.device');
    if (device) markRouteControls(device,id);
  }
}

function updateScreenNotes() {
  const issue = overviewRoute?.issue;
  const onPathIssue = issue?.screen===active;
  const choices = routeProposals();
  const broken = screens.get(active)?.actions.find(action=>!screens.has(action.to));
  const warning = $('route-warning');
  warning.hidden = Boolean(verificationFlow) || !(onPathIssue || broken || choices.length);
  $('route-proposals-open').hidden = !choices.length;
  const action = onPathIssue && screens.get(active).actions.find(item=>item.id===issue.action) || broken;
  $('route-stop').textContent = (onPathIssue || broken ? ui('경로 확인 필요 · ','Path needs review · ') :
    ui('개선 제안 · ','Proposed change · ')) + (action?.label || auditScreenName(active));
  const policy = $('screen-decisions');
  const questions = model.decisions.filter(item=>item.screen===active).map(item=>item.question);
  policy.hidden = !questions.length || Boolean(verificationFlow);
  policy.textContent = questions.length ? ui('기획 미정 · ','Open decision · ')+questions.join(' ') : '';
}

function renderBoard(id) {
  const board = artboards.get(id);
  const screen = screens.get(id);
  const isActive = id === active;
  board.classList.toggle('is-active',isActive);
  if (isActive) board.setAttribute('aria-current','true');
  else board.removeAttribute('aria-current');
  renderBoardLabel(id);
  const device = mobile(screen,context(id));
  const issue = verificationFlow?.route.issue;
  if (issue?.screen===id && (issue.action || issue.field)) {
    for (const control of device.querySelectorAll('[data-action], [data-control]')) {
      const matches = issue.action ? control.dataset.action===issue.action : control.dataset.control===issue.field;
      if (matches && !control.closest('[inert]') && (!issue.selector || control.matches(issue.selector))) {
        control.setAttribute('data-verification-control','');
      }
    }
  }
  markRouteControls(device,id);
  device.inert = layoutEditing || Boolean(verificationFlow);
  board.querySelector('.device')?.remove();
  board.append(device);
}

function renderBoardLabel(id) {
  const board = artboards.get(id);
  const screen = screens.get(id);
  const number = screenNumber(id);
  const label = write(button('', 'screen-label', () => select(id)),element('span','',number),screen.title);
  label.dataset.layoutScreen = id;
  board.setAttribute('aria-label',number+' '+screen.title);
  const heading = write(element('div','screen-heading'),label);
  const count = screenIssues.get(id)?.length;
  if (count) {
    const badge = button(ui('검증 필요 ','Needs review ')+count,'screen-issue-badge',()=>openScreenIssues(id));
    badge.setAttribute('aria-label',number+' '+screen.title+ui(' · 검증 필요 ',' · Needs review ')+count);
    badge.setAttribute('aria-controls','review');
    heading.append(badge);
  }
  const suggested = model.review.requirements?.some(item=>item.suggestedScreens?.includes(id));
  if (suggested) heading.append(element('span','suggested-screen',ui('미확정','Proposed')));
  board.toggleAttribute('data-suggested-screen',Boolean(suggested));
  const old = board.querySelector('.screen-heading');
  if (old) old.replaceWith(heading);
  else board.prepend(heading);
}

function select(id, takeFocus = false) {
  const old = active;
  if (active !== id) {
    message = '';
    closeRequestEditor();
    closeDescription();
  }
  if (focusedStep?.to !== id) focusedStep = undefined;
  active = id;
  syncScreenTools();
  if (old !== id) renderBoard(old);
  renderBoard(id);
  renderSimulation();
  renderScenarioGuide();
  updateScreenNotes();
  if (layoutEditing && fittingOverview) placeWorld();
  else if (fittingOverview && !verificationFlow) focusWithNeighbors();
  else center(true);
  if (takeFocus) {
    const board = artboards.get(id);
    const popup = !layoutEditing && board.querySelector('.paper-modal .paper-dismiss');
    (popup || board.querySelector('.screen-label')).focus({preventScroll:true});
  }
}

function focusWithNeighbors() {
  const p = position(active);
  fittingOverview = false;
  canvas.removeAttribute('data-overview');
  const w = canvas.clientWidth, h = canvas.clientHeight;
  centeredSize = {width:w,height:h};
  const peers = [...artboards.keys()].filter(id=>id!==active).map(position);
  // Prefer the closest screen along the same row or column and leave a quarter visible.
  const neighbors = peers.filter(q=>q.x===p.x || q.y===p.y)
    .sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
  const q = neighbors[0];
  const dx = q && q.y===p.y ? q.x-p.x : 0;
  const dy = q && q.x===p.x ? q.y-p.y : 0;
  const extraX = dx ? Math.min(screenWidth,Math.max(0,Math.abs(dx)-screenWidth)+screenWidth*.25) : 0;
  const extraY = dy ? Math.min(screenHeight,Math.max(0,Math.abs(dy)-screenHeight)+screenHeight*.25) : 0;
  // Both sides of the selected screen stay equally visible when the camera stops.
  const scale = Math.max(.005,Math.min(.94,.70*w/screenWidth,.70*h/screenHeight,
    w/(screenWidth+2*extraX),h/(screenHeight+2*extraY)));
  moveCamera({x:w/2-(p.x+screenWidth/2)*scale,
    y:h/2-(p.y+screenHeight/2)*scale},scale,true);
}

function syncScreenTools() {
  const screen = screens.get(active);
  const name = screenNumber(active)+' '+screen.title;
  $('request-open').setAttribute('aria-label',name+ui(' 수정 요청',' · Request a change'));
  $('description-open').setAttribute('aria-label',name+ui(' 기획 근거',' · Design rationale'));
  $('request-title').textContent = name;
  $('screen-picker').value = active;
}

function act(screen, id, updates, guard) {
  if (guard && !guard()) {
    const blocked = {blocked:true,error:ui('필수 입력을 확인해 주세요.','Check the required fields.')};
    if (auditRun) auditRun.result = {...blocked,error:ui('필수 입력 확인에서 멈췄어요.','A required field blocked the action.')};
    else {
      trackScenarioAction(screen.id,id,blocked);
      renderScenarioGuide();
    }
    return;
  }
  const current = auditRun?.current ?? context(screen.id);
  const result = Wireflow.act(screens,{...current,vars:{...current.vars,...updates}},id,ui);
  if (auditRun) {
    auditRun.result = result;
    return;
  }
  trackScenarioAction(screen.id,id,result);
  if (result.error) {
    select(screen.id);
    message = result.error;
    record(screen.id,null,screen.actions.find(action=>action.id===id)?.label,result.error);
    renderBoard(screen.id);
    renderScenarioGuide();
    return;
  }
  const previous = session.screen;
  previews.set(previous,session);
  previews.set(screen.id,current);
  session = result.session;
  if (previous!==active && previous!==session.screen) renderBoard(previous);
  record(screen.id,session.screen,result.action.label);
  select(session.screen,true);
}

function icon(name, size) {
  const node = element('span','paper-icon');
  node.dataset.icon = name;
  if (size) node.dataset.size = size;
  node.setAttribute('aria-hidden','true');
  return node;
}

function paperButton(label, run, variant='outline', size='medium') {
  const control = button(label,'paper-button',run);
  control.dataset.variant = variant;
  control.dataset.size = size;
  return control;
}

function actionButton(screen, id, variant, size, options={}) {
  const action = screen.actions.find(item=>item.id===id);
  const run = ()=>act(screen,id,options.updates,options.guard);
  const control = paperButton(action?.label ?? ui('연결 확인 필요','Check connection'),run,variant,size);
  control.dataset.action = id;
  return control;
}

function closeButton(screen, action = screen.actions.find(item=>item.kind==='close') ?? {id:'close',label:ui('팝업 닫기','Close dialog')}) {
  const control = write(button('','paper-dismiss',()=>act(screen,action.id)),icon('close'));
  control.setAttribute('aria-label',action.label);
  control.dataset.action = action.id;
  return control;
}

function intro(title, copy, eyebrow) {
  return write(element('header','app-intro'),
    eyebrow && element('p','paper-caption eyebrow',eyebrow),
    element('h2','paper-h1',title),copy && element('p','lead',copy));
}

function badge(text, variant, mark) {
  const node = write(element('span','paper-badge'),mark && icon(mark),text);
  if (variant) node.dataset.variant = variant;
  return node;
}

function tileImage(label, {aspect,classes = '',symbol} = {}) {
  const guide = label.trim() || ui('이미지 설명 필요','Image description needed');
  const content = element('span','paper-image-guide');
  if (symbol) content.append(symbol+' ');
  content.append(guide);
  const placeholder = write(element('div',['paper-image',classes].filter(Boolean).join(' ')),content);
  placeholder.setAttribute('role','img');
  placeholder.setAttribute('aria-label',guide);
  if (aspect) placeholder.dataset.aspect = aspect;
  return placeholder;
}

function rows(...pairs) {
  return write(element('dl','info-rows'),...pairs.map(([key,value])=>
    write(element('div','paper-navigation'),element('dt','paper-caption',key),element('dd','',value))));
}

function faq(title, copy) {
  return write(element('details','paper-accordion'),element('summary','',title),element('p','paper-caption',copy));
}

function choice(label, role, checked, change, field, name) {
  const input = element('input',role==='switch'?'paper-switch':role==='radio'?'paper-radio':'paper-check');
  input.type = role==='radio'?'radio':'checkbox';
  input.checked = checked;
  input.dataset.control = field;
  if (name) input.name = name;
  if (role==='switch') input.setAttribute('role','switch');
  input.addEventListener('change',()=>change(input.checked));
  return write(element('label','paper-choice'),input,element('span','',label));
}

function radioGroup(label, options, selected, change, name, field) {
  return write(element('fieldset','paper-choice-group'),element('legend','paper-control-title',label),
    ...options.map(value=>{
      const choiceRow = choice(value,'radio',value===selected,checked=>{ if (checked) change(value); },field,name);
      choiceRow.firstChild.value = value;
      return choiceRow;
    }));
}

function picker(label, options, selected, change, field) {
  const select = element('select','paper-field');
  select.dataset.control = field;
  const wrap = element('span','paper-select');
  wrap.dataset.width = 'full';
  for (const value of options) {
    const option = element('option','',value);
    option.value = value;
    select.append(option);
  }
  select.value = selected;
  select.addEventListener('change',()=>change(select.value));
  return write(element('label','paper-field-label'),element('span','paper-caption',label),write(wrap,select));
}

function simulationControls(screen,vars = context(screen.id).vars) {
  return screen.actions.filter(action=>action.kind==='simulation' && (workshop || Wireflow.available(action,vars))).map(action=>{
    const control = button(action.label,'tool',()=>act(screen,action.id));
    control.dataset.action = action.id;
    return control;
  });
}

function renderSimulation() {
  const panel = $('simulation');
  const controls = verificationFlow ? [] : simulationControls(screens.get(active));
  panel.replaceChildren(...(controls.length?[element('span','caption',ui('모의 입력','Simulation')),...controls]:[]));
  panel.hidden = !controls.length;
  markRouteControls(panel,active);
}

function trackScenarioAction(from,id,result) {
  const run = scenarioRun;
  const step = run?.route.steps[run.index];
  if (!step || verificationFlow || from!==session.screen) return;
  run.problem = '';
  if (from!==run.screen || id!==step.action) return;
  if (result.error) {
    run.problem = result.error;
    return;
  }
  const reached = result.session;
  if (step.screen && step.screen!==reached.screen) {
    run.problem = ui(`${auditScreenName(step.screen)}에 도착해야 하지만 ${auditScreenName(reached.screen)}이 열렸어요.`,
      `Expected ${auditScreenName(step.screen)}, but ${auditScreenName(reached.screen)} opened.`);
    return;
  }
  if (!Wireflow.available({when:step.vars},reached.vars)) {
    const actual = Object.fromEntries(Object.keys(step.vars).map(key=>[key,reached.vars[key]]));
    run.problem = ui('기대 · ','Expected · ')+auditValues(step.vars)+ui(' / 실제 · ',' / Actual · ')+auditValues(actual);
    return;
  }
  run.index++;
  run.screen = reached.screen;
}

function renderScenarioGuide() {
  const panel = $('scenario-guide');
  const run = scenarioRun;
  for (const control of document.querySelectorAll('[data-scenario-next]')) control.removeAttribute('data-scenario-next');
  panel.hidden = !run || Boolean(verificationFlow) || layoutEditing;
  if (panel.hidden) return;
  const {route,index,screen,problem} = run;
  const step = route.steps[index];
  const name = auditScreenName(screen);
  const atStep = screen===session.screen;
  const inspectingAnotherScreen = atStep && active!==screen;
  $('scenario-title').textContent = run.title;
  $('scenario-progress').textContent = step ?
    ui(`${index+1}/${route.steps.length}단계`,`Step ${index+1}/${route.steps.length}`) :
    ui(`완료 · ${index}/${route.steps.length}단계`,`Complete · ${index}/${route.steps.length}`);
  panel.toggleAttribute('data-complete',!step);
  $('scenario-return').hidden = !step || !inspectingAnotherScreen;
  let instruction = ui('최종 화면 · ','Final screen · ')+name;
  if (step) {
    if (inspectingAnotherScreen) instruction = ui(`${name}에서 이어갈 수 있어요.`,`Resume from ${name}.`);
    else if (!atStep) instruction = ui(`${name}으로 돌아가거나 처음부터 다시 시작할 수 있어요.`,`Return to ${name} or start over.`);
    else {
      const action = screens.get(screen).actions.find(item=>item.id===step.action);
      if (action) {
        instruction = step.hint || ui((action.kind==='simulation' ? '하단 모의 입력에서 ' : '')+`‘${action.label}’ 누르기`,
          `Choose “${action.label}”${action.kind==='simulation' ? ' in the simulation controls below' : ''}.`);
        const source = action.kind==='simulation' ? $('simulation') : artboards.get(screen);
        for (const control of source.querySelectorAll('[data-action="'+action.id+'"]')) {
          if (!control.disabled && !control.closest('[hidden],[inert]')) control.setAttribute('data-scenario-next','');
        }
      } else instruction = ui(`${name}에서 이 단계에 필요한 조작을 찾을 수 없어요.`,`The control for this step is missing from ${name}.`);
    }
  }
  const copy = [problem,instruction].filter(Boolean).join(' ');
  if ($('scenario-instruction').textContent!==copy) $('scenario-instruction').textContent = copy;
}

function runScenario(route,title = route.title) {
  if (layoutEditing) setLayoutEditing(false);
  closeVerificationFlow();
  const previous = session.screen;
  session = newSession(route.start || model.start,route.initial);
  scenarioRun = {route,title,screen:session.screen,index:0,problem:''};
  focusedStep = undefined;
  previews.clear();
  if (previous !== active) renderBoard(previous);
  message = '';
  if (!$('review').hidden) setReviewOpen(false);
  select(session.screen,true);

}

function renderManualScenarios() {
  const samples = original.review.samples || original.scenarios.map(route=>({
    route:route.id,title:route.title,task:route.task,check:route.check,
  }));
  const tasks = [];
  for (const sample of samples) {
    const route = model.scenarios.find(item=>item.id===sample.route);
    if (!route) continue;
    tasks.push(write(element('section','sample-task'),
      element('h3','',sample.title),
      element('p','',sample.task),
      element('p','task-check',sample.check),
      button(ui('체험 시작','Start scenario'),'tool soft',()=>runScenario(route,sample.title))));
  }
  $('sample-tasks').replaceChildren(...tasks);
}

function renderTrace() {
  const label = id => {
    const screen=screens.get(id);
    return screenNumber(id)+' '+screen.title;
  };
  $('trace-summary').textContent = trace.length?ui('직접 눌러 이동한 순서예요. 가장 최근에 실행한 화면 간 연결은 캔버스에 분홍색 실선으로 표시돼요.','This records the screens you visited. The latest transition is shown in solid pink.'):
    ui('화면 안에서 버튼을 눌러 이동하면 여기에 순서가 기록돼요.','Navigate using the mockup to record your path here.');
  $('trace-list').replaceChildren(...trace.slice().reverse().map(step=>{
    const route = label(step.from)+(step.to?' → '+label(step.to):ui(' · 이동 막힘',' · Navigation blocked'));
    return write(element('li',step===focusedStep?'recent':''),
      element('strong','',route),element('p','',step.label),step.error?element('p','trace-error',step.error):null);
  }));
}

function graphReviewFinding(finding,report) {
  const start = auditScreenName(finding.screen);
  const action = screens.get(finding.screen).actions.find(item=>item.id===finding.action);
  const steps = [ui(`${start} 열기`,`Open ${start}`)];
  let expected = ui('완료하든지 이전 단계로 돌아갈 수 있어야 해요.','You should be able to finish or return to the previous step.');
  let route;
  if (finding.code==='missing-link') {
    expected = ui('조작에 실행 가능한 목적지가 있어야 해요.','The control needs a reachable destination.');
    if (action) steps.push(ui(`‘${action.label}’ 누르기`,`Click “${action.label}”`));
  } else if (finding.code==='unreachable') {
    expected = ui(`진입점에서 ${start}에 도달할 수 있어야 해요.`,`An entry point should lead to ${start}.`);
    steps.splice(0,1,...[model.start,...(model.entries || [])].map(id=>ui(`${auditScreenName(id)}에서 진입 경로 확인`,`Check the path from ${auditScreenName(id)}`)));
  } else if (finding.code==='scenario-failed') {
    const test = model.scenarios.find(item=>'scenario/'+item.id===finding.id);
    const run = report.scenarios.find(item=>item.id===test?.id);
    const step = test?.steps[finding.stepIndex];
    if (test) route = modelVerificationRoute(test);
    expected = step?.screen ? auditScreenName(step.screen)+' · '+(auditValues(step.vars || {}) || ui('기획 단계 도달','Expected step reached')) : ui('시나리오에서 정의한 화면과 상태를 기대합니다.','The screen and state should match the scenario.');
    if (run) steps.splice(0,1,...run.trace.map(id=>auditScreenName(id)));
    if (action) steps.push(ui(`${start}에서 ‘${action.label}’ 누르기`,`Click “${action.label}” on ${start}`));
  }
  return {...finding,checkId:'graph/'+finding.id,title:action?.label || ui('경로 확인','Check path'),steps,expected,actual:finding.message,route,
    expectedScreen:finding.code==='missing-link' && screens.has(action?.to) ? action.to : undefined};
}

const isMissingLink = finding => finding.code==='missing-link' || finding.cause==='missing-link';

function canonicalRequestKey(key) {
  if (!key) return key;
  try {
    const [screen,action,reason] = JSON.parse(key);
    if (reason==='missing-link') return JSON.stringify([screen,action,'missing-transition',null]);
  } catch {
    // Preserve keys from older or imported requests that use a different format.
  }
  return key;
}

function reproductionKey(route) {
  const steps = route.steps.filter(step=>step.action || step.field)
    .map(({from,to,action,field,after})=>[from,to,action,field,after]);
  return JSON.stringify([route.kind===ui('연결 구조','Navigation structure'),route.start,route.initial,steps]);
}

function groupReviewFindings(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const missingLink = isMissingLink(finding);
    const reason = missingLink ? 'missing-transition' : finding.reason || finding.code;
    const details = reason==='wrong-destination' ? finding.expectedScreen :
      reason==='wrong-state' ? [...(finding.fields || (finding.field ? [finding.field] : []))].sort() :
      reason==='missing-transition' && !missingLink ? finding.cause || 'no-transition' : null;
    const subject = finding.action || finding.field || (reason==='no-exit'?ui('경로 확인','Check path'):(reason==='wrong-state' && finding.selector) || finding.title);
    const key = JSON.stringify([finding.screen,subject,reason,details]);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(finding);
  }
  const rank = {'Playwright':6,'XState':5,[ui('시작점 탐색','Entry-point exploration')]:4,[ui('전체 여정','End-to-end journey')]:3,
    [ui('브라우저 조작','Browser interaction')]:2,[ui('모델 검사','Model check')]:1};
  return [...groups].map(([key,items])=>{
    const ranked = items.sort((a,b)=>(rank[b.route?.kind] || 0)-(rank[a.route?.kind] || 0) ||
      (b.route?.steps.length || 0)-(a.route?.steps.length || 0));
    const [primary,...others] = ranked;
    const route = verificationForFinding(primary);
    const routeKey = isMissingLink(primary) || rank[primary.route?.kind]>=4 ? reproductionKey : item=>item.title;
    const routes = new Map([[routeKey(route),route]]);
    for (const item of others.filter(item=>item.route || item.code==='missing-link')) {
      const alternative = verificationForFinding(item);
      const key = routeKey(alternative);
      if (!routes.has(key)) routes.set(key,alternative);
    }
    const checkIds = [...new Set(items.map(item=>item.checkId).filter(Boolean))];
    return {...primary,route,key,checkIds,requirements:[...new Set(items.map(item=>item.requirement).filter(Boolean))],otherRoutes:[...routes.values()].slice(1),findingIds:items.map(item=>item.id).filter(Boolean)};
  });
}

function updateRequestResolutions(groups,audit,report) {
  const active = new Map(groups.map(group=>[group.key,group]));
  const graphFailures = new Set(report.findings.map(finding=>'graph/'+finding.id));
  const failed = new Set([...graphFailures,...audit.findings.map(finding=>finding.checkId)]);
  const passed = audit.passedChecks;
  for (const screen of model.screens) {
    const checks = ['graph/unreachable/'+screen.id,'graph/exit/'+screen.id,
      ...screen.actions.map(action=>'graph/link/'+screen.id+'/'+action.id)];
    for (const check of checks) if (!graphFailures.has(check)) passed.add(check);
  }
  for (const scenario of report.scenarios) if (scenario.passed) passed.add('graph/scenario/'+scenario.id);

  let changed = false;
  for (const request of requests) {
    if (!request.issueKey) continue;
    const issue = active.get(canonicalRequestKey(request.issueKey));
    const prior = request.checkIds || [];
    const checks = [...new Set([...prior,...(issue?.checkIds || [])])];
    if (checks.length!==prior.length) {
      request.checkIds = checks;
      changed = true;
    }
    let resolved = Boolean(request.resolved);
    if (issue || checks.some(check=>failed.has(check))) resolved = false;
    else if (checks.length && checks.every(check=>passed.has(check))) resolved = true;
    if (resolved!==Boolean(request.resolved)) {
      request.resolved = resolved;
      copyChoices.delete(request.id);
      changed = true;
    }
  }
  if (changed) persistRequests();
}

function updateIssueRequestButtons() {
  const saved = new Set(requests.map(request=>canonicalRequestKey(request.issueKey)));
  for (const control of document.querySelectorAll('[data-issue-key]')) {
    control.disabled = saved.has(control.dataset.issueKey);
    control.textContent = control.disabled ? ui('추가됨','Added') : ui('AI 수정 요청에 담기','Add to AI requests');
  }
}

// Only an explicitly sourced requirement may be described as mandatory.
function planningEvidence(screen,action,requirementIds=[],expectedScreen) {
  const rows = [];
  const suggestions = new Set();
  const linked = requirementIds.filter(Boolean);
  for (const item of model.review.requirements || []) {
    const relevant = linked.length ? linked.includes(item.id) :
      ((item.screen===screen && (!action || item.action===action)) ||
      (!action && item.suggestedScreens?.includes(screen)));
    if (!relevant) continue;
    if (item.origin==='source') rows.push([ui('기획 필수 동작','Required by the brief'),item.expected]);
    if (item.origin==='inferred') rows.push([ui('AI 추정 동작','Behavior assumed by AI'),item.expected]);
    for (const id of item.suggestedScreens || []) suggestions.add(id);
  }
  for (const id of suggestions) {
    rows.push([ui('AI 제안 화면 (미확정)','AI-proposed screen (unconfirmed)'),auditScreenName(id)]);
  }
  const inferred = expectedScreen || (!action && screen);
  if (!suggestions.has(inferred) && screens.get(inferred)?.origin==='inferred') {
    rows.push([ui('AI 추정 화면','AI-inferred screen'),auditScreenName(inferred)]);
  }
  return rows;
}

function findingPlanning(finding) {
  return planningEvidence(finding.screen,finding.action,
    finding.requirements || [finding.requirement],finding.expectedScreen || finding.route?.issue?.expectedScreen);
}

function evidenceNodes(rows) {
  return rows.flatMap(([label,value])=>[element('dt','',label),element('dd','',value)]);
}

function planningList(rows) {
  return rows.length ? write(element('dl','finding-result planning-evidence'),...evidenceNodes(rows)) : null;
}

function requestPlanning(request) {
  return request.planning ?? planningEvidence(request.screen,request.action);
}

function addIssueRequest(finding) {
  if (requests.some(request=>canonicalRequestKey(request.issueKey)===finding.key)) return;
  const text = [finding.title,ui('재현 순서','Steps to reproduce'),...finding.steps.map((step,index)=>(index+1)+'. '+step),
    ui('더미 검사 기준 — ','Expected in mockup — ')+finding.expected,ui('실제 결과 — ','Actual — ')+finding.actual].join('\n');
  enqueueRequest(finding.screen,text,requestContext(finding.screen,finding.initial),finding);
  updateIssueRequestButtons();
  const status = $('review-request-status');
  status.textContent = ui(`${screenNumber(finding.screen)} 화면의 문제를 AI 수정 요청에 담았어요. 현재 ${requests.length}건이에요.`,
    `Added the issue on ${screenNumber(finding.screen)} to AI requests. Total: ${requests.length}.`);
}

function renderReviewFinding(finding,showProposal = false) {
  const open = button(ui('흐름 보기','View flow'),'tool',()=>showReviewRoute(verificationForFinding(finding)));
  const add = button(ui('AI 수정 요청에 담기','Add to AI requests'),'tool soft',()=>addIssueRequest(finding));
  add.dataset.issueKey = finding.key;
  const controls = write(element('div','finding-actions'),open,add);
  const row = write(element('div','finding'),
    element('strong','',auditScreenName(finding.screen)+' · '+finding.title),
    write(element('dl','finding-result'),...evidenceNodes(findingPlanning(finding)),
      element('dt','',ui('더미 검사 기준','Expected in mockup')),element('dd','',finding.expected),
      element('dt','',ui('실제','Actual')),element('dd','',finding.actual)),controls,
    write(element('details','finding-repro'),element('summary','',ui('재현 순서','Steps to reproduce')),
      write(element('ol','finding-steps'),...finding.steps.map(step=>element('li','',step)))));
  if (finding.otherRoutes.length) row.append(write(element('details','finding-repro'),
    element('summary','',ui('다른 재현 경로','Other reproduction paths')),write(element('div','finding-actions'),...finding.otherRoutes.map(route=>
      button(route.title,'tool',()=>showReviewRoute(route))))));
  if (showProposal) {
    for (const proposal of (model.proposals || []).filter(item=>item.finding && finding.findingIds.includes(item.finding))) {
      controls.append(button(proposal.title,'tool soft',()=>applyReview(proposal.id)));
    }
  }
  return row;
}

function renderAuditCase(test) {
  return write(element('li'),write(element('div','review-route-head'),
    element('strong','',test.title+' · '+(test.finding?ui('검증 필요','Needs review'):ui('통과','Pass'))),
    button(ui('흐름 보기','View flow'),'tool',()=>openVerificationFlow(test.route || verificationForFinding(test.finding)))),
    write(element('details'),element('summary','',test.finding?ui('재현 순서 보기','View reproduction steps'):test.result),
      write(element('ol','finding-steps'),...(test.sequence || test.finding.steps).map(step=>element('li','',step)))));
}

function canvasVerificationFinding(finding) {
  const {route} = finding;
  const start = screens.has(route.start) ? route.start : model.start;
  const steps = [];
  if (start===route.start) for (const step of route.steps) {
    if (!screens.has(step.from)) break;
    if (step.to && !screens.has(step.to)) {
      steps.push({...step,to:undefined,after:undefined});
      break;
    }
    steps.push(step);
  }
  if (screens.has(finding.screen) && start===route.start && steps.length===route.steps.length) {
    return {...finding,route:{...route,steps}};
  }
  const last = steps.at(-1);
  const screen = screens.has(finding.screen) ? finding.screen : last?.to || last?.from || start;
  steps.push({from:screen,label:finding.title,before:finding.initial});
  return {...finding,screen,route:{...route,start,steps,issue:{...route.issue,screen}}};
}

function renderReview() {
  $('review-results').hidden = false;
  const verified = !testRun && !appliedProposals.size ? buildVerification : undefined;
  const independent = $('independent-verification');
  independent.hidden = !verified;
  if (verified) {
    const {model,browser,viewport,verifiedAt} = verified;
    const date = new Intl.DateTimeFormat(language,{dateStyle:'short',timeStyle:'short'}).format(new Date(verifiedAt));
    independent.textContent = ui(
      `기획 기준 XState 상태 ${model.totalStates}개 · Playwright ${browser.passedCases}/${browser.totalCases}경로 통과 · ${viewport.width} × ${viewport.height} · ${date} 실행`,
      `Plan coverage: ${model.totalStates} XState states · Playwright: ${browser.passedCases}/${browser.totalCases} paths passed · ${viewport.width} × ${viewport.height} · ${date}`);
    if (browser.unverifiedActions?.length) {
      independent.textContent += ui(' · 독립 클릭 제외 ',' · Outside independent click coverage ') +
        browser.unverifiedActions.join(', ');
    }
  }
  $('run-checks').textContent = verified ? ui('빠른 검사 다시 실행','Rerun quick checks') : ui('다시 검증','Run checks again');
  $('scenario-results').hidden = !model.scenarios.length;
  const result = Wireflow.check(model,ui);
  const audit = runWorkshopAudit(model);
  if (verified) {
    audit.findings.push(...[...verified.model.findings,...verified.browser.findings].map(canvasVerificationFinding));
    for (const id of [...verified.model.passedChecks,...verified.browser.passedChecks]) audit.passedChecks.add(id);
  }
  const {visible,checked,passed,modeled,modelTotal,fixtures} = audit.coverage;
  const passing = result.scenarios.filter(item=>item.passed).length;
  const recoveryPassing = audit.recovery.filter(item=>!item.finding).length;
  const journeyPassing = audit.journeys.filter(item=>!item.finding).length;
  $('checks').textContent = result.scenarios.length ? ui(`시나리오 ${passing}/${result.scenarios.length} 통과`,`Scenarios: ${passing}/${result.scenarios.length} passed`) : ui('화면 조작과 연결을 확인했어요.','Screen controls and links checked.');
  const exploration = audit.exploration;
  $('reachability-coverage').hidden = !exploration;
  if (exploration) $('reachability-coverage').textContent =
    ui(
      `시작점 탐색 · 화면 ${exploration.screens}/${model.screens.length}개 도달 · 상태 ${exploration.states}개 · 조작 ${exploration.clicks}회 실행`,
      `Entry-point exploration · ${exploration.screens}/${model.screens.length} screens reached · ${exploration.states} states · ${exploration.clicks} actions`)+
    (exploration.limits.length ? ' · '+exploration.limits.join(' ') : '');
  $('interaction-coverage').textContent = ui(
    `화면 조작 ${checked}/${visible}개 실행 · ${passed}개 통과 · 대표 상태 ${fixtures}개`,
    `Screen controls: ${checked}/${visible} tried · ${passed} passed · ${fixtures} test states`);
  $('model-coverage').textContent = ui(`화면 조작과 대조한 모델 연결 ${modeled}/${modelTotal}개`,
    `Model links compared with visible controls: ${modeled}/${modelTotal}`);
  $('recovery-coverage').textContent = audit.recovery.length ? ui(`예외와 복귀 ${recoveryPassing}/${audit.recovery.length}개 통과`,`Recovery: ${recoveryPassing}/${audit.recovery.length} passed`) : ui('별도로 정의된 예외와 복귀 검사 없음','No dedicated recovery checks');
  $('journey-coverage').textContent = audit.journeys.length ? ui(`전체 여정 ${journeyPassing}/${audit.journeys.length}개 통과`,`End-to-end journeys: ${journeyPassing}/${audit.journeys.length} passed`) : ui('별도로 정의된 전체 여정 검사 없음','No dedicated end-to-end checks');
  $('journey-details').hidden = !audit.journeys.length;
  $('recovery-details').hidden = !audit.recovery.length;
  $('journey-results').replaceChildren(...audit.journeys.map(renderAuditCase));
  const missing = missingRequirementControls();
  const failedRequirements = new Set(missing.map(item=>item.requirement));
  for (const item of reviewRequirements()) if (item.action && !failedRequirements.has(item.id)) {
    audit.passedChecks.add('requirement-control/'+item.id);
  }
  audit.findings.push(...missing);
  const findings = [...audit.findings];
  for (const item of result.findings) {
    const duplicate = !isMissingLink(item) && !appliedProposals.size && !(model.proposals || []).some(proposal=>proposal.finding===item.id) &&
      item.action && audit.findings.some(finding=>finding.screen===item.screen && finding.action===item.action);
    if (!duplicate) findings.push(graphReviewFinding(item,result));
  }
  const grouped = groupReviewFindings(findings);
  updateRequestResolutions(grouped,audit,result);
  screenIssues.clear();
  for (const finding of grouped) {
    if (!screenIssues.has(finding.screen)) screenIssues.set(finding.screen,[]);
    screenIssues.get(finding.screen).push(finding);
  }
  for (const id of artboards.keys()) renderBoardLabel(id);
  positionInspector();
  $('findings-title').textContent = ui(`발견한 문제 ${grouped.length}건`,`Issues found: ${grouped.length}`);
  $('review-request-status').textContent = '';
  renderRequirementPanel(audit,grouped);
  const proposals = $('review-proposals');
  proposals.replaceChildren();
  if (!testRun) {
    for (const proposal of model.proposals || []) {
      const label = ui('개선안 적용 · ', 'Try fix · ') + proposal.title;
      const control = button(label,'tool soft',()=>applyReview(proposal.id));
      control.dataset.proposal = proposal.id;
      control.title = proposal.reason;
      proposals.append(control);
    }
    if (appliedProposals.size) {
      proposals.append(button(ui('개선안 적용 취소','Undo proposed fixes'),'tool',()=>applyReview()),
        button(ui('흐름 JSON 저장','Save flow JSON'),'tool',saveReviewedFlow));
    }
  }
  proposals.hidden = !proposals.childElementCount;
  $('recovery-results').replaceChildren(...audit.recovery.map(renderAuditCase));
  $('scenarios').replaceChildren(...model.scenarios.map((route,index)=>{
    const node = write(element('div','scenario-review-row'),
      element('strong','',route.title+' · '+(result.scenarios[index].passed?ui('통과','Pass'):ui('검토 필요','Needs review'))),
      button(ui('흐름 보기','View flow'),'tool',()=>openVerificationFlow(modelVerificationRoute(route))),
      button(ui('직접 해보기','Try it yourself'),'tool quiet',()=>runScenario(route)));
    node.dataset.route = route.id;
    return node;
  }));
}

function toggleReviewTest() {
  if (layoutEditing) setLayoutEditing(false);
  closeVerificationFlow();
  closeRequestEditor();
  closeDescription();
  clearRequestFeedback();
  const config = original.review.audit.testMode;
  let target;
  let restoredMessage = '';
  if (testRun) {
    ({model,session,previews,trace,traversals,focusedStep,scenarioRun,message:restoredMessage,active:target} = testRun);
    testRun = undefined;
    ({requests,drafts,copyChoices} = savedRequests);
  } else {
    testRun = {model,session,previews,trace,traversals,focusedStep,scenarioRun,message,active};
    scenarioRun = undefined;
    requests = [];
    drafts = new Map();
    copyChoices = new Map();
    target = config.screen;
    model = {...model,screens:model.screens.map(screen=>screen.id===target ?
      {...screen,actions:screen.actions.map(action=>({...action,...config.actions[action.id]}))} : screen)};
    session = newSession(target,model.screens.find(screen=>screen.id===target).preview);
    previews = new Map();
    trace = [];
    traversals = [];
    focusedStep = undefined;
    message = '';
  }
  screens = Wireflow.screensById(model);
  collectEdges();
  zoom = undefined;
  select(target);
  message = restoredMessage;
  for (const id of artboards.keys()) renderBoard(id);
  renderScenarioGuide();
  renderReview();
  updateRequestCount();
  const trigger = $('test-mode');
  trigger.setAttribute('aria-pressed',String(Boolean(testRun)));
  trigger.textContent = testRun ? ui('테스트 모드 종료','Exit test mode') : ui('테스트 모드','Test mode');
  $('test-mode-status').textContent = testRun
    ? ui(`${auditScreenName(target)} 제목 옆 배지를 눌러 보세요. 테스트 요청은 모드를 종료하면 지워져요.`,
      `Choose the badge beside ${auditScreenName(target)}. Test requests are cleared when you exit test mode.`)
    : '';
  trigger.focus({preventScroll:true});
}

function applyReview(proposal) {
  const selected = proposal ? new Set([...appliedProposals,proposal]) : new Set();
  try {
    model = selected.size ? Wireflow.applyProposals(original,selected) : original;
  } catch (error) {
    $('review-request-status').textContent = error.message;
    return false;
  }
  closeVerificationFlow(false);
  appliedProposals = selected;
  screens = Wireflow.screensById(model);
  collectEdges();
  message = '';
  for (const id of artboards.keys()) renderBoard(id);
  renderSimulation();
  center(false,true);
  renderScenarioGuide();
  renderReview();
  $('run-checks').focus({preventScroll:true});
  return true;
}

function saveReviewedFlow() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(model,null,2)+'\n'],{type:'application/json'}));
  const link = element('a');
  link.href = url;
  link.download = (model.id || 'wireflow')+'-reviewed.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function openRequestEditor(request) {
  if (!$('review').hidden || verificationFlow) setReviewOpen(false,true);
  const screen = screens.get(active);
  closeDescription();
  editingRequest = request;
  $('request-title').textContent = screenNumber(screen.id)+' '+screen.title;
  const rows = request ? requestPlanning(request) : planningEvidence(active);
  $('request-planning').replaceChildren(...evidenceNodes(rows));
  $('request-planning').hidden = !rows.length;
  $('request-text').value = drafts.get(request ? 'request/'+request.id : active) ?? request?.text ?? '';
  $('request-save').textContent = request ? ui('변경 저장','Save changes') : ui('목록에 담기','Add to list');
  clearRequestFeedback();
  updateRequestSave();
  $('request-editor').hidden = false;
  $('request-open').setAttribute('aria-expanded','true');
  positionInspector();
  $('request-text').focus({preventScroll:true});
}

function closeRequestEditor(restoreFocus = false) {
  editingRequest = undefined;
  $('request-editor').hidden = true;
  $('request-open').setAttribute('aria-expanded','false');
  if (restoreFocus) $('request-open').focus({preventScroll:true});
}

function clearRequestFeedback() {
  $('request-status').textContent = '';
  $('saved-request-list').hidden = true;
}

function updateRequestSave() {
  const text = $('request-text').value.trim();
  $('request-save').disabled = !text || text===editingRequest?.text;
}

function updateRequestCount(highlight = false) {
  const trigger = $('requests-open');
  $('request-count').textContent = requests.length;
  trigger.toggleAttribute('data-has-requests',requests.length>0);
  trigger.setAttribute('aria-label',ui(`수정 요청 목록 ${requests.length}건`,`AI change requests: ${requests.length}`));
  if (highlight && !reducedMotion.matches && trigger.animate) {
    requestHighlight?.cancel();
    requestHighlight = trigger.animate([
      {transform:'scale(1)',boxShadow:'0 0 0 0 #07509c45'},
      {transform:'scale(1.045)',offset:.35},
      {transform:'scale(1)',boxShadow:'0 0 0 6px #07509c00'},
    ],{duration:320,easing:'ease-out'});
  }
}

function requestContext(id,current = context(id).vars) {
  return workshop ? workshopRequestContext(id,current) : auditValues(current);
}

function enqueueRequest(screen,text,state,finding) {
  requests.push({
    id: (requests.at(-1)?.id ?? 0)+1,
    screen,
    number: screenNumber(screen),
    planning: finding ? findingPlanning(finding) : planningEvidence(screen),
    text,
    size: screenWidth+' × '+screenHeight+' CSS px',
    state,
    ...(finding && {issueKey:finding.key,checkIds:finding.checkIds,action:finding.action,field:finding.field}),
  });
  persistRequests();
  updateRequestCount(true);
}

function saveRequest(event) {
  event.preventDefault();
  if ($('request-save').disabled) return;
  const text = $('request-text').value.trim();
  const edited = Boolean(editingRequest);
  if (edited) {
    drafts.delete('request/'+editingRequest.id);
    editingRequest.text = text;
    persistRequests();
    closeRequestEditor(true);
    openRequestList();
    $('copy-status').textContent = ui('요청을 수정했어요.','Request updated.');
  } else {
    drafts.delete(active);
    enqueueRequest(active,text,requestContext(active));
    $('request-text').value = '';
    updateRequestSave();
    $('request-status').textContent = ui(`${screenNumber(active)} 화면의 요청을 담았어요.`,`Added your request for screen ${screenNumber(active)}.`);
    $('saved-request-list').hidden = false;
  }
}

function openDescription() {
  if (!$('review').hidden || verificationFlow) setReviewOpen(false,true);
  closeRequestEditor();
  const screen = screens.get(active);
  $('description-title').textContent = screenNumber(screen.id)+' '+screen.title;
  const planning = planningEvidence(screen.id);
  $('description-planning').replaceChildren(...evidenceNodes(planning));
  $('description-planning').hidden = !planning.length;
  const conditions = screen.uxConditions || [];
  const source = original.source || original.review.source;
  const provenance = screen.origin === 'source' ? ui('기획에 있는 화면','From the brief') : ui('AI가 보완한 화면','Inferred by AI');
  $('description-source').textContent = source ? provenance+' · '+source : provenance;
  const brief = $('description-brief');
  brief.textContent = screen.brief || (!conditions.length ? ui('이 화면에 기록된 기획 내용이 없어요.','There is no planning context recorded for this screen.') : '');
  brief.hidden = !brief.textContent;
  $('ux-conditions').replaceChildren(...conditions.map(text=>element('li','',text)));
  $('description-conditions').hidden = !conditions.length;
  const decisions = model.decisions.filter(item=>item.screen===screen.id);
  $('description-decisions').hidden = !decisions.length;
  $('ux-decisions').replaceChildren(...decisions.map(item=>element('li','',item.question)));
  $('description-links').parentElement.open = false;
  $('description-links').replaceChildren(...screen.actions.map(action=>{
    const destination = screens.get(action.to);
    const label = action.kind==='simulation' ? ui('모의 입력 · ','Simulation · ')+action.label : action.label;
    const target = destination ? screenNumber(destination.id)+' '+destination.title : ui('연결 없음','No connection');
    return element('li','',label+' → '+target);
  }));
  $('screen-description').hidden = false;
  $('description-open').setAttribute('aria-expanded','true');
  positionInspector();
  $('description-close').focus({preventScroll:true});
}

function closeDescription(restoreFocus = false) {
  $('screen-description').hidden = true;
  $('description-open').setAttribute('aria-expanded','false');
  if (restoreFocus) $('description-open').focus({preventScroll:true});
}

const requestStatus = request => request.resolved ? ui('해결됨','Resolved') : ui('수정 필요','Changes needed');
const isRequestSelected = request => copyChoices.get(request.id) ?? !request.resolved;
const selectedRequests = () => requests.filter(isRequestSelected);

function clearCopyFeedback() {
  $('copy-text').hidden = true;
  $('copy-status').textContent = '';
}

function updateCopyButton() {
  const count = selectedRequests().length;
  $('copy-requests').disabled = !count;
  $('copy-requests').textContent = ui('AI에 붙여넣을 요청 복사','Copy requests for AI')+(count ? ui(` (${count}건)`,` (${count})`) : '');
  clearCopyFeedback();
}

const originalRequestNumber = request => request.number ?? screens.get(request.screen).number;

function openRequestList() {
  if (!$('review').hidden || verificationFlow) setReviewOpen(false);
  closeRequestEditor();
  closeDescription();
  $('request-list-title').textContent = testRun ? ui('테스트 AI 수정 요청','Test AI change requests') : ui('AI 수정 요청','AI change requests');
  $('requests-empty').hidden = requests.length>0;
  $('requests-instructions').hidden = !requests.length;
  $('saved-requests').replaceChildren(...requests.map(request=>{
    const screen = screens.get(request.screen);
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isRequestSelected(request);
    checkbox.setAttribute('aria-label',ui(`${screenNumber(screen.id)} ${screen.title} 요청 ${request.id} 복사에 포함`,
      `Include ${screenNumber(screen.id)} ${screen.title} request ${request.id} when copying`));
    checkbox.addEventListener('change',()=>{
      copyChoices.set(request.id,checkbox.checked);
      updateCopyButton();
    });
    const edit = button(ui('수정','Edit'),'tool',()=>{
      $('request-list').close();
      if (!$('review').hidden) setReviewOpen(false);
      select(request.screen);
      openRequestEditor(request);
    });
    edit.setAttribute('aria-label',ui(`${screenNumber(screen.id)} ${screen.title} 요청 ${request.id} 수정`,
      `Edit ${screenNumber(screen.id)} ${screen.title} request ${request.id}`));
    const status = element('span','request-status-badge',requestStatus(request));
    status.toggleAttribute('data-resolved',Boolean(request.resolved));
    const detailStart = request.issueKey ? request.text.indexOf('\n') : -1;
    return write(element('li'),write(element('div','saved-request-head'),
      write(element('div','saved-request-title'),write(element('label'),checkbox,screenNumber(screen.id)+' '+screen.title),status),edit),
      originalRequestNumber(request)!==screenNumber(screen.id) ?
        element('p','saved-request-number',ui('이전 번호 ','Previous number ')+originalRequestNumber(request)) : null,
      planningList(requestPlanning(request)),
      element('p','saved-request-text',detailStart<0 ? request.text : request.text.slice(0,detailStart)),
      detailStart<0 ? null : write(element('details','saved-request-detail'),element('summary','',ui('재현 순서와 결과','Reproduction steps and results')),
        element('p','saved-request-text',request.text.slice(detailStart+1))));
  }));
  updateCopyButton();
  $('request-list').showModal();
}

async function copyRequestBatch() {
  const selected = selectedRequests();
  if (!selected.length) return;
  const entries = selected.map((request,index)=>{
    const screen = screens.get(request.screen);
    return [
      (index+1)+'. ['+screenNumber(screen.id)+'] '+screen.title+' ('+screen.id+')',
      originalRequestNumber(request)!==screenNumber(screen.id) ? ui('이전 화면 번호: ','Previous screen number: ')+originalRequestNumber(request) : '',
      ui('화면 크기: ','Screen size: ')+request.size,
      request.action ? ui('조작 ID: ','Action ID: ')+request.action : request.field ? ui('입력 항목: ','Field: ')+request.field : '',
      ui('요청 상태: ','Request status: ')+requestStatus(request),
      ui('검토 상태: ','Review status: ')+request.state,
      ...requestPlanning(request).map(([label,value])=>label+' — '+value),
      ui('수정 요청: ','Change request: ')+request.text,
    ].filter(Boolean).join('\n');
  });
  const copy = [
    model.title+(testRun ? ui(' · 테스트 모드 재현용 수정 요청',' · Test mode change requests') : ui(' · 화면 수정 요청',' · Screen change requests')),
    ui('흐름 파일: ','Flow file: ')+flowPath,
    ...(model.id ? [ui('흐름 ID: ','Flow ID: ')+model.id] : []),
    '',
    entries.join('\n\n'),
  ].join('\n');
  clearCopyFeedback();
  try {
    await navigator.clipboard.writeText(copy);
    if ($('request-list').open) $('copy-status').textContent = ui(`요청 ${selected.length}건을 복사했어요. 작업 중인 AI 채팅에 붙여넣으세요.`,
      `Copied ${selected.length} requests. Paste them into your current AI chat.`);
  } catch {
    if (!$('request-list').open) return;
    const field = $('copy-text');
    field.hidden = false;
    field.value = copy;
    field.focus();
    field.select();
    $('copy-status').textContent = ui('선택된 내용을 복사해 AI 채팅에 붙여 넣으세요.','Copy the selected text and paste it into your AI chat.');
  }
}

function renderLayoutNavigation() {
  const options = [];
  const clusters = [];
  for (const [index,group] of orderedCanvasGroups(layout).entries()) {
    const title = formatNumber(index+1)+' '+group.title;
    const optgroup = element('optgroup');
    optgroup.label = title;
    for (const id of group.ids) {
      const option = element('option','',screenNumber(id)+' '+screens.get(id).title);
      option.value = id;
      optgroup.append(option);
    }
    options.push(optgroup);
    const heading = button(title,'stage-heading',()=>select(group.root,true));
    heading.dataset.layoutGroup = group.root;
    const cluster = write(element('div','stage-cluster'),heading);
    cluster.dataset.groupRoot = group.root;
    clusters.push(cluster);
  }
  $('screen-picker').replaceChildren(...options);
  $('groups').replaceChildren(...clusters);
  syncScreenTools();
}

function createWorld() {
  for (const screen of model.screens) {
    const board = element('article','artboard');
    board.dataset.screen = screen.id;
    board.addEventListener('click',event=>{
      if (active!==screen.id && !event.target.closest('button, a, input, select, textarea, summary')) select(screen.id);
    });
    const hit = button('', 'overview-hit', () => select(screen.id,true));
    hit.setAttribute('aria-label',ui(screen.title+' 확대','Zoom to '+screen.title));
    board.append(hit);
    artboards.set(screen.id,board);
    $('world').append(board);
    renderBoard(screen.id);
  }
  renderLayoutNavigation();
}

function layoutWorld() {
  const inset = parseFloat(getComputedStyle(canvas).getPropertyValue('--group-inset'));
  const frames = new Map();
  for (const [id,board] of artboards) {
    const {x,y} = position(id);
    Object.assign(board.style,{left:x+'px',top:y+'px'});
    frames.set(id,{x,y,w:screenWidth,h:screenHeight,group:screens.get(id).stage});
  }
  for (const cluster of $('groups').children) {
    const group = layout.groups.find(item => item.root===cluster.dataset.groupRoot);
    const members = group.ids.map(id => frames.get(id));
    const left = Math.min(...members.map(frame => frame.x)) - inset;
    const top = Math.min(...members.map(frame => frame.y)) - 158;
    const right = Math.max(...members.map(frame => frame.x)) + screenWidth + inset;
    const bottom = Math.max(...members.map(frame => frame.y)) + screenHeight + inset;
    Object.assign(cluster.style,{left:left+'px',top:top+'px',width:(right-left)+'px',height:(bottom-top)+'px'});
  }
  paintConnections = createConnections($('connections'),frames,pitch,model.review.annotations);
}

function setLayoutEditing(on) {
  if (on) {
    closeVerificationFlow();
    experimentalLayout ??= readCanvasLayout(original,publishedLayout);
    Object.assign(layout,experimentalLayout);
  } else {
    Object.assign(experimentalLayout,layout);
    Object.assign(layout,publishedLayout);
  }
  layoutEditing = on;
  canvas.toggleAttribute('data-layout-edit',on);
  $('layout-toolbar').hidden = !on;
  $('canvas-more').open = false;
  $('canvas-more').hidden = on;
  updatePlacementButtons();
  $('layout-status').hidden = !on;
  $('layout-status').textContent = ui('실험 배치 · 화면이나 그룹 제목을 끌어 놓으세요.','Experimental layout · Drag screens or group headings.');
  for (const board of artboards.values()) board.querySelector('.device').inert = on;
  renderScenarioGuide();
  renderLayoutNavigation();
  layoutWorld();
  for (const id of artboards.keys()) renderBoardLabel(id);
  if (!on) {
    zoom = undefined;
    center();
    $('canvas-more').querySelector('summary').focus({preventScroll:true});
    return;
  }
  closeRequestEditor();
  closeDescription();
  showOverview();
  $('layout-edit').focus({preventScroll:true});
}

function overviewCamera() {
  const {clientWidth:width,clientHeight:height} = canvas;
  const points = [...artboards].map(([id,board])=>{
    const {x,y} = position(id);
    const headingWidth = board.querySelector('.screen-heading').offsetWidth;
    return {x,y,right:x+Math.max(screenWidth,headingWidth)};
  });
  const groups = [...$('groups').children];
  const left = Math.min(...groups.map(group=>group.offsetLeft));
  const top = Math.min(...groups.map(group=>group.offsetTop));
  const right = Math.max(...points.map(point=>point.right),...groups.map(group=>
    group.offsetLeft + Math.max(group.offsetWidth,group.firstElementChild.offsetWidth)));
  const bottom = Math.max(...groups.map(group=>group.offsetTop+group.offsetHeight));
  const topInset = 56, bottomInset = 40;
  const scale = Math.min(fitZoom(),Math.max(1,width-32)/(right-left),Math.max(1,height-topInset-bottomInset)/(bottom-top));
  return {zoom:scale,offset:{x:width/2-(left+right)/2*scale,y:(height+topInset-bottomInset)/2-(top+bottom)/2*scale}};
}

function showOverview(animate = false) {
  if (verificationFlow) verificationFlow.fitted = false;
  centeredSize = {width:canvas.clientWidth,height:canvas.clientHeight};
  fittingOverview = true;
  canvas.setAttribute('data-overview','');
  const next = overviewCamera();
  moveCamera(next.offset,next.zoom,animate);
}

function openNumberPreview() {
  numberPreview = previewScreenNumbers(layout);
  const order = layout.groupDirection==='vertical' ? ui('그룹은 위에서부터, 그룹 안의 화면은 왼쪽부터','Groups from top to bottom and screens from left to right.') :
    ui('그룹은 왼쪽부터, 그룹 안의 화면은 위에서부터','Groups from left to right and screens from top to bottom.');
  $('numbering-summary').textContent = numberPreview.length
    ? order+ui(` ${numberPreview.length}개 번호를 바꿉니다.`,` ${numberPreview.length} screen numbers will change.`)
    : ui('현재 배치와 화면 번호가 일치합니다.','The screen numbers match the current layout.');
  $('numbering-changes').replaceChildren(...numberPreview.map(({id,from,to})=>
    write(element('li'),element('span','numbering-screen',screens.get(id).title),
      element('strong','',from+' → '+to))));
  $('apply-numbering').disabled = !numberPreview.length;
  $('numbering').showModal();
}

function applyNumberPreview() {
  for (const {id,to} of numberPreview) layout.numbers.set(id,to);
  saveCanvasLayout(layout);
  renderLayoutNavigation();
  for (const id of artboards.keys()) renderBoardLabel(id);
  $('numbering').close();
  $('layout-status').textContent = ui(`${numberPreview.length}개 화면의 번호를 적용했어요.`,`Renumbered ${numberPreview.length} screens.`);
}

function updatePlacementButtons() {
  $('undo-layout').disabled = !previousPlacement;
  $('reset-layout').disabled = layout.groups.every((group,index)=>
    group.ids.join('|')===defaultPlacement.groups[index].ids.join('|')) &&
    [...defaultPlacement.positions].every(([id,point])=>{
      const current = layout.positions.get(id);
      return Math.abs(current.x-point.x)<1e-6 && Math.abs(current.y-point.y)<1e-6;
    });
}

function refreshPlacement(message) {
  renderLayoutNavigation();
  layoutWorld();
  saveCanvasLayout(layout);
  updatePlacementButtons();
  $('layout-status').textContent = message;
  placeWorld();
}

function commitPlacement(next,message) {
  previousPlacement = {groups:layout.groups,positions:layout.positions};
  Object.assign(layout,next);
  refreshPlacement(message);
}

function resetPlacement() {
  commitPlacement(defaultPlacement,ui('기본 배치로 돌아왔어요.','Default layout restored.'));
  showOverview();
}

function undoPlacement() {
  if (!previousPlacement) return;
  Object.assign(layout,previousPlacement);
  previousPlacement = undefined;
  refreshPlacement(ui('직전 배치 변경을 되돌렸어요.','Last layout change undone.'));
}

function layoutDragSource(node) {
  if (!layoutEditing) return;
  const group = node.closest('[data-layout-group]');
  if (group) return {kind:'group',id:group.dataset.layoutGroup};
  const screen = node.closest('.artboard');
  if (screen) return {kind:'screen',id:screen.dataset.screen};
}

function sourceScreens({kind,id}) {
  return kind==='group' ? layout.groups.find(group=>group.root===id).ids : [id];
}

function sourceName(source) {
  return source.kind==='group' ? layout.groups.find(group=>group.root===source.id).title : screens.get(source.id).title;
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {x:event.clientX-bounds.left,y:event.clientY-bounds.top};
}

function startFreeDrag(source,event) {
  const ids = new Set(sourceScreens(source));
  const frames = [...artboards.keys()].map(id=>({id,...position(id),w:screenWidth,h:screenHeight}));
  const point = canvasPoint(event);
  const moving = frames.filter(frame=>ids.has(frame.id));
  const neighbors = frames.filter(frame=>!ids.has(frame.id));
  const headings = [...$('groups').children].filter(cluster=>ids.has(cluster.dataset.groupRoot));
  return {source,point,moving,neighbors,headings,
    origin:{x:(point.x-offset.x)/zoom,y:(point.y-offset.y)/zoom}};
}

function freeDragPreview(move,point,disableSnap) {
  const delta = {
    x:(point.x-offset.x)/zoom-move.origin.x,
    y:(point.y-offset.y)/zoom-move.origin.y,
  };
  return snapCanvasDelta(move.moving,move.neighbors,delta,zoom,disableSnap);
}

function showSnapGuides(guides) {
  for (const axis of ['x','y']) {
    const node = $('layout-guide-'+axis);
    const guide = guides.find(item=>item.axis===axis);
    node.hidden = !guide;
    if (!guide) continue;
    const vertical = axis==='x';
    const length = (guide.end-guide.start)*zoom+16;
    Object.assign(node.style,{
      left:(offset.x+(vertical?guide.value:guide.start)*zoom-(vertical?0:8))+'px',
      top:(offset.y+(vertical?guide.start:guide.value)*zoom-(vertical?8:0))+'px',
      width:(vertical?1:length)+'px',height:(vertical?length:1)+'px',
    });
  }
}

function trackLayoutDrag(now) {
  const move = drag?.layout;
  if (!move || !drag.panning) return false;
  const {point} = move;
  const {width,height} = centeredSize;
  const inside = point.x>=0 && point.y>=0 && point.x<=width && point.y<=height;
  const edge = (value,size) => Math.max(0,44-value)-Math.max(0,value-size+44);
  const dx = inside ? edge(point.x,width) : 0;
  const dy = inside ? edge(point.y,height) : 0;
  const elapsed = Math.min(32,Math.max(0,now-(move.lastFrame ?? now)));
  move.lastFrame = now;
  offset = {x:offset.x+dx*elapsed*.013,y:offset.y+dy*elapsed*.013};
  const preview = freeDragPreview(move,point,move.disableSnap || !inside);
  const translation = 'translate('+preview.delta.x+'px,'+preview.delta.y+'px)';
  for (const {id} of move.moving) artboards.get(id).style.transform = translation;
  for (const heading of move.headings) heading.style.transform = translation;
  showSnapGuides(preview.guides);
  return Boolean(dx || dy);
}

function commitFreeMove(source,delta) {
  if (Math.hypot(delta.x,delta.y)<.01) return;
  const positions = new Map(layout.positions);
  for (const id of sourceScreens(source)) {
    const point = positions.get(id);
    positions.set(id,{x:point.x+delta.x/pitch.x,y:point.y+delta.y/pitch.y});
  }
  commitPlacement({positions},ui(`${sourceName(source)} 배치를 옮겼어요.`,`Moved ${sourceName(source)}.`));
}

function moveLayoutByKey(event) {
  const source = layoutDragSource(event.target);
  const direction = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
  if (!source || !direction) return;
  event.preventDefault();
  const step = event.shiftKey ? 48 : 12;
  const [x,y] = direction;
  commitFreeMove(source,{x:x*step,y:y*step});
  if (source.kind==='group') $('groups').querySelector('[data-layout-group="'+source.id+'"]').focus({preventScroll:true});
}

function setDevice(preset) {
  selectedDevice = preset;
  $('device-picker').value = preset.id;
  screenWidth = preset.width;
  screenHeight = preset.height;
  pitch.x = screenWidth+140;
  pitch.y = screenHeight+164;
  canvas.dataset.device = preset.kind;
  canvas.style.setProperty('--artboard-width',screenWidth+'px');
  canvas.style.setProperty('--artboard-height',screenHeight+'px');
  layoutWorld();
  if (verificationFlow?.fitted) {
    fitVerificationPath();
    return;
  }
  if (layoutEditing || fittingOverview) {
    showOverview();
    return;
  }
  zoom = undefined;
  center();
}

function populateDevices() {
  for (const [kind,label] of [['mobile',ui('모바일','Mobile')],['tablet',ui('태블릿','Tablet')],['watch',ui('워치','Watch')],['desktop',ui('데스크톱','Desktop')]]) {
    const presets = devicePresets.filter(item=>item.kind===kind);
    if (!presets.length) continue;
    const group = element('optgroup');
    group.label = label;
    for (const preset of presets) {
      const option = element('option','',(kind==='watch'?ui('워치 ','Watch '):'')+preset.width+' × '+preset.height);
      option.value = preset.id;
      group.append(option);
    }
    $('device-picker').append(group);
  }
  const custom = element('optgroup');
  custom.label = ui('커스텀','Custom');
  const saved = element('option');
  saved.id = 'custom-size-option';
  saved.value = 'custom';
  saved.hidden = true;
  saved.disabled = true;
  const edit = element('option','',ui('크기 직접 입력…','Enter custom size…'));
  edit.value = 'edit-custom';
  $('device-picker').append(write(custom,saved,edit));
  for (const id of ['custom-width','custom-height']) $(id).max = Wireflow.maxArtboardDimension;
}

function openCustomSize() {
  $('device-picker').value = selectedDevice.id;
  const {width,height} = customDevice ?? selectedDevice;
  $('custom-width').value = width;
  $('custom-height').value = height;
  $('custom-size').showModal();
}

function applyCustomSize(event) {
  event.preventDefault();
  const width = $('custom-width').valueAsNumber;
  const height = $('custom-height').valueAsNumber;
  customDevice = {id:'custom',kind:'custom',width,height};
  const option = $('custom-size-option');
  option.textContent = width+' × '+height;
  option.hidden = false;
  option.disabled = false;
  setDevice(customDevice);
  $('custom-size').close();
}

$('route-proposals-open').addEventListener('click',openRouteProposals);
$('route-picker').addEventListener('change', () => {
  if (layoutEditing) setLayoutEditing(false);
  closeVerificationFlow(false);
  refreshOverviewRoute();
  showOverview();
});
$('screen-picker').addEventListener('change', event=>select(event.target.value));
$('device-picker').addEventListener('change',event=>{
  const id = event.target.value;
  if (id==='edit-custom') openCustomSize();
  else setDevice(id==='custom' ? customDevice : devicePresets.find(preset=>preset.id===id));
});
$('custom-size-form').addEventListener('submit',applyCustomSize);
$('custom-size-cancel').addEventListener('click',()=>$('custom-size').close());
$('custom-size').addEventListener('close',()=>$('device-picker').focus({preventScroll:true}));
$('overview').addEventListener('click',()=>{
  closeRequestEditor();
  closeDescription();
  if (!$('review').hidden) setReviewOpen(false);
  closeVerificationFlow(false);
  showOverview(true);
});
$('layout-edit').addEventListener('click',()=>setLayoutEditing(false));
$('experimental-layout').addEventListener('click',()=>setLayoutEditing(true));
$('canvas-more').addEventListener('keydown',event=>{
  if (event.key==='Escape' && $('canvas-more').open) {
    $('canvas-more').open = false;
    $('canvas-more').querySelector('summary').focus();
  }
});
document.addEventListener('click',event=>{
  if (!event.target.closest('#canvas-more')) $('canvas-more').open = false;
  if (!event.target.closest('.inspector-panel, #screen-tools, #request-list')) {
    closeRequestEditor();
    closeDescription();
  }
});
$('number-preview').addEventListener('click',openNumberPreview);
$('apply-numbering').addEventListener('click',applyNumberPreview);
$('reset-layout').addEventListener('click',resetPlacement);
$('undo-layout').addEventListener('click',undoPlacement);
$('center').addEventListener('click',()=>center(true,true));
$('zoom-in').addEventListener('click',()=>changeZoom(1.2));
$('zoom-out').addEventListener('click',()=>changeZoom(1/1.2));
$('request-open').addEventListener('click',()=>{
  if ($('request-editor').hidden) openRequestEditor();
  else closeRequestEditor(true);
});
$('request-close').addEventListener('click',()=>closeRequestEditor(true));
$('request-editor').addEventListener('keydown',event=>{
  if (event.key==='Escape') {
    event.preventDefault();
    closeRequestEditor(true);
  }
});
$('request-form').addEventListener('submit',saveRequest);
$('requests-open').addEventListener('click',openRequestList);
$('saved-request-list').addEventListener('click',openRequestList);
$('copy-requests').addEventListener('click',copyRequestBatch);
$('description-open').addEventListener('click',()=>{
  if ($('screen-description').hidden) openDescription();
  else closeDescription(true);
});
$('description-close').addEventListener('click',()=>closeDescription(true));
$('screen-description').addEventListener('keydown',event=>{
  if (event.key==='Escape') {
    event.preventDefault();
    closeDescription(true);
  }
});
$('test-mode').addEventListener('click',toggleReviewTest);
$('review-open').addEventListener('click',()=>{
  const open = $('review').hidden;
  setReviewOpen(open);
  if (open) renderReview();
});
$('run-checks').addEventListener('click',renderReview);
document.querySelector('.review-sidebar').addEventListener('keydown',event=>{
  if (event.key!=='Escape' || $('review').hidden) return;
  event.preventDefault();
  setReviewOpen(false);
  $('review-open').focus({preventScroll:true});
});
$('scenario-return').addEventListener('click',()=>select(session.screen,true));
$('scenario-restart').addEventListener('click',()=>runScenario(scenarioRun.route,scenarioRun.title));
$('scenario-close').addEventListener('click',()=>{
  scenarioRun = undefined;
  renderScenarioGuide();
  artboards.get(active).querySelector('.screen-label').focus({preventScroll:true});
});
$('flow-fit').addEventListener('click',()=>fitVerificationPath());
$('flow-close').addEventListener('click',()=>closeVerificationFlow());
$('request-text').addEventListener('input',event=>{
  const key = editingRequest ? 'request/'+editingRequest.id : active;
  drafts.set(key,event.target.value);
  persistRequests();
  updateRequestSave();
  clearRequestFeedback();
});

const canvas = $('canvas');
canvas.addEventListener('keydown',moveLayoutByKey);
function pinchGeometry() {
  const [a,b] = touches.values();
  return {point:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.hypot(a.x-b.x,a.y-b.y)};
}

canvas.addEventListener('pointerdown',event=>{
  if (event.pointerType==='touch') {
    touches.set(event.pointerId,canvasPoint(event));
    if (touches.size>=2) {
      if (pinch) return;
      if (drag) finishDrag({pointerId:drag.id,type:'pointercancel'});
      deferredSelect = null;
      cancelClick = true;
      slide = undefined;
      for (const id of touches.keys()) canvas.setPointerCapture(id);
      pinch = pinchGeometry();
      event.preventDefault();
      return;
    }
  }
  if (!event.isPrimary || event.button!==0) return;
  cancelClick = false;
  const select = event.target.closest('select');
  deferredSelect = select?.showPicker && window===window.top ? select : null;
  if (deferredSelect) event.preventDefault();
  const source = layoutDragSource(event.target);
  drag = {id:event.pointerId,x:event.clientX,y:event.clientY,origin:offset,panning:false,
    layout:source ? startFreeDrag(source,event) : undefined};
},true);
window.addEventListener('pointermove',event=>{
  if (touches.has(event.pointerId)) {
    touches.set(event.pointerId,canvasPoint(event));
    if (pinch && touches.size>=2) {
      if (systemPinch) return;
      const next = pinchGeometry();
      zoomAt(Math.max(1,next.distance)/Math.max(1,pinch.distance),pinch.point,next.point);
      pinch = next;
      event.preventDefault();
      return;
    }
  }
  if (!drag || event.pointerId!==drag.id) return;
  const dx=event.clientX-drag.x, dy=event.clientY-drag.y;
  if (!drag.panning) {
    if (dx*dx+dy*dy<25) return;
    drag.panning=true;
    slide = undefined;
    fittingOverview = false;
    if (verificationFlow) verificationFlow.fitted = false;
    cancelClick=true;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('dragging');
    if (drag.layout) {
      canvas.setAttribute('data-layout-moving','');
      for (const {id} of drag.layout.moving) artboards.get(id).classList.add('is-layout-dragging');
    }
  }
  event.preventDefault();
  if (drag.layout) {
    drag.layout.point = canvasPoint(event);
    drag.layout.disableSnap = event.altKey;
  } else offset = {x:drag.origin.x+dx,y:drag.origin.y+dy};
  placeWorld();
},{capture:true,passive:false});
function finishDrag(event) {
  if (!drag || event.pointerId!==drag.id) return;
  const {layout:move,panning} = drag;
  drag = null;
  canvas.classList.remove('dragging');
  if (!move || !panning) return;
  for (const {id} of move.moving) {
    const board = artboards.get(id);
    board.style.transform = '';
    board.classList.remove('is-layout-dragging');
  }
  for (const heading of move.headings) heading.style.transform = '';
  canvas.removeAttribute('data-layout-moving');
  showSnapGuides([]);
  placeWorld();
  if (event.type!=='pointerup') return;
  const point = canvasPoint(event);
  const {width,height}=centeredSize;
  if (point.x>=0 && point.y>=0 && point.x<=width && point.y<=height) {
    commitFreeMove(move.source,freeDragPreview(move,point,event.altKey).delta);
  }
}
function handleLayoutDragKey(event) {
  if (!drag?.layout || !drag.panning) return;
  if (event.key==='Alt') {
    drag.layout.disableSnap = event.altKey;
    placeWorld();
  } else if (event.key==='Escape' && event.type==='keydown') {
    event.preventDefault();
    const {id} = drag;
    finishDrag({pointerId:id,type:'pointercancel'});
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
}
window.addEventListener('keydown',handleLayoutDragKey);
window.addEventListener('keyup',handleLayoutDragKey);
function finishPointer(event) {
  if (touches.delete(event.pointerId) && pinch) pinch = touches.size<2 ? undefined : pinchGeometry();
  finishDrag(event);
}
window.addEventListener('pointerup',finishPointer,true);
window.addEventListener('pointercancel',finishPointer,true);
canvas.addEventListener('lostpointercapture',event=>{
  if (event.target===canvas) finishDrag(event);
});
canvas.addEventListener('dragstart',event=>event.preventDefault());
canvas.addEventListener('click',event=>{
  if (event.detail===0) return;
  const select=deferredSelect;
  deferredSelect=null;
  if (cancelClick) {
    cancelClick=false;
    event.preventDefault();
    event.stopImmediatePropagation();
  } else if (event.target===select) {
    select.focus({preventScroll:true});
    select.showPicker();
  }
},true);
canvas.addEventListener('wheel',event=>{
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    if (systemPinch) return;
    const units = event.deltaMode===1 ? 16 : event.deltaMode===2 ? canvas.clientHeight : 1;
    const delta = Math.max(-180,Math.min(180,event.deltaY*units));
    zoomAt(Math.exp(-delta*.012),canvasPoint(event));
    return;
  }
  if (event.target.closest('.device')) return;
  event.preventDefault();
  slide = undefined;
  fittingOverview = false;
  if (verificationFlow) verificationFlow.fitted = false;
  offset = {x:offset.x-event.deltaX,y:offset.y-event.deltaY};
  placeWorld();
},{passive:false});

// Safari delivers trackpad pinch events separately from pointer and wheel input.
canvas.addEventListener('gesturestart',event=>{
  event.preventDefault();
  systemPinch = event.scale || 1;
},{passive:false});
canvas.addEventListener('gesturechange',event=>{
  event.preventDefault();
  if (!systemPinch || !event.scale) return;
  zoomAt(event.scale/systemPinch,canvasPoint(event));
  systemPinch = event.scale;
},{passive:false});
canvas.addEventListener('gestureend',event=>{
  event.preventDefault();
  systemPinch = undefined;
},{passive:false});

createWorld();
populateRoutePicker();
const blockedScenario = model.proposals?.length && Wireflow.check(model,ui).scenarios.find(scenario=>!scenario.passed);
const initialRoute = blockedScenario || model.scenarios[0];
if (initialRoute) $('route-picker').value = initialRoute.id;
collectEdges();
populateDevices();
setDevice(defaultDevice);
select(active);
showOverview();
updateRequestCount();
renderRequirementPanel();
new ResizeObserver(()=>{
  if (centeredSize.width===canvas.clientWidth && centeredSize.height===canvas.clientHeight) return;
  if (verificationFlow?.fitted) fitVerificationPath();
  else if (layoutEditing || fittingOverview) showOverview();
  else if (centeredSize.width!==canvas.clientWidth) center(false,true);
  else center();
}).observe(canvas);
const panelResize = new ResizeObserver(positionInspector);
panelResize.observe($('request-editor'));
panelResize.observe($('screen-description'));
