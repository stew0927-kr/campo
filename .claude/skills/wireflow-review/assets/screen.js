'use strict';

function interpolate(text, vars) {
  return String(text ?? '').replace(/\{\{([\w-]+)\}\}/g,
    (match,key)=>Object.hasOwn(vars,key)?String(vars[key]):match);
}

// Keep the live input elements (and their focus/caret) while guarded controls change.
function actionRegions(screen,vars,form) {
  const available = ()=>screen.actions.filter(action=>Wireflow.available(action,vars));
  let actions = available();
  const regions = [];
  function refresh() {
    const next = available();
    if (next.length===actions.length && next.every((item,i)=>item===actions[i])) return;
    actions = next;
    for (const region of regions) {
      const replacement = region.build(actions) || document.createComment('action');
      region.node.replaceWith(replacement);
      region.node = replacement;
    }
    const device = form.closest('.device');
    if (device) markRouteControls(device,screen.id);
    if (form.closest('.artboard.is-active')) renderSimulation();
  }
  if (screen.actions.some(action=>action.when)) {
    form.addEventListener('input',refresh);
    form.addEventListener('change',refresh);
  }
  return build=>{
    const node = build(actions) || document.createComment('action');
    regions.push({build,node});
    return node;
  };
}

function renderBlock(block,vars,screen,region,form) {
  const label = interpolate(block.label,vars);
  const value = interpolate(block.value,vars);
  const set = value=>{ vars[block.field] = value; };
  switch (block.type) {
    case 'visual': {
      const tile = tileImage(label,{aspect:block.aspect,symbol:interpolate(block.symbol,vars)});
      if (block.image) {
        const img = element('img','wireflow-diagram');
        img.alt = '';
        img.src = model.images[block.image];
        tile.replaceChildren(img);
        tile.classList.add('illustrated');
      }
      if (block.hotspots?.length) tile.setAttribute('role','group');
      for (const spot of block.hotspots || []) {
        tile.append(region(actions=>{
          const action = actions.find(item=>item.id===spot.action);
          if (!action) return null;
          const control = actionButton(screen,action.id,'outline','small',
            {guard:action.validate?()=>form.reportValidity():undefined});
          control.classList.add('image-hotspot');
          Object.assign(control.style,{left:spot.x+'%',top:spot.y+'%',width:spot.width+'%',height:spot.height+'%'});
          return control;
        }));
      }
      return tile;
    }
    case 'rows':
      return rows(...block.rows.map(row=>[interpolate(row.label,vars),interpolate(row.value,vars)]));
    case 'text':
      return element('p','lead',label);
    case 'notice':
      return element('p','paper-notice',label);
    case 'accordion':
      return faq(label,interpolate(block.copy,vars));
    case 'search': {
      const input = element('input');
      input.type = 'search';
      input.placeholder = interpolate(block.placeholder,vars);
      input.setAttribute('aria-label',label || input.placeholder);
      input.value = block.field ? vars[block.field] : value;
      input.readOnly = !block.field;
      if (block.field) {
        input.dataset.control = block.field;
        input.addEventListener('input',()=>set(input.value));
      }
      return write(element('div','paper-search'),icon('search'),input);
    }
    case 'input': {
      const input = element(block.inputType==='textarea'?'textarea':'input','paper-field');
      if (input.tagName==='INPUT') input.type = block.inputType || 'text';
      input.value = vars[block.field];
      input.dataset.control = block.field;
      input.required = Boolean(block.required);
      const validate = ()=>input.setCustomValidity(input.required && input.value && !input.value.trim() ?
        ui('공백 이외의 내용을 입력해 주세요.','Enter a value containing more than whitespace.') : '');
      validate();
      input.addEventListener('input',()=>{
        set(input.value);
        validate();
      });
      return write(element('label','paper-field-label'),element('span','paper-caption',label),input);
    }
    case 'select':
      return picker(label,block.options,vars[block.field],set,block.field);
    case 'radio':
      return radioGroup(label,block.options,vars[block.field],set,screen.id+'-'+block.field,block.field);
    case 'toggle':
    case 'checkbox': {
      const control = choice(label,block.type==='toggle'?'switch':'check',vars[block.field],set,block.field);
      control.firstChild.required = Boolean(block.required);
      return control;
    }
  }
}

