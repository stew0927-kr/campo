'use strict';

const reviewStates = {pass:ui('통과','Pass'),issue:ui('문제','Issue'),pending:ui('미검증','Untested'),decision:ui('기획 확인 필요','Plan decision')};
let reviewRows = [];
let selectedReviewRow;

function reviewRequirements() {
  return model.review.requirements || model.screens.flatMap(screen=>screen.actions.map(action=>({
    id:screen.id+'/'+action.id,group:model.stages[screen.stage],screen:screen.id,action:action.id,
    title:action.label,expected:action.to ? ui(`${auditScreenName(action.to)}로 이어져야 해요.`,`Opens ${auditScreenName(action.to)}.`) : ui('조작 뒤 실행될 동작이 필요해요.','The control needs a defined action.'),
  })));
}

function missingRequirementControls() {
  return reviewRequirements().filter(item=>item.action && !screens.get(item.screen).actions.some(action=>action.id===item.action))
    .map(item=>({
      screen:item.screen,action:item.action,title:item.title,requirement:item.id,reason:'missing-control',
      checkId:'requirement-control/'+item.id,expected:item.expected,actual:ui('기획에 있는 조작을 현재 화면에서 찾지 못했어요.','The specified control was missing from the current screen.'),
      initial:context(item.screen).vars,steps:[ui(`${auditScreenName(item.screen)}에서 해당 조작 찾기`,`Find the control on ${auditScreenName(item.screen)}`)],
    }));
}

function collectReviewRows(audit,findings) {
  const cases = audit ? [...audit.journeys,...audit.recovery] : [];
  const observations = cases.flatMap(test=>test.observations);
  const requirements = reviewRequirements();
  const known = new Set(requirements.map(item=>item.id));
  const byRequirement = new Map();
  const unmatched = [];
  for (const finding of findings) {
    const bindings = finding.requirements.filter(id=>known.has(id));
    if (!bindings.length && finding.action) {
      const match = requirements.find(item=>item.screen===finding.screen && item.action===finding.action);
      if (match) bindings.push(match.id);
    }
    if (!bindings.length) unmatched.push(finding);
    for (const id of bindings) {
      if (!byRequirement.has(id)) byRequirement.set(id,[]);
      byRequirement.get(id).push(finding);
    }
  }
  const rows = requirements.map(item=>{
    const linked = observations.filter(check=>model.review.requirements ? check.requirement===item.id :
      check.screen===item.screen && check.action===item.action);
    const planned = model.review.requirements ? cases.reduce((count,test)=>
      count+test.planned.filter(step=>step.requirement===item.id).length,0) : linked.length;
    const issues = byRequirement.get(item.id) || [];
    const status = issues.length ? 'issue' : planned && linked.length===planned ? 'pass' : 'pending';
    return {...item,status,issues,checks:linked.sort((a,b)=>b.route.steps.length-a.route.steps.length),planned};
  });
  for (const finding of unmatched) {
    rows.push({id:'issue/'+finding.key,group:ui('추가로 발견한 문제','Additional issues'),screen:finding.screen,
      title:finding.title,status:'issue',issues:[finding]});
  }
  for (const [index,item] of model.decisions.entries()) {
    const screen = screens.get(item.screen);
    rows.push({id:'decision/'+index,group:model.stages[screen.stage],screen:item.screen,title:item.question,
      status:'decision',issues:[]});
  }
  for (const [index,item] of (original.review.opinions || []).entries()) {
    if (screens.has(item.screen)) rows.push({id:'opinion/'+index,group:ui('직접 확인할 항목','Items to review'),screen:item.screen,
      title:item.text,status:'decision',issues:[]});
  }
  return rows;
}

function reviewEvidence(expected,actual) {
  return write(element('dl','finding-result'),
    element('dt','',ui('더미 검사 기준','Expected in mockup')),element('dd','',expected),element('dt','',ui('실제','Actual')),element('dd','',actual));
}

function showReviewRoute(route) {
  openVerificationFlow(route,{inspectEnd:true,keepFocus:true});
}

function renderPassedChecks(checks) {
  const cases = new Map();
  for (const check of checks) {
    if (!cases.has(check.route.title)) cases.set(check.route.title,[]);
    cases.get(check.route.title).push(check);
  }
  const evidence = element('div','review-observation');
  const renderCase = observations=>{
    const [longest] = observations;
    evidence.replaceChildren(element('p','review-note',longest.route.title),
      ...observations.slice().reverse().map(check=>write(element('div','review-check'),
        element('strong','',check.route.steps.at(-1)?.label),reviewEvidence(check.expected,check.actual))),
      write(element('ol','finding-steps'),...longest.sequence.map(step=>element('li','',step))));
  };
  renderCase(cases.values().next().value);
  const choices = cases.size>1 ? write(element('details'),element('summary','',ui('검사 경로 선택','Choose a test path')),
    write(element('div','finding-actions'),...[...cases].map(([title,observations])=>button(title,'tool',()=>{
      renderCase(observations);
      showReviewRoute(observations[0].route);
    })))) : null;
  return write(element('div'),evidence,choices);
}

