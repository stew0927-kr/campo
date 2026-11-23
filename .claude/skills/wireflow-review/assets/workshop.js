'use strict';

const courses = [
  {action:'open-hand', name:ui('핸드빌딩 입문',"Handbuilding"), area:ui('연남',"Yeonnam"), category:ui('핸드빌딩',"Handbuilding"), duration:ui('90분',"90 min"), price:38000, sample:ui('작은 그릇을 손으로 빚어요.',"Shape a small bowl by hand.")},
  {action:'open-wheel', name:ui('물레 체험',"Wheel throwing"), area:ui('성수',"Seongsu"), category:ui('물레',"Wheel"), duration:ui('120분',"120 min"), price:48000, sample:ui('물레로 나만의 컵을 만들어요.',"Throw a cup on the wheel.")},
  {action:'open-glaze', name:ui('유약 드로잉',"Glaze painting"), area:ui('연남',"Yeonnam"), category:ui('채색',"Painting"), duration:ui('60분',"60 min"), price:28000, sample:ui('초벌 접시에 붓으로 색을 입혀요.',"Paint a bisque-fired plate.")},
];
const regions = [ui('전체',"All"),ui('연남',"Yeonnam"),ui('성수',"Seongsu")];
const categories = [ui('전체',"All"),...courses.map(course=>course.category)];
const dates = [21,22,28,29];
const reservationFields = ['course','date','time','guests','name','email'];
const money = value => ui(value.toLocaleString('ko-KR')+'원','KRW '+value.toLocaleString('en-US'));
const dateLabel = date => ui('11월 '+date+'일','Nov '+date);
const scheduleLabel = vars => dateLabel(vars.date)+' · '+vars.time;
const currentCourse = vars => courses.find(course=>course.name===vars.course);
const savedKey = key => 'booked'+key[0].toUpperCase()+key.slice(1);
const savedReservation = vars => ({...vars,...Object.fromEntries(reservationFields.map(key=>[key,vars[savedKey(key)]]))});

function settingsForm(screen, vars) {
  return write(element('div','stack form-stack'),
    picker(ui('자주 가는 지역',"Preferred neighborhood"),regions,vars.area,value=>vars.area=value,'area'),
    radioGroup(ui('수업 경험',"Experience"),[ui('첫 수업',"First class"),ui('만들어 본 적 있어요',"Some experience")],vars.level,value=>vars.level=value,screen.id+'-level','level'),
    write(element('fieldset','paper-choice-group'),
      element('legend','paper-control-title',ui('수신 설정',"Notifications")),
      choice(ui('예약 알림 받기',"Booking reminders"),'switch',vars.reminders,value=>vars.reminders=value,'reminders'),
      choice(ui('신규 수업 소식 받기',"New class updates"),'check',vars.newsletter,value=>vars.newsletter=value,'newsletter')));
}

function reservationSummary(vars, showContact=false) {
  const course = currentCourse(vars);
  return rows([ui('수업',"Class"),course.name],[ui('일정',"Session"),scheduleLabel(vars)],[ui('수강 인원',"Guests"),vars.guests],
    ...(showContact ? [[ui('예약자',"Booked by"),vars.name || '—'],[ui('이메일',"Email"),vars.email || '—']] : []),
    [ui('결제 금액',"Total"),money(course.price * parseInt(vars.guests))]);
}

function checkoutForm(vars) {
  const form = element('form','stack form-stack');
  form.addEventListener('submit',event=>event.preventDefault());
  for (const [key,label,type,limit] of [['name',ui('예약자 이름',"Your name"),'text',32],['email',ui('이메일',"Email"),'email',80],['memo',ui('요청 사항 (선택)',"Special requests (optional)"),'textarea',80]]) {
    const field = element(type==='textarea'?'textarea':'input','paper-field');
    if (type!=='textarea') field.type = type;
    field.value = vars[key];
    field.dataset.control = key;
    field.maxLength = limit;
    field.required = key!=='memo';
    if (key==='memo') field.rows = 2;
    field.addEventListener('input',()=>vars[key]=field.value);
    form.append(write(element('label','paper-field-label'),element('span','paper-caption',label),field));
  }
  const agreement = choice(ui('예약 및 취소 안내를 읽었어요',"I have read the booking and cancellation terms"),'check',vars.agreed,value=>vars.agreed=value,'agreed');
  agreement.firstElementChild.required = true;
  return write(form,agreement);
}

function courseCard(screen, course) {
  const card = write(button('','course-card',()=>act(screen,course.action)),
    write(element('span','course-copy'),element('strong','paper-control-title',course.name),
      element('span','paper-caption',course.area+' · '+course.duration),element('b','',money(course.price))));
  card.dataset.action = course.action;
  return card;
}