function genericContent(screen,vars,form,region) {
  const ui = screen.ui || {};
  const blocks = (ui.blocks || []).map(block=>renderBlock(block,vars,screen,region,form)).filter(Boolean);
  if (ui.layout==='split') {
    const [visual,...details] = blocks;
    form.append(write(element('div','wireflow-split'),visual,write(element('section','wireflow-side'),...details)));
  } else form.append(...blocks);
  form.append(region(actions=>{
    const choices = actions.filter(action=>action.kind==='choice');
    if (!choices.length) return null;
    return write(element('fieldset','paper-choice-group'),
      ui.choiceLabel && element('legend','paper-caption',ui.choiceLabel),
      ...choices.map(action=>{
        const control = actionButton(screen,action.id,'outline','small');
        const updates = Object.entries(action.set || {});
        control.setAttribute('aria-pressed',String(updates.length>0 && updates.every(([key,value])=>vars[key]===value)));
        return control;
      }));
  }));
  if (screen.detail) form.append(element('p','paper-notice',interpolate(screen.detail,vars)));
}

function inImage(screen,id) {
  return screen.ui?.blocks?.some(block=>block.hotspots?.some(spot=>spot.action===id));
}

function genericActions(container,screen,actions,form) {
  for (const [index,action] of actions.entries()) {
    const kind = action.kind;
    const variant = kind==='secondary' || kind==='close' ? 'text' : index===0 || container.classList.contains('paper-modal-actions') ? 'filled' : 'outline';
    container.append(actionButton(screen,action.id,variant,'medium',{guard:action.validate?()=>form.reportValidity():undefined}));
  }
  return container.childElementCount ? container : null;
}

function screenForm() {
  const form = element('form','stack form-stack');
  form.addEventListener('submit',event=>event.preventDefault());
  return form;
}

function genericSurface(screen,vars) {
  const ui = screen.ui || {};
  const form = screenForm();
  const region = actionRegions(screen,vars,form);
  const status = write(element('div','statusbar'),'9:41',write(element('span','indicators'),element('i','signal'),element('i','battery')));
  status.setAttribute('aria-hidden','true');
  const header = write(element('div','appbar'),element('span','paper-h3',ui.bar || model.title),
    region(actions=>{
      const back = actions.find(action=>action.kind==='back');
      return back && actionButton(screen,back.id,'text','small');
    }));
  genericContent(screen,vars,form,region);
  const feedback = element('p','screen-error paper-notice',screen.id===active ? message : '');
  feedback.setAttribute('role','status');
  const body = write(element('div','app-content'),intro(interpolate(ui.heading || screen.title,vars),interpolate(screen.body,vars)),form,feedback);
  const footer = region(actions=>genericActions(element('div','app-actions'),screen,
    actions.filter(action=>!['back','tab','choice','simulation'].includes(action.kind) && !inImage(screen,action.id)),form));
  const nav = region(actions=>{
    const tabs = actions.filter(action=>action.kind==='tab');
    return tabs.length ? write(element('nav','tabbar'),...tabs.map(action=>{
      const control = actionButton(screen,action.id,'text','small');
      control.classList.add('paper-tab');
      if (action.to===screen.id) control.setAttribute('aria-current','page');
      return control;
    })) : null;
  });
  return write(element('div','app-surface'),status,header,body,footer,nav);
}

function genericPopup(screen,vars) {
  const form = screenForm();
  const title = element('h2','paper-h2',interpolate(screen.ui.heading || screen.title,vars));
  title.id = screen.id+'-popup-title';
  const region = actionRegions(screen,vars,form);
  const dismiss = region(actions=>{
    const close = actions.find(action=>action.kind==='close');
    return close && closeButton(screen,close);
  });
  if (screen.body) form.append(element('p','lead',interpolate(screen.body,vars)));
  genericContent(screen,vars,form,region);
  const buttons = region(actions=>genericActions(element('div','paper-modal-actions'),screen,
    actions.filter(action=>!['simulation','choice'].includes(action.kind) && !inImage(screen,action.id)),form));
  const feedback = element('p','screen-error paper-notice',screen.id===active ? message : '');
  feedback.setAttribute('role','status');
  const panel = write(element('section','paper-modal'),write(element('header','popup-head'),title,dismiss),form,feedback,buttons);
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-labelledby',title.id);
  panel.addEventListener('keydown',event=>{
    const close = panel.querySelector('.paper-dismiss');
    if (event.key==='Escape' && close) {
      event.preventDefault();
      close.click();
    }
  });
  return write(element('div','popup-layer'),panel);
}

function mobile(screen,current) {
  if (workshop) return workshopScreen(screen,current);
  const base = screens.get(screen.ui?.overlay);
  const surface = genericSurface(base || screen,current.vars);
  surface.inert = Boolean(base);
  return write(element('div','device paper-ui paper-hand-labels'),surface,base && genericPopup(screen,current.vars));
}