function renderReviewItemDetail(item) {
  const detail = element('div','review-item-content');
  if (item.status==='issue') {
    detail.append(...item.issues.map(finding=>{
      const row = renderReviewFinding(finding,!testRun);
      row.querySelector('details').open = true;
      return row;
    }));
  } else if (item.status==='pass') {
    detail.append(element('p','review-note',ui(`실행한 확인 ${item.checks.length}건`,`Checks run: ${item.checks.length}`)),renderPassedChecks(item.checks));
  } else if (item.status==='pending') {
    detail.append(element('p','review-note',item.planned ?
      ui(`연결된 검사 ${item.planned}단계 중 ${item.checks.length}단계를 실행했어요.`,`Executed ${item.checks.length} of ${item.planned} linked steps.`) : ui('이 항목에 연결된 실행 결과가 없어요.','No executed check is linked to this requirement.')));
    if (item.checks.length) detail.append(write(element('details'),element('summary','',ui('실행된 단계 확인','View steps tested')),
      renderPassedChecks(item.checks)));
  }
  if (item.expected && item.status!=='issue') {
    const planning = planningEvidence(item.screen,item.action,[item.id]);
    if (planning.length) detail.prepend(planningList(planning));
  }
  if (item.expected && !item.origin) {
    detail.prepend(element('p','review-expectation',ui('더미 검사 기준 · ','Expected in mockup · ')+item.expected));
  }
  return detail;
}

function selectReviewItem(item, {toggle = false, scroll = false} = {}) {
  const shouldOpen = !toggle || selectedReviewRow!==item.id;
  selectedReviewRow = shouldOpen ? item.id : undefined;
  for (const row of $('findings').querySelectorAll('.review-row')) {
    const open = row.dataset.reviewId===selectedReviewRow;
    row.querySelector('button').setAttribute('aria-expanded',String(open));
    const detail = row.querySelector('.review-item-detail');
    detail.hidden = !open;
    if (open) detail.replaceChildren(renderReviewItemDetail(item));
    else detail.replaceChildren();
  }
  updateIssueRequestButtons();
  if (!shouldOpen) {
    closeVerificationFlow(false);
    return;
  }
  const route = item.issues[0]?.route || (item.status==='pass' ? item.checks[0].route : null);
  if (route) showReviewRoute(route);
  else {
    closeVerificationFlow(false);
    select(item.screen);
    center(true,true);
  }
  if (scroll || toggle) {
    $('findings').querySelector('.review-item[aria-expanded="true"]').scrollIntoView({block:'nearest'});
  }
}

function renderRequirementPanel(audit,findings = []) {
  reviewRows = collectReviewRows(audit,findings);
  const groups = new Map();
  for (const row of reviewRows) {
    if (!groups.has(row.group)) groups.set(row.group,[]);
    groups.get(row.group).push(row);
  }
  $('findings').replaceChildren(...[...groups].map(([name,items])=>write(element('section','review-group'),
    element('h3','',name),write(element('ul','review-list'),...items.map(item=>{
      const row = element('li','review-row');
      row.dataset.reviewId = item.id;
      row.dataset.status = item.status;
      const control = button('','review-item',()=>selectReviewItem(item,{toggle:true}));
      control.setAttribute('aria-expanded','false');
      const detail = element('div','review-item-detail');
      detail.id = 'review-detail-'+reviewRows.indexOf(item);
      detail.hidden = true;
      control.setAttribute('aria-controls',detail.id);
      control.append(element('span','review-number',screenNumber(item.screen)),element('span','review-label',item.title),
        element('span','review-state',reviewStates[item.status]));
      return write(row,control,detail);
    })))));
  $('requirements-summary').textContent = reviewRows.length ?
    Object.entries(reviewStates).map(([status,label])=>label+' '+reviewRows.filter(item=>item.status===status).length).join(' · ') :
    ui('확인할 기획 항목을 추가할 수 있어요.','Add planning requirements to verify.');
  const selected = reviewRows.find(row=>row.id===selectedReviewRow);
  if (selected && !$('review').hidden) selectReviewItem(selected);
  else selectedReviewRow = undefined;
}

function setReviewOpen(open, keepScreen = false) {
  $('work-area').toggleAttribute('data-review-open',open);
  $('review-open').setAttribute('aria-expanded',String(open));
  $('run-checks').hidden = !open;
  $('review').hidden = !open;
  placeWorld();
  if (!open) {
    closeVerificationFlow(false,keepScreen);
    return;
  }
  closeRequestEditor();
  closeDescription();
  renderManualScenarios();
  renderTrace();
}

function openScreenIssues(id) {
  setReviewOpen(true);
  const item = reviewRows.find(row=>row.issues.some(finding=>finding.screen===id));
  if (item) selectReviewItem(item,{scroll:true});
}