function browseContent(screen,vars) {
  const input = element('input');
  input.type = 'search';
  input.dataset.control = 'query';
  input.placeholder = ui('수업 이름 또는 지역 검색',"Search by class or neighborhood");
  input.value = vars.query;
  input.setAttribute('aria-label',ui('수업 검색',"Search classes"));
  const tags = element('div','filter-tags');
  const list = element('div','course-list');
  const count = element('p','paper-caption');
  count.setAttribute('aria-live','polite');
  const clear = write(button('','',()=>{ input.value=''; refresh(); input.focus(); }),icon('clear'));
  clear.setAttribute('aria-label',ui('검색어 지우기',"Clear search"));
  clear.dataset.control = 'clear-query';
  const form = write(element('form','paper-search'),icon('search'),input,clear);
  form.setAttribute('role','search');
  function refresh() {
    vars.query = input.value;
    const query = vars.query.trim().toLowerCase();
    const matches = courses.filter(course=> (vars.area===ui('전체',"All") || course.area===vars.area)
      && (vars.category===ui('전체',"All") || course.category===vars.category)
      && [course.name,course.area,course.category].some(value=>value.toLowerCase().includes(query)));
    count.textContent = ui(matches.length+'개 수업',matches.length+(matches.length===1?' class':' classes'));
    const empty = actionButton(screen,'empty');
    empty.textContent = ui('빈 결과 화면 보기',"View empty results");
    list.replaceChildren(...(matches.length ? matches.map(course=>courseCard(screen,course)) : [empty]));
    tags.replaceChildren(...['area','category'].filter(key=>vars[key]!==ui('전체',"All")).map(key=>{
      const remove = write(button('','',()=>{ vars[key]=ui('전체',"All"); refresh(); input.focus(); }),icon('clear','small'));
      remove.setAttribute('aria-label',ui(vars[key]+' 필터 제거','Remove '+vars[key]+' filter'));
      remove.dataset.control = 'clear-'+key;
      return write(element('span','paper-tag'),vars[key],remove);
    }));
    return matches.length;
  }
  refresh();
  input.addEventListener('input',refresh);
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if (!refresh()) act(screen,'empty');
  });
  return write(element('div','stack'),write(element('div','search-row'),form,
    actionButton(screen,'filters','outline','small')),tags,count,list);
}

function datePicker(vars) {
  const calendar = element('div','paper-date-grid');
  calendar.setAttribute('role','group');
  calendar.setAttribute('aria-label',ui('11월 날짜',"November dates"));
  for (const day of [ui('월',"Mon"),ui('화',"Tue"),ui('수',"Wed"),ui('목',"Thu"),ui('금',"Fri"),ui('토',"Sat"),ui('일',"Sun")]) calendar.append(element('span','',day));
  for (let day=16;day<=29;day++) {
    if (!dates.includes(day)) {
      calendar.append(element('span','calendar-muted',String(day)));
      continue;
    }
    const control = button(String(day),'',()=>{
      vars.date=day;
      for (const sibling of calendar.querySelectorAll('button')) sibling.setAttribute('aria-pressed',String(sibling===control));
    });
    control.setAttribute('aria-label',dateLabel(day));
    control.dataset.control = 'date';
    control.value = String(day);
    control.setAttribute('aria-pressed',String(vars.date===day));
    calendar.append(control);
  }
  return calendar;
}

function statusToast(text, mark) {
  const toast = element('div','paper-toast');
  toast.setAttribute('role','status');
  const close = write(button('','paper-dismiss',()=>toast.remove()),icon('close'));
  close.setAttribute('aria-label',ui('알림 닫기',"Dismiss notification"));
  close.dataset.control = 'dismiss-toast';
  return write(toast,icon(mark),element('span','paper-caption',text),close);
}

function reservationCard(screen, vars) {
  if (vars.reservation===ui('없음',"None")) return element('p','paper-notice',ui('아직 예약한 수업이 없어요.',"You have no bookings yet."));
  const booking = savedReservation(vars);
  return write(element('div','paper-panel reservation-card'),badge(booking.reservation,'outline'),
    element('h3','paper-h3',booking.course),element('p','paper-caption',scheduleLabel(booking)),
    ...(booking.reservation===ui('예약 중',"Booked") ? [actionButton(screen,'detail','outline','small')] : []));
}

