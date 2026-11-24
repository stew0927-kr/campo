'use strict';

const formatNumber = index => String(index).padStart(2,'0');

function defaultCanvasPlacement(flow) {
  const groupDirection = flow.review.groupDirection || 'vertical';
  const groups = flow.stages.map((title,index)=>{
    const ids = flow.screens.filter(screen=>screen.stage===index)
      .sort((a,b)=>(a.slot ?? Number.MAX_SAFE_INTEGER)-(b.slot ?? Number.MAX_SAFE_INTEGER)).map(screen=>screen.id);
    return {root:ids[0],title,ids};
  }).filter(group=>group.ids.length);
  const positions = gridPositions(groups,groupDirection);
  for (const [id,point] of Object.entries(flow.review.positions || {})) {
    if (positions.has(id) && Number.isFinite(point?.x) && Number.isFinite(point?.y)) positions.set(id,point);
  }
  return {groups,groupDirection,positions};
}

function gridPositions(groups,groupDirection) {
  // Leave room between group outlines and their headings when the map is fitted.
  const groupStride = 1.16;
  return new Map(groups.flatMap(({ids},index)=>{
    const group = index * groupStride;
    return ids.map((id,slot)=>[id,groupDirection==='vertical' ? {x:slot,y:group} : {x:group,y:slot}]);
  }));
}

function defaultScreenNumbers(flow,groups) {
  const numbers = new Map(flow.screens.filter(screen=>screen.number).map(screen=>[screen.id,screen.number]));
  const used = new Set(numbers.values());
  for (const [index,group] of groups.entries()) {
    let slot = 1;
    for (const id of group.ids) {
      if (numbers.has(id)) continue;
      let number;
      do { number = formatNumber(index+1)+'.'+formatNumber(slot++); } while (used.has(number));
      numbers.set(id,number);
      used.add(number);
    }
  }
  return numbers;
}

function readCanvasLayout(flow,defaults) {
  const numbers = new Map(defaults.numbers);
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey));
    const {groupDirection} = defaults;
    const ordered = saved?.groups ?? saved?.columns ?? [];
    const ids = ordered.flat();
    const roots = new Map(defaults.groups.map(group=>[group.root,group]));
    const valid = (saved?.groupDirection ?? 'horizontal')===groupDirection &&
      ordered.length===roots.size && ids.length===numbers.size &&
      new Set(ids).size===ids.length && ids.every(id=>numbers.has(id)) &&
      ordered.every(group=>roots.has(group[0]));
    if (valid) {
      const overrides = flow.screens.map(({id})=>saved.numbers?.[id]);
      if (overrides.every(value=>typeof value==='string' && /^\d{2,}\.\d{2,}$/.test(value)) &&
          new Set(overrides).size===numbers.size) {
        flow.screens.forEach(({id},index)=>numbers.set(id,overrides[index]));
      }
      const groups = ordered.map(ids=>({...roots.get(ids[0]),ids}));
      const positions = gridPositions(groups,groupDirection);
      for (const id of ids) {
        const point = saved.positions?.[id];
        if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) positions.set(id,point);
      }
      return {groups,groupDirection,numbers,positions};
    }
  } catch {
    // Invalid or unavailable storage falls back to the published layout.
  }
  return {...defaults,numbers};
}

function saveCanvasLayout(layout) {
  try {
    localStorage.setItem(layoutKey,JSON.stringify({
      groups:layout.groups.map(group=>group.ids),
      groupDirection:layout.groupDirection,
      numbers:Object.fromEntries(layout.numbers),
      positions:Object.fromEntries(layout.positions),
    }));
  } catch {
    // The current session can still use the edited layout.
  }
}

function orderedCanvasGroups(layout) {
  const [groupAxis,screenAxis] = layout.groupDirection==='vertical' ? ['y','x'] : ['x','y'];
  const compare = (a,b,axis,otherAxis)=>{
    const first = layout.positions.get(a);
    const second = layout.positions.get(b);
    return first[axis]-second[axis] || first[otherAxis]-second[otherAxis];
  };
  return [...layout.groups].sort((a,b)=>compare(a.root,b.root,groupAxis,screenAxis))
    .map(group=>{
      const states = group.ids.slice(1).sort((a,b)=>compare(a,b,screenAxis,groupAxis));
      return {...group,ids:[group.root,...states]};
    });
}

function previewScreenNumbers(layout) {
  return orderedCanvasGroups(layout).flatMap(({ids},group)=>ids.map((id,slot)=>({
    id,from:layout.numbers.get(id),to:formatNumber(group+1)+'.'+formatNumber(slot+1),
  }))).filter(item=>item.from!==item.to);
}

function snapCanvasDelta(moving,neighbors,delta,zoom,disabled) {
  if (disabled) return {delta,guides:[]};
  const tolerance = 8/zoom;
  const nearby = 88/zoom;
  const correction = {...delta};
  const guides = [];
  for (const [axis,cross,length,depth] of [['x','y','w','h'],['y','x','h','w']]) {
    let closest;
    for (const frame of moving) {
      const coordinate = frame[axis]+delta[axis];
      const side = frame[cross]+delta[cross];
      for (const peer of neighbors) {
        if (side>peer[cross]+peer[depth]+nearby || side+frame[depth]<peer[cross]-nearby) continue;
        for (const align of [0,.5,1]) {
          const value = peer[axis]+peer[length]*align;
          const shift = value-coordinate-frame[length]*align;
          if (Math.abs(shift)>tolerance || (closest && Math.abs(shift)>=Math.abs(closest.shift))) continue;
          closest = {axis,value,shift,start:Math.min(side,peer[cross]),end:Math.max(side+frame[depth],peer[cross]+peer[depth])};
        }
      }
    }
    if (closest) {
      correction[axis] += closest.shift;
      guides.push(closest);
    }
  }
  return {delta:correction,guides};
}
