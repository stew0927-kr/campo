'use strict';

const auditStateLabels = {
  area:ui('지역','Area'), category:ui('수업 종류','Class type'), query:ui('검색어','Search query'), course:ui('수업','Class'), date:ui('날짜','Date'), time:ui('시간','Time'),
  guests:ui('인원','Guests'), name:ui('예약자 이름','Booked by'), email:ui('이메일','Email'), memo:ui('요청 사항','Special requests'), agreed:ui('안내 확인','Acknowledgment'),
  level:ui('수업 경험','Class experience'), reminders:ui('예약 알림','Booking reminders'), newsletter:ui('수업 소식','Class news'), reservation:ui('예약 상태','Booking status'),
  bookedDate:ui('확정 날짜','Confirmed date'), bookedTime:ui('확정 시간','Confirmed time'), bookedGuests:ui('확정 인원','Confirmed guests'), bookedName:ui('확정 예약자','Confirmed name'),
  bookedCourse:ui('확정 수업','Confirmed class'), bookedEmail:ui('확정 이메일','Confirmed email'),
};

function auditScreenName(id) {
  const screen = screens.get(id);
  return screen ? screenNumber(id)+' '+screen.title : (id || ui('목적지 없음','No destination'));
}

function auditValue(value) {
  if (typeof value==='boolean') return value?ui('켜짐','On'):ui('꺼짐','Off');
  return value===undefined?ui('값 없음','No value'):value===''?ui('빈 값','Empty'):String(value);
}

function auditValues(values) {
  return Object.entries(values).map(([key,value])=>(model.review.stateLabels?.[key] || auditStateLabels[key] || key)+' '+auditValue(value)).join(', ');
}

function renderAuditSurface(current) {
  const screen = screens.get(current.screen);
  return write(element('div'),mobile(screen,current),...simulationControls(screen,current.vars));
}

function auditControlName(control) {
  const label = control.labels?.[0] || control.closest('label');
  const text = label?.querySelector('span')?.textContent?.trim() || label?.textContent.trim();
  return control.getAttribute('aria-label') || text || control.querySelector('.paper-control-title')?.textContent.trim() ||
    control.textContent.trim() || control.dataset.control;
}

function withAuditWorkspace(run) {
  const host = element('div','audit-surface');
  host.setAttribute('aria-hidden','true');
  const shadow = host.attachShadow({mode:'closed'});
  shadow.addEventListener('invalid',event=>event.preventDefault(),true);
  const area = element('div','canvas');
  area.dataset.device = canvas.dataset.device;
  area.style.setProperty('--artboard-width',screenWidth+'px');
  area.style.setProperty('--artboard-height',screenHeight+'px');
  shadow.append(document.head.querySelector('style').cloneNode(true),area);
  document.body.append(host);
  const mount = (surface,work)=>{
    const focused = document.activeElement;
    area.replaceChildren(surface);
    try { return work(); }
    finally {
      if (document.activeElement===host) focused?.focus({preventScroll:true});
      surface.remove();
    }
  };
  try { return run(mount); }
  finally { host.remove(); }
}

function renderedAuditControls(surface) {
  const occurrences = new Map();
  return [...surface.querySelectorAll('button, input, select, textarea, summary, a[href]')]
    .filter(control=>!control.closest('[inert],[hidden],[aria-hidden="true"]') && !control.matches(':disabled,[readonly]'))
    .filter(control=>control.getClientRects().length>0 && getComputedStyle(control).visibility==='visible')
    .map(control=>{
      const action = control.dataset.action;
      const field = control.dataset.control || (control.tagName==='SUMMARY'?'details':null);
      const label = auditControlName(control) || ui('이름 없는 조작','Unnamed control');
      const stem = JSON.stringify([action,field,control.tagName,field?label:null]);
      const occurrence = (occurrences.get(stem)||0)+1;
      occurrences.set(stem,occurrence);
      return {control,action,field,label,key:stem+' #'+occurrence};
    });
}