function renderContent(body,screen,vars) {
  const course = currentCourse(vars);
  switch (screen.id) {
    case 'welcome':
      body.append(intro(ui('흙으로 보내는 오후',"Book a pottery class"),ui('연남과 성수의 도예 공방에서 원하는 수업을 골라보세요.',"Choose a class in Yeonnam or Seongsu."),ui('주말 도예 클래스',"Weekend classes")),
        write(element('div','filter-tags'),...categories.slice(1).map(text=>element('span','paper-tag',text))));
      break;
    case 'setup':
      body.append(intro(ui('내 취향으로 시작하기',"Set your preferences"),ui('지역과 수업 경험은 나중에 설정에서 바꿀 수 있어요.',"You can change these in Settings.")),settingsForm(screen,vars));
      break;
    case 'browse':
    case 'filters':
      body.append(intro(ui('수업 둘러보기',"Browse classes"),ui('하고 싶은 작업과 시간을 골라보세요.',"Choose a technique or filter by neighborhood."),ui('도예 공방 예약',"Pottery class booking")),browseContent(screens.get('browse'),vars));
      break;
    case 'class':
      body.append(intro(course.name,course.sample,course.area+' · '+course.category),
        rows([ui('수업 시간',"Duration"),course.duration],[ui('수강료 (1인)',"Price per guest"),money(course.price)],[ui('준비물',"Materials"),ui('앞치마와 도구 제공',"Apron and tools provided")]),
        faq(ui('완성한 작품은 언제 받나요?',"When can I collect my work?"),ui('가마 작업 후 약 3주 안에 공방에서 받아요.',"Collect it from the studio about three weeks after firing.")));
      break;
    case 'schedule':
      body.append(intro(ui('가능한 날짜를 골라요',"Choose a session"),null,course.name),write(element('div','stack'),
        element('h3','paper-h3',ui('2026년 11월',"November 2026")),datePicker(vars),
        picker(ui('시작 시간',"Start time"),['11:00','14:00','16:00'],vars.time,value=>vars.time=value,'time'),
        picker(ui('수강 인원',"Guests"),[ui('1명',"1 guest"),ui('2명',"2 guests"),ui('3명',"3 guests")],vars.guests,value=>vars.guests=value,'guests')));
      break;
    case 'checkout':
    case 'confirm': {
      const form = checkoutForm(vars);
      body.append(intro(ui('예약 정보 입력',"Enter booking details"),course.name+' · '+scheduleLabel(vars)),form,
        faq(ui('예약 및 취소 안내',"Booking and cancellation terms"),ui('예약을 확정하면 이메일로 안내해요. 취소 가능 여부는 예약 상세에서 확인할 수 있어요.',"Check your confirmation email. Manage cancellation from your booking.")));
      return ()=>form.reportValidity();
    }
    case 'success':
      body.append(statusToast(ui('예약 확인 메일을 보냈어요',"Confirmation email sent"),'check'),intro(ui('예약이 완료됐어요',"Booking confirmed"),ui('공방에서 만나요.',"Your place is reserved."),ui('예약 번호 #CL-2108',"Booking #CL-2108")),
        reservationSummary(savedReservation(vars)));
      break;
    case 'bookings':
      body.append(intro(ui('내 예약',"My bookings"),ui('다가오는 일정과 예약 상태를 확인하세요.',"Check upcoming sessions and their status.")),write(element('div','stack'),reservationCard(screen,vars)));
      break;
    case 'booking':
    case 'cancel': {
      const booking = savedReservation(vars);
      body.append(intro(booking.course,ui('예약 번호 #CL-2108',"Booking #CL-2108")),write(element('div','stack'),badge(booking.reservation,'outline'),reservationSummary(booking,true),
        faq(ui('수업 당일 안내',"Before your class"),ui('시작 10분 전 공방으로 와 주세요.',"Arrive ten minutes before the class starts."))));
      break;
    }
    case 'cancelled': {
      const booking = savedReservation(vars);
      body.append(statusToast(ui('내 예약에 취소 상태가 표시돼요',"Status updated in My bookings"),'check'),intro(ui('예약을 취소했어요',"Booking cancelled"),scheduleLabel(booking),booking.course));
      break;
    }
    case 'settings':
      body.append(intro(ui('설정',"Settings"),ui('추천과 알림을 변경할 수 있어요.',"Update preferences and notifications.")),settingsForm(screen,vars));
      break;
    case 'search-empty':
      body.append(intro(ui('일치하는 수업이 없어요','No matching classes'),vars.query.trim()?ui('‘'+vars.query.trim()+'’에 맞는 수업을 찾지 못했어요.','No classes match “'+vars.query.trim()+'”.'):ui('선택한 지역과 종류에 맞는 수업을 찾지 못했어요.','No classes match these filters.'),ui('검색 결과','Search results')),
        element('p','paper-notice empty-notice',ui('검색어와 필터를 초기화하면 전체 수업을 볼 수 있어요.',"Reset the search and filters to see all classes.")));
      break;
    case 'payment-error':
      body.append(intro(ui('결제를 완료하지 못했어요',"Payment could not be completed"),ui('예약 정보와 일정은 그대로예요.',"Your session and contact details are saved in this draft.")),element('p','paper-notice empty-notice',ui('결제를 다시 시도하거나 예약 정보를 확인할 수 있어요.',"Retry the payment or edit your details.")),
        reservationSummary(vars));
      break;
  }
}

