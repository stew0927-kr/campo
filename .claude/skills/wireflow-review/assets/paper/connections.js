'use strict';

function connectionKey(from, to) {
  return from < to ? from + '|' + to : to + '|' + from;
}

function createConnections(canvas, frames, pitch, annotations = []) {
  const ctx = canvas.getContext('2d');
  const tokens = getComputedStyle(canvas);
  const css = name => tokens.getPropertyValue(name).trim();
  const ink = css('--paper-ink');
  const accent = css('--paper-accent');
  const issue = css('--paper-route-issue') || accent;
  const muted = css('--paper-arrow-muted');
  const stroke = parseFloat(css('--paper-arrow-stroke'));
  const mutedStroke = parseFloat(css('--paper-arrow-muted-stroke'));
  const dash = [parseFloat(css('--paper-arrow-dash')),parseFloat(css('--paper-arrow-gap'))];
  const lead = parseFloat(css('--paper-arrow-lead'));
  const arrowhead = parseFloat(css('--paper-arrowhead'));
  const paper = css('--paper');
  const labels = new Map(annotations.map(({from,to,label})=>[from+'→'+to,label]));
  const routes = new Map();
  const boxes = [...frames.entries()];

  function ports(id, bias) {
    const {x,y,w,h} = frames.get(id);
    const across = span => {
      const margin = Math.min(6,span/2);
      return Math.max(margin,Math.min(span-margin,span/2+bias));
    };
    return [
      {id, tip:[x,y+across(h)], normal:[-1,0]},
      {id, tip:[x+w,y+across(h)], normal:[1,0]},
      {id, tip:[x+across(w),y], normal:[0,-1]},
      {id, tip:[x+across(w),y+h], normal:[0,1]},
    ];
  }

  const shift = ([x,y],[dx,dy],amount) => [x+dx*amount, y+dy*amount];
  const delta = ([x,y],[u,v]) => [u-x,v-y];
  const dot = ([x,y],[u,v]) => x*u+y*v;
  const distance = (a,b) => Math.hypot(...delta(a,b));
  const straightSegment = (a,b) => [a,shift(a,delta(a,b),1/3),shift(a,delta(a,b),2/3),b];

  function clearCurve(points, from, to) {
    const xs = points.map(([x]) => x), ys = points.map(([,y]) => y);
    const nearby = boxes.filter(([id,{x,y,w,h}]) => id!==from && id!==to &&
      Math.min(...xs)<x+w+6 && Math.max(...xs)>x-6 && Math.min(...ys)<y+h+6 && Math.max(...ys)>y-6);
    if (!nearby.length) return true;
    const steps = Math.max(24,Math.ceil(distance(points[0],points[3])/16));
    for (let i=0;i<=steps;i++) {
      const t=i/steps, u=1-t;
      const [x,y] = [0,1].map(axis => u**3*points[0][axis]+3*u*u*t*points[1][axis]+3*u*t*t*points[2][axis]+t**3*points[3][axis]);
      if (nearby.some(([,box])=>x>box.x-6 && x<box.x+box.w+6 && y>box.y-6 && y<box.y+box.h+6)) return false;
    }
    return true;
  }

  function directRoute(sources, targets) {
    let best;
    for (const source of sources) {
      for (const target of targets) {
        const direction = delta(source.tip,target.tip);
        const out = dot(direction,source.normal), into = -dot(direction,target.normal);
        const opposed = dot(source.normal,target.normal)===-1;
        const minimum = (opposed ? 2 : 1)*lead+18;
        if (out<minimum || into<minimum) continue;
        const score = Math.hypot(...direction)+(opposed?0:45);
        if (best && score>=best.score) continue;
        const a=shift(source.tip,source.normal,lead), d=shift(target.tip,target.normal,lead);
        const span=delta(a,d);
        const b=shift(a,source.normal,dot(span,source.normal)*.48);
        const c=shift(d,target.normal,-dot(span,target.normal)*.48);
        const segments=[straightSegment(source.tip,a),[a,b,c,d],straightSegment(d,target.tip)];
        if (!segments.every(segment=>clearCurve(segment,source.id,target.id))) continue;
        const path=new Path2D();
        path.moveTo(...source.tip);
        path.lineTo(...a);
        path.bezierCurveTo(...b,...c,...d);
        path.lineTo(...target.tip);
        const middle=a.map((value,i)=>(value+3*b[i]+3*c[i]+d[i])/8);
        best={source,target,path,score,middle};
      }
    }
    return best;
  }

  function gutterPath(points) {
    const path = new Path2D();
    let cursor = points[0];
    const segments = [];
    path.moveTo(...cursor);
    function line(end) {
      if (distance(cursor,end)<.01) return;
      segments.push(straightSegment(cursor,end));
      path.lineTo(...end);
      cursor = end;
    }
    function curve(controlA,controlB,end) {
      segments.push([cursor,controlA,controlB,end]);
      path.bezierCurveTo(...controlA,...controlB,...end);
      cursor = end;
    }
    for (let i=1;i<points.length-1;i++) {
      const before=points[i-1], corner=points[i], after=points[i+1];
      const a=distance(corner,before), b=distance(corner,after);
      const beforeLead=i===1 ? Math.min(lead,a*.65) : 0;
      const afterLead=i===points.length-2 ? Math.min(lead,b*.65) : 0;
      const bend=Math.min(42,a*.45,b*.45,a-beforeLead,b-afterLead);
      const start=shift(corner,delta(corner,before),bend/a);
      const end=shift(corner,delta(corner,after),bend/b);
      line(start);
      curve(shift(start,delta(start,corner),.63),shift(end,delta(end,corner),.63),end);
    }
    line(points.at(-1));
    return {path,segments};
  }

  const {w,h} = frames.values().next().value;
  const gap = [(pitch.x-w)/2,(pitch.y-h)/2];
  const lanes = [
    [...new Set(boxes.flatMap(([,box])=>[box.x-gap[0],box.x+w+gap[0]]))],
    [...new Set(boxes.flatMap(([,box])=>[box.y-gap[1],box.y+h+gap[1]]))],
  ];

  function laneRoute(sources,targets,stagger=0) {
    let best;
    for (const source of sources) {
      for (const target of targets) {
        const axis = source.normal[0] ? 0 : 1;
        const other = target.normal[0] ? 0 : 1;
        const s=shift(source.tip,source.normal,gap[axis]+stagger*source.normal[axis]);
        const t=shift(target.tip,target.normal,gap[other]+stagger*target.normal[other]);
        const corners = axis===other ? lanes[1-axis].map(center=>center+stagger).map(lane=>
          axis===0 ? [[s[0],lane],[t[0],lane]] : [[lane,s[1]],[lane,t[1]]]) :
          [axis===0 ? [[s[0],t[1]]] : [[t[0],s[1]]]];
        for (const bend of corners) {
          const raw=[source.tip,s,...bend,t,target.tip];
          const points=raw.filter((point,index)=>!index || distance(point,raw[index-1])>.1);
          const tangents=points.slice(1).map((point,index)=>delta(points[index],point));
          if (tangents.some((tangent,index)=>index>0 && dot(tangent,tangents[index-1])<0)) continue;
          const score=tangents.reduce((sum,tangent)=>sum+Math.hypot(...tangent),0);
          if (best && score>=best.score) continue;
          const {path,segments}=gutterPath(points);
          if (!segments.every(segment=>clearCurve(segment,source.id,target.id))) continue;
          best={source,target,points,score,path};
        }
      }
    }
    if (!best && stagger) return laneRoute(sources,targets);
    if (!best) return undefined;
    const middleIndex=Math.floor(best.points.length/2);
    const middle=best.points[middleIndex-1].map((value,i)=>(value+best.points[middleIndex][i])/2);
    return {...best,middle};
  }

  function loopRoute(id) {
    const {x,y,w,h} = frames.get(id);
    const top=y+h*.24, spread=59;
    const source={id,tip:[x+w,top],normal:[1,0]};
    const target={id,tip:[x+w,top+spread],normal:[1,0]};
    const path=new Path2D();
    path.moveTo(...source.tip);
    path.lineTo(x+w+lead,top);
    path.bezierCurveTo(x+w+lead+36,top,x+w+lead+36,top+spread,x+w+lead,top+spread);
    path.lineTo(...target.tip);
    return {source,target,path};
  }

  function outerRoute(sources,targets) {
    let best;
    for (const [index,source] of sources.entries()) {
      const target = targets[index];
      const axis = source.normal[0] ? 0 : 1;
      const side = source.normal[axis];
      const outside = Math.max(source.tip[axis]*side,target.tip[axis]*side)+lead+32;
      const start = shift(source.tip,source.normal,outside-source.tip[axis]*side);
      const end = shift(target.tip,target.normal,outside-target.tip[axis]*side);
      if (distance(start,end)<.1) continue;
      const {path,segments} = gutterPath([source.tip,start,end,target.tip]);
      const clear = segments.every(segment=>clearCurve(segment,source.id,target.id));
      const score = distance(source.tip,start)+distance(start,end)+distance(end,target.tip)+(clear?0:1e6);
      if (!best || score<best.score) {
        best = {source,target,path,score,middle:start.map((value,i)=>(value+end[i])/2)};
      }
    }
    return best;
  }

  function getRoute(key) {
    if (!routes.has(key)) {
      const [a,b]=key.split('|');
      if (a===b) routes.set(key,loopRoute(a));
      else {
        const hash=[...key].reduce((value,char)=>(Math.imul(value,31)+char.charCodeAt(0))>>>0,0);
        const sources=ports(a,14+hash%25-12), targets=ports(b,-14+(hash>>>8)%25-12);
        const stagger=((hash>>>16)%5-2)*7;
        routes.set(key,directRoute(sources,targets) || laneRoute(sources,targets,stagger) || outerRoute(sources,targets));
      }
    }
    return routes.get(key);
  }

  function drawArrow(port, size) {
    const [dx,dy]=port.normal;
    const base=shift(port.tip,port.normal,size);
    const cross=[-dy,dx];
    ctx.moveTo(...shift(base,cross,size/2));
    ctx.lineTo(...port.tip);
    ctx.lineTo(...shift(base,cross,-size/2));
  }

  function paint(key, directions, tone='normal',dimmed=false) {
    const route=getRoute(key);
    if (!route) return;
    const highlighted = tone!=='normal';
    ctx.globalAlpha = dimmed ? .60 : 1;
    ctx.strokeStyle=tone==='issue' ? issue : highlighted ? accent : muted;
    const unit = 1/ctx.getTransform().a;
    ctx.lineWidth=highlighted ? Math.max(stroke,2.4*unit) : Math.max(mutedStroke,.85*unit);
    ctx.setLineDash(highlighted ? [] : dash);
    ctx.stroke(route.path);
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const target of directions) drawArrow(route.target.id===target ? route.target : route.source,arrowhead);
    ctx.stroke();
    const label = [...directions].map(target=>{
      const source = route.target.id===target ? route.source.id : route.target.id;
      return labels.get(source+'→'+target);
    }).find(Boolean);
    if (label && route.middle) {
      const [x,y]=route.middle;
      ctx.font='600 12px '+css('--paper-font-sans');
      const width = ctx.measureText(label).width+12;
      ctx.fillStyle=paper;
      ctx.beginPath();
      ctx.roundRect(x-width/2,y-8,width,16,4);
      ctx.fill();
      ctx.fillStyle=highlighted?ctx.strokeStyle:ink;
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.fillText(label,x,y);
    }
  }

  // Plan a selected transition from the side nearest its actual control. Normalize
  // the DOM coordinates so the same route survives panning and camera scaling.
  const selectedRoutes = new Map();
  function selectedRoute(step) {
    const sourceFrame = frames.get(step.from);
    const targetFrame = frames.get(step.to);
    if (!sourceFrame || !targetFrame) return;
    const board = artboards.get(step.from);
    const control = [...board.querySelectorAll('[data-route-control]')].find(node =>
      node.dataset.action === step.action && node.getClientRects().length);
    const bounds = board.getBoundingClientRect();
    const anchor = control?.getBoundingClientRect();
    const rx = anchor && bounds.width ? (anchor.x+anchor.width/2-bounds.x)/bounds.width : .5;
    const ry = anchor && bounds.height ? (anchor.y+anchor.height/2-bounds.y)/bounds.height : .5;
    const x = Math.round(Math.min(.95,Math.max(.05,rx))*sourceFrame.w);
    const y = Math.round(Math.min(.95,Math.max(.05,ry))*sourceFrame.h);
    const key = [step.from,step.to,step.action,x,y,step.number%3].join('|');
    if (selectedRoutes.has(key)) return selectedRoutes.get(key);
    let sources = ports(step.from,0);
    if (anchor) {
      const distances = [x,sourceFrame.w-x,y,sourceFrame.h-y];
      const side = distances.indexOf(Math.min(...distances));
      const port = sources[side];
      if (port.normal[0]) port.tip[1] = sourceFrame.y+y;
      else port.tip[0] = sourceFrame.x+x;
      sources = [port];
    }
    const targets = ports(step.to,-targetFrame.w*.08);
    const stagger = (step.number%3-1)*12;
    // Exit below the source row when it leads into another functional group.
    // These gutters keep arrows and labels clear of the titles above the boards.
    const [source] = sources;
    let gutter;
    if (frames.get(step.from).group !== frames.get(step.to).group && source.normal[1]>=0) {
      const sourceBottom = sourceFrame.y + sourceFrame.h;
      const below = targetFrame.y > sourceBottom;
      const lane = below ? sourceBottom + Math.max(24,(targetFrame.y-sourceBottom-95)/2) :
        Math.max(sourceBottom,targetFrame.y+targetFrame.h) + 32;
      const end = below ? targets[sourceFrame.x >= targetFrame.x ? 1 : 0] : targets[3];
      const exitX = source.tip[0] + source.normal[0]*34;
      const entryX = end.tip[0] + end.normal[0]*40;
      const corners = [source.tip,[exitX,source.tip[1]],[exitX,lane],[entryX,lane],[entryX,end.tip[1]],end.tip];
      const points = corners.filter((point,index)=>!index || distance(point,corners[index-1])>.1);
      if (points.length>=3 && lane>source.tip[1] && (below || lane>end.tip[1])) {
        const shape = gutterPath(points);
        if (shape.segments.every(segment=>clearCurve(segment,step.from,step.to))) {
          gutter = {source,target:end,points,path:shape.path};
        }
      }
    }
    const route = gutter || directRoute(sources,targets) || laneRoute(sources,targets,stagger) ||
      getRoute(connectionKey(step.from,step.to));
    if (route) selectedRoutes.set(key,route);
    return route;
  }

  function paintSelected(step,zoom,occupied) {
    const route = selectedRoute(step);
    if (!route) return;
    const unit = 1/zoom;
    const color = step.failed ? issue : '#00685e';
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.lineWidth = 5*unit;
    ctx.strokeStyle = paper;
    ctx.stroke(route.path);
    ctx.lineWidth = 2.5*unit;
    ctx.strokeStyle = color;
    ctx.stroke(route.path);
    ctx.beginPath();
    drawArrow(route.target.id===step.to ? route.target : route.source,9*unit);
    ctx.stroke();

    let spots = route.middle ? [route.middle] : [];
    if (route.points) {
      const segments = route.points.slice(1).map((end,index)=>[route.points[index],end]);
      segments.sort(([a,b],[c,d])=>distance(c,d)-distance(a,b));
      spots = segments.flatMap(([a,b])=>[.5,.3,.7].map(t=>shift(a,delta(a,b),t)));
    }
    const obstacles = [...occupied,...frames.values()];
    const full = step.numbers.join(', ')+'  '+step.label;
    ctx.font = '650 '+11*unit+'px '+css('--paper-font-sans');
    for (const text of zoom<.20 ? [step.numbers.join(', ')] : [full,step.numbers.join(', ')]) {
      const w = ctx.measureText(text).width+10*unit, h = 18*unit;
      for (const [x,y] of spots) {
        const left=x-w/2, top=y-h/2;
        if (obstacles.some(box=>left<box.x+box.w && left+w>box.x && top<box.y+box.h && top+h>box.y)) continue;
        occupied.push({x:left-2*unit,y:top-2*unit,w:w+4*unit,h:h+4*unit});
        ctx.fillStyle = paper;
        ctx.lineWidth = unit;
        ctx.beginPath();
        ctx.roundRect(left,top,w,h,6*unit);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle=color;
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText(text,x,y);
        return;
      }
    }
  }

  return function draw(edges, focus, offset, zoom, verification) {
    const width=canvas.clientWidth, height=canvas.clientHeight;
    const scale=Math.min(devicePixelRatio||1,1.5);
    const px=Math.round(width*scale), py=Math.round(height*scale);
    if (canvas.width!==px || canvas.height!==py) {
      canvas.width=px;
      canvas.height=py;
    }
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,px,py);
    ctx.setTransform(scale*zoom,0,0,scale*zoom,offset.x*scale,offset.y*scale);
    ctx.lineJoin='round';
    ctx.lineCap='round';
    if (verification) {
      for (const [key,targets] of edges) {
        if (!verification.has(key)) paint(key,targets,'normal',true);
      }
      const occupied = [];
      for (const [key,entry] of verification) {
        const other = [...(edges.get(key) || [])].filter(target=>!entry.targets.has(target));
        if (other.length) paint(key,other,'normal',true);
        const actions = new Map();
        for (const step of entry.steps) {
          const id = [step.from,step.to,step.action ?? step.label].join('|');
          if (!actions.has(id)) actions.set(id,{...step,numbers:[]});
          const action = actions.get(id);
          action.numbers.push(step.number);
          action.failed ||= step.failed;
        }
        for (const action of actions.values()) paintSelected(action,zoom,occupied);
      }
      ctx.globalAlpha = 1;
      return;
    }
    const focusedKey=focus && connectionKey(focus.from,focus.to);
    for (const [key,targets] of edges) if (key!==focusedKey) paint(key,targets);
    if (focusedKey) paint(focusedKey,[focus.to],'focus');
  };
}