function clickForAudit(current,control) {
  const prior = auditRun;
  const run = {current};
  auditRun = run;
  try {
    control.click();
    return run.result;
  } finally {
    auditRun = prior;
  }
}

function auditLocalControl(entry,current,surface) {
  const {control,field} = entry;
  const {vars} = current;
  let expected, actual;
  const changeInput = (input,value,event)=> {
    input.value = value;
    input.dispatchEvent(new Event(event,{bubbles:true}));
  };
  if (field==='details') {
    const details = control.closest('details');
    expected = !details.open;
    control.click();
    actual = details.open;
    return {expected:expected?ui('안내 열림','Help open'):ui('안내 닫힘','Help closed'),actual:actual?ui('안내 열림','Help open'):ui('안내 닫힘','Help closed')};
  }
  if (field==='current-tab') {
    const result = clickForAudit(current,control);
    return {expected:ui('현재 탭 유지','Current tab stays selected'),actual:result ? result.error || auditScreenName(result.session.screen) :
      control.getAttribute('aria-current')==='page'?ui('현재 탭 유지','Current tab stays selected'):ui('선택 표시가 사라졌어요.','The selected state disappeared.')};
  }
  if (field==='dismiss-toast') {
    const toast = control.closest('.paper-toast');
    control.click();
    return {expected:ui('알림 닫힘','Notification dismissed'),actual:surface.contains(toast)?ui('알림 열림','Notification shown'):ui('알림 닫힘','Notification dismissed')};
  }
  if (field==='clear-query') {
    changeInput(surface.querySelector('input[type=search]:not([readonly])'),ui('목공','woodwork'),'input');
    control.click();
    return {expected:ui('검색어 비움','Search cleared'),actual:vars.query===''?ui('검색어 비움','Search cleared'):ui('검색어 ','Search term ')+auditValue(vars.query)};
  }
  if (field==='clear-area' || field==='clear-category') {
    const filter = field.slice(6);
    control.click();
    return {expected:ui('전체','All'),actual:auditValue(vars[filter])};
  }
  if (workshop && field==='date') {
    expected = Number(control.value);
    control.click();
    actual = vars.date;
    if (actual===expected && control.getAttribute('aria-pressed')!=='true') actual = ui('선택 표시 없음','No selection indicator');
  } else if (control.tagName==='SELECT') {
    expected = [...control.options].find(option=>!option.disabled && option.value!==control.value)?.value ?? control.value;
    changeInput(control,expected,'change');
  } else if (control.type==='radio') {
    expected = control.value;
    control.click();
    if (!control.checked) return {expected:ui('선택됨','Selected'),actual:ui('선택 표시 없음','No selection indicator')};
  } else if (control.type==='checkbox') {
    expected = !control.checked;
    control.click();
  } else {
    expected = workshop ? {query:ui('목공','woodwork'),name:ui('이름 검증','Test name'),email:'audit@example.com',memo:ui('요청 사항 검증','Test request')}[field] :
      control.type==='email'?'audit@example.com':control.type==='url'?'https://example.com':control.type==='tel'?'01012345678':ui('검증 입력','Test input');
    if (expected===undefined) return;
    changeInput(control,expected,'input');
  }
  if (workshop && current.screen==='filters') {
    const apply = renderedAuditControls(surface).find(entry=>entry.action==='apply');
    const result = apply && clickForAudit(current,apply.control);
    actual = result?.session?.vars[field];
  } else if (!workshop || field!=='date') actual = vars[field];
  return {expected:auditValue(expected),actual:auditValue(actual)};
}

function auditExpected(current,step) {
  if (step.inspect) return step.inspect.absent ? ui('이 상태에서는 조작이 숨겨져야 해요.','The control should be hidden in this state.') : step.inspect.text.join(' · ');
  const values = {...Object.fromEntries((step.keep || []).map(key=>[key,current.vars[key]])),...step.vars};
  return [step.screen && auditScreenName(step.screen),auditValues(values),step.blocked?ui('필수 입력 안내','Required-field message'):''].filter(Boolean).join(' · ');
}