function popup(screen,vars) {
  const close = closeButton(screen);
  const heading = element('h2','paper-h2',
    {filters:ui('필터',"Filters"),confirm:ui('이 내용으로 예약할까요?',"Confirm your booking?"),cancel:ui('예약을 취소할까요?',"Cancel this booking?")}[screen.id]);
  heading.id = screen.id+'-popup-title';
  const panel = write(element('section','paper-modal'),write(element('header','popup-head'),heading,close));
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-labelledby',heading.id);
  const actions = element('div','paper-modal-actions');
  if (screen.id==='filters') {
    const draft = {area:vars.area, category:vars.category};
    panel.append(write(element('div','stack'),picker(ui('공방 지역',"Neighborhood"),regions,draft.area,value=>draft.area=value,'area'),
      radioGroup(ui('수업 종류',"Technique"),categories,draft.category,value=>draft.category=value,'filter-category','category')));
    const apply = actionButton(screen,'apply','filled','medium',{updates:draft});
    actions.append(apply);
  } else if (screen.id==='confirm') {
    panel.append(reservationSummary(vars,true));
    const updates = Object.fromEntries(reservationFields.map(key=>[savedKey(key),vars[key]]));
    actions.append(actionButton(screen,'close','text'),actionButton(screen,'pay','filled','medium',{updates}));
  } else {
    const booking = savedReservation(vars);
    panel.append(element('p','lead',booking.course+' · '+scheduleLabel(booking)),
      element('p','lead',ui('취소하면 이 수업의 자리가 반환돼요.',"Cancelling releases your places in this class.")));
    actions.append(actionButton(screen,'close','text'),actionButton(screen,'cancel','filled'));
  }
  panel.append(actions);
  panel.addEventListener('keydown',event=>{
    if (event.key==='Escape') { event.preventDefault(); close.click(); }
  });
  return write(element('div','popup-layer'),panel);
}

function appTabs(screen) {
  const tabs = element('nav','tabbar');
  tabs.setAttribute('aria-label',ui('도예 공방',"Pottery classes"));
  for (const [id,label] of [['browse',ui('수업',"Classes")],['bookings',ui('내 예약',"My bookings")],['settings',ui('설정',"Settings")]]) {
    const tab = button(label,'paper-tab',()=>{ if (id!==screen.id) act(screen,id); });
    if (id===screen.id) {
      tab.setAttribute('aria-current','page');
      tab.dataset.control = 'current-tab';
    } else tab.dataset.action = id;
    tabs.append(tab);
  }
  return tabs;
}

function workshopScreen(screen,current) {
  const device = element('div','device paper-ui paper-hand-labels');
  device.dataset.kind = screen.id;
  const {vars} = current;
  const underlay = {filters:'browse',confirm:'checkout',cancel:'booking'}[screen.id];
  const base = underlay ? screens.get(underlay) : screen;
  const status = write(element('div','statusbar'),'9:41',
    write(element('span','indicators'),element('i','signal'),element('i','battery')));
  status.setAttribute('aria-hidden','true');
  const back = base.actions.find(action=>action.kind==='back');
  const hasTabs = base.actions.some(action=>action.kind==='tab');
  const header = write(element('div','appbar'),element('span','paper-h3',ui('도예 공방',"Pottery classes")),
    back && actionButton(base,back.id,'text','small'));
  const body = element('div','app-content');
  const guard = renderContent(body,screen,vars);
  const feedback = element('p','screen-error paper-notice',screen.id===active ? message : '');
  feedback.setAttribute('role','status');
  body.append(feedback);
  const footer = element('div','app-actions');
  for (const action of base.actions.filter(action=>!action.kind || action.kind==='secondary')) {
    footer.append(actionButton(base,action.id,action.kind==='secondary'?'text':'filled',
      action.kind==='secondary'?'medium':'large',{guard}));
  }
  const surface = write(element('div','app-surface'),status,header,body,footer.childElementCount?footer:null,hasTabs?appTabs(base):null);
  surface.inert = Boolean(underlay);
  return write(device,surface,underlay?popup(screen,vars):null);
}

function workshopRequestContext(id,current) {
  const vars = ['success','bookings','booking','cancel','cancelled'].includes(id) ? savedReservation(current) : current;
  return [vars.course,scheduleLabel(vars),vars.guests,vars.reservation,
    vars.area,vars.category,vars.query?ui('검색어 ',"Search: ")+vars.query:''].filter(Boolean).join(' · ');
}