function auditCaseKey(test) {
  return JSON.stringify(['case',test.kind || '브라우저 조작',test.title,test.start,test.initial]);
}

function runBrowserCase(test,flow,mount,passedChecks,observations) {
  let current = {screen:test.start,vars:{...flow.vars,...test.initial}};
  const sequence = [ui(`${auditScreenName(test.start)}에서 시작`,`Start on ${auditScreenName(test.start)}`)+(test.initial?' · '+auditValues(test.initial):'')];
  const route = {title:test.title,kind:test.kind==='전체 여정' ? ui('전체 여정','End-to-end journey') : test.kind || ui('브라우저 조작','Browser interaction'),start:test.start,initial:{...current.vars},steps:[]};
  const caseKey = auditCaseKey(test);
  let checkId;
  const observe = (step,actual)=>{
    const expected = auditExpected(current,step) || (step.field ? auditValues({[step.field]:step.value}) : '');
    if (!expected) return;
    observations.push({requirement:step.requirement,screen:current.screen,action:step.action,expected,actual,
      sequence:[...sequence],route:{...route,steps:[...route.steps]}});
  };
  const failed = (step,actual,reason,fields=[],cause)=>{
    const finding = {screen:current.screen,title:test.title,steps:sequence,expected:auditExpected(current,step) || ui('정의한 화면 조작이 실행되어야 해요.','The defined control should work.'),
      actual,action:step.action,selector:step.selector || step.inspect?.selector,requirement:step.requirement};
    route.issue = {screen:finding.screen,action:step.action,field:step.field,selector:finding.selector,
      expectedScreen:step.screen,expected:finding.expected,actual};
    const title = step.inspect?.title || route.steps.at(-1)?.label || finding.title;
    return {title:test.title,sequence,route,finding:{...finding,title,field:step.field,reason,fields,checkId,cause,
      expectedScreen:step.screen,initial:{...current.vars},route}};
  };
  for (const [index,step] of test.steps.entries()) {
    const id = current.screen;
    const {requirement,...definition} = step;
    checkId = JSON.stringify([caseKey,index,id,definition]);
    const surface = renderAuditSurface(current);
    const inventory = mount(surface,()=>renderedAuditControls(surface));
    if (step.field || step.inspect) {
      const before = {...current.vars};
      const input = inventory.find(entry=>entry.field===step.field &&
        (!step.selector || entry.control.matches(step.selector)));
      const label = input?.label || auditStateLabels[step.field] || step.field;
      const localLabel = step.inspect ? step.inspect.title :
        ui(label+(step.type==='click' ? ' 누르기' : ' ‘'+step.value+'’ '+(step.type==='input'?'입력':'선택')),
          step.type==='click' ? `Click ${label}` : `${step.type==='input'?'Enter':'Select'} “${step.value}” in ${label}`);
      sequence.push(ui(`${auditScreenName(id)}에서 ${localLabel}`,`${auditScreenName(id)} · ${localLabel}`));
      const visit = {from:id,field:step.field,label:localLabel,before};
      route.steps.push(visit);
      let actual;
      if (step.inspect) {
        const {selector,absent,text,exact} = step.inspect;
        if (absent) {
          const shown = mount(surface,()=>[...surface.querySelectorAll(selector)].find(node=>
            !node.closest('[hidden],[aria-hidden="true"]') && node.getClientRects().length>0 &&
            getComputedStyle(node).visibility==='visible'));
          if (shown) {
            return failed({...step,screen:id,action:shown.dataset.action,selector},ui('기대와 달리 화면에 표시됐어요.','The control was visible.'),'unexpected-content');
          }
          actual = ui('조작이 화면에 표시되지 않았어요.','The control was hidden.');
        } else {
          const matches = mount(surface,()=>surface.querySelector(selector)?.innerText.trim().replace(/\s+/g,' '));
          if (!matches || !(exact ? matches===text.join(' ') : text.every(fragment=>matches.includes(fragment)))) {
            return failed({...step,screen:id},matches || ui('확인할 화면 내용이 표시되지 않았어요.','The expected screen content was missing.'),exact?'wrong-state':'missing-content',exact?[]:text);
          }
          actual = matches;
        }
      } else {
        if (!input || (step.type==='select' &&
            ![...input.control.options].some(option=>option.value===step.value && !option.disabled))) {
          return failed({...step,screen:id},ui('검증할 조작이나 선택지를 찾지 못했어요.','The control or option to test was missing.'),'missing-control');
        }
        mount(surface,()=>{
          if (step.type==='click') input.control.click();
          else {
            input.control.value = step.value;
            input.control.dispatchEvent(new Event(step.type==='input'?'input':'change',{bubbles:true}));
          }
        });
        if (current.vars[step.field]!==step.value) {
          return failed({...step,screen:id,vars:{[step.field]:step.value}},
            auditValues({[step.field]:current.vars[step.field]}),'wrong-state',[step.field]);
        }
        actual = auditValues({[step.field]:current.vars[step.field]});
      }
      visit.after = {...current.vars};
      observe(step,actual);
      passedChecks.add(checkId);
      continue;
    }
    for (const [field,value] of Object.entries(step.select || {})) {
      const input = inventory.find(entry=>entry.field===field && entry.control.tagName==='SELECT');
      const fieldName = auditStateLabels[field] || field;
      const label = ui(`${fieldName} ‘${value}’ 선택`,`Select “${value}” in ${fieldName}`);
      sequence.push(ui(`${auditScreenName(id)}에서 ${label}`,`${auditScreenName(id)} · ${label}`));
      if (!input || ![...input.control.options].some(option=>option.value===value && !option.disabled)) {
        return failed(step,ui('검증할 선택지를 찾지 못했어요.','The option to test was missing.'),'missing-control');
      }
      mount(surface,()=>{
        input.control.value = value;
        input.control.dispatchEvent(new Event('change',{bubbles:true}));
      });
      route.steps.push({from:id,label,before:{...current.vars}});
    }
    const control = inventory.find(entry=>entry.action===step.action && (!step.selector || entry.control.matches(step.selector)));
    const name = control?.label || screens.get(id).actions.find(action=>action.id===step.action)?.label ||
      flow.review.requirements?.find(item=>item.id===step.requirement)?.title || step.action;
    sequence.push(ui(`${auditScreenName(id)}에서 ‘${name}’ 누르기`,`${auditScreenName(id)} · Click “${name}”`));
    const visit = {from:id,action:step.action,label:name,before:{...current.vars}};
    route.steps.push(visit);
    if (!control) return failed(step,ui('화면에서 실행할 조작을 찾지 못했어요.','The action could not be found on screen.'),'missing-control');
    const result = mount(surface,()=>clickForAudit(current,control.control));
    const next = result?.session;
    if (next) Object.assign(visit,{to:next.screen,after:{...next.vars}});
    if (step.blocked && result?.blocked && (!step.screen || current.screen===step.screen)) {
      visit.after = {...current.vars};
      observe(step,ui('필수 입력이 비어 있어 현재 화면에 머물렀어요.','A required field was empty, so the current screen stayed open.'));
      passedChecks.add(checkId);
      continue;
    }
    const values = {...Object.fromEntries((step.keep || []).map(key=>[key,current.vars[key]])),...step.vars};
    const changed = next ? Object.keys(values).filter(key=>next.vars[key]!==values[key]) : [];
    const wrongDestination = step.screen && next?.screen!==step.screen;
    if (!next || wrongDestination || changed.length || step.blocked) {
      const actual = next ? [auditScreenName(next.screen),auditValues(Object.fromEntries(Object.keys(values).map(key=>[key,next.vars[key]])))].filter(Boolean).join(' · ') :
        result?.error || ui(`${auditScreenName(id)}에 머물렀어요.`,`Stayed on ${auditScreenName(id)}.`);
      const reason = step.blocked || result?.blocked ? 'wrong-guard' :
        !next ? 'missing-transition' : wrongDestination ? 'wrong-destination' : 'wrong-state';
      return failed(step,actual,reason,changed,reason==='missing-transition' ? result?.errorCode : undefined);
    }
    observe(step,[auditScreenName(next.screen),auditValues(Object.fromEntries(Object.keys(values).map(key=>[key,next.vars[key]])))].filter(Boolean).join(' · '));
    passedChecks.add(checkId);
    current = next;
  }
  passedChecks.add(caseKey);
  return {title:test.title,sequence,route,result:auditScreenName(current.screen)};
}

function runWorkshopAudit(flow) {
  return withAuditWorkspace(mount=>inspectWorkshop(flow,mount));
}

function inspectWorkshop(flow,mount) {
  const findings = [];
  const passedChecks = new Set();
  const seen = new Set();
  const modeled = new Set();
  const available = new Map();
  let checked = 0;
  let passed = 0;
  const fixtures = [
    ...(flow.review.audit?.fixtures || []),
    ...flow.screens.map(({id,preview})=>({screen:id,vars:preview,title:ui('기본 화면 상태','Default screen state'),primary:true})),
  ];
  for (const fixture of fixtures) {
    const screen = screens.get(fixture.screen);
    const create = ()=>({screen:screen.id,vars:{...flow.vars,...screen.preview,...fixture.vars}});
    const start = [ui(`${auditScreenName(screen.id)} 열기`,`Open ${auditScreenName(screen.id)}`),fixture.title,auditValues(fixture.vars || {})].filter(Boolean).join(' · ');
    const fixtureId = JSON.stringify(['render',screen.id,fixture.primary ? '기본 화면 상태' : fixture.title,fixture.vars]);
    let inventory;
    try {
      const current = create();
      for (const action of screen.actions.filter(action=>Wireflow.available(action,current.vars))) {
        const key = screen.id+'/'+action.id;
        const priority = fixture.expects?.includes(action.id) ? 2 : Number(Boolean(fixture.primary));
        if ((available.get(key)?.priority ?? -1)<priority) {
          available.set(key,{screen:screen.id,action,start,priority});
        }
      }
      const surface = renderAuditSurface(current);
      inventory = mount(surface,()=>renderedAuditControls(surface));
      passedChecks.add(fixtureId);
    } catch {
      findings.push({screen:screen.id,title:ui('화면을 구성하지 못했어요.','The screen failed to render.'),steps:[start],checkId:fixtureId,
        expected:ui('화면과 조작이 표시됩니다.','The screen and its controls should be visible.'),actual:ui('대표 상태에서 화면을 표시하지 못했어요.','The screen could not be shown in this test state.')});
      continue;
    }
    for (const entry of inventory) {
      const key = screen.id+'/'+entry.key;
      if (seen.has(key)) continue;
      seen.add(key);
      const steps = [start,ui(`‘${entry.label}’ 조작하기`,`Use “${entry.label}”`)];
      const action = screen.actions.find(action=>action.id===entry.action);
      const controlId = JSON.stringify(['control',fixtureId,entry.key]);
      const destinationId = JSON.stringify([controlId,action?.to]);
      if (action) modeled.add(screen.id+'/'+action.id);
      const current = create();
      let check;
      try {
        const surface = renderAuditSurface(current);
        check = mount(surface,()=>{
          const target = renderedAuditControls(surface).find(item=>item.key===entry.key);
          if (!target) return {expected:ui('화면에 표시된 조작 실행','The visible control should work.'),actual:ui('실행할 조작을 찾지 못했어요.','The action could not be found.')};
          if (!entry.action) return entry.field && auditLocalControl(target,current,surface);
          const result = clickForAudit(current,target.control);
          if (result?.blocked && action?.validate) {
            return {expected:ui('필수 입력 확인','Required field validation'),actual:ui('필수 입력 확인','Required field validation'),blocked:true};
          }
          const expected = action && screens.has(action.to) ? auditScreenName(action.to) : ui('실행할 수 있는 목적지 연결','A reachable destination');
          const actual = result?.session ? auditScreenName(result.session.screen) :
            !action ? ui('화면에 조작은 있지만 모델 연결이 빠졌어요.','The mockup shows the control, but its model link is missing.') :
              result?.error || ui(`${auditScreenName(screen.id)}에 머물렀어요.`,`Stayed on ${auditScreenName(screen.id)}.`);
          return {expected,actual,expectedScreen:action?.to,actualScreen:result?.session?.screen,cause:result?.errorCode,
            reason:result?.session?'wrong-destination':result?.blocked?'wrong-guard':'missing-transition'};
        });
      } catch {
        check = {expected:ui('화면 이동이나 화면 안 상태 변화','The screen or its state should change.'),actual:ui('브라우저에서 조작을 완료하지 못했어요.','The browser could not complete the action.')};
      }
      if (check) {
        checked++;
        if (check.expected===check.actual) {
          passed++;
          if (!check.blocked) {
            passedChecks.add(controlId);
            if (action) {
              passedChecks.add(destinationId);
              passedChecks.add('action/'+screen.id+'/'+action.id);
            }
          }
          continue;
        }
      }
      findings.push({screen:screen.id,action:entry.action,field:entry.field,title:entry.label,steps,initial:create().vars,
        checkId:check?.reason==='wrong-destination' ? destinationId : controlId,
        expectedScreen:check?.expectedScreen,actualScreen:check?.actualScreen,cause:check?.cause,
        reason:check?.reason || (entry.field?'wrong-state':'unknown-control'),
        expected:check?.expected || ui('화면 이동이나 화면 안 상태 변화','The screen or its state should change.'),
        actual:check?.actual || ui('조작의 동작이 정의되어 있지 않아요.','The control has no defined behavior.')});
    }
  }
  for (const [key,{screen,action,start}] of available) {
    if (modeled.has(key)) continue;
    findings.push({screen,action:action.id,title:action.label,steps:[start,ui(`‘${action.label}’ 찾기`,`Find “${action.label}”`)],expectedScreen:action.to,
      checkId:'action/'+key,
      reason:'missing-control',expected:ui(`조작을 실행해 ${auditScreenName(action.to)}에 도달합니다.`,`The action opens ${auditScreenName(action.to)}.`),
      actual:ui('실행 가능한 상태의 화면에서 조작을 찾지 못했어요.','The control was missing in a state where it should work.')});
  }
  const execute = definition=>{
    const test = {...definition,start:definition.start ?? flow.start};
    const coverage = {planned:test.steps,observations:[]};
    try { return {...coverage,...runBrowserCase(test,flow,mount,passedChecks,coverage.observations)}; }
    catch {
      return {...coverage,title:test.title,finding:{screen:test.start,title:test.title,steps:[ui(`${auditScreenName(test.start)} 열기`,`Open ${auditScreenName(test.start)}`)],
        checkId:auditCaseKey(test),
        expected:ui('해당 상태에서 화면과 조작을 표시하고 시나리오를 실행합니다.','The screen and its controls should render and the scenario should run.'),actual:ui('브라우저에서 시나리오를 실행할 수 없었어요.','The browser could not run the scenario.')}};
    }
  };
  const recovery = (flow.review.audit?.recovery || []).map(execute);
  const journeys = (flow.review.audit?.journeys ?? (workshop ? [] : flow.scenarios)).map(test=>execute({...test,kind:'전체 여정'}));
  findings.push(...[...recovery,...journeys].flatMap(item=>item.finding?[item.finding]:[]));
  const exploration = flow.review.audit?.explore ? exploreBrowserFlow(flow,mount,passedChecks) : undefined;
  if (exploration) findings.push(...exploration.findings);
  const modelTotal = flow.screens.reduce((count,screen)=>count+screen.actions.length,0);
  return {findings,recovery,journeys,passedChecks,exploration,
    coverage:{visible:seen.size,checked,passed,modeled:modeled.size,modelTotal,fixtures:fixtures.length}};
}
