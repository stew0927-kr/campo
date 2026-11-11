// ngraph.path 1.6.1 / ngraph.graph 20.1.2 동작 재현 (SPEC-v0.2 3.3). 실행: node docs/v0.2/repro/ngraph-behaviors.mjs
// 2026-11-11 실행 결과: ["C"], ["C"], ["A","B"], [], ["C","B","A"], 1, 2, a=B b=A, ["A"]
import createGraph from 'ngraph.graph';
import path from 'ngraph.path';
const log=(k,v)=>console.log(k, JSON.stringify(v));
// 1) blocked-only target
let g=createGraph(); g.addLink('A','B',{t:'flat',w:10}); g.addLink('B','C',{t:'steps',w:10});
let f=path.aStar(g,{oriented:true,distance:(a,b,l)=>l.data.w,blocked:(a,b,l)=>l.data.t==='steps'});
log('blocked only target ->', f.find('A','C').map(n=>n.id));
// 2) Infinity cost
f=path.aStar(g,{oriented:true,distance:(a,b,l)=>l.data.t==='steps'?Infinity:l.data.w});
log('infinity cost ->', f.find('A','C').map(n=>n.id));
// 3) oriented default ignores direction
let g2=createGraph(); g2.addLink('A','B',{w:1});
log('non-oriented reverse ->', path.aStar(g2,{distance:(a,b,l)=>l.data.w}).find('B','A').map(n=>n.id));
log('oriented reverse ->', path.aStar(g2,{oriented:true,distance:(a,b,l)=>l.data.w}).find('B','A').map(n=>n.id));
// 4) order
log('order A->C (flat) ->', path.aStar(createGraph().addLink('A','B')&&(()=>{const x=createGraph();x.addLink('A','B');x.addLink('B','C');return x})(),{oriented:true}).find('A','C').map(n=>n.id));
// 5) multigraph overwrite
let g3=createGraph(); g3.addLink('A','B',{t:'steps',w:5}); g3.addLink('A','B',{t:'ramp',w:12});
log('non-multigraph link count', g3.getLinkCount());
let g4=createGraph({multigraph:true}); g4.addLink('A','B',{t:'steps',w:5}); g4.addLink('A','B',{t:'ramp',w:12});
log('multigraph link count', g4.getLinkCount());
// 6) distance arg order
let g5=createGraph(); g5.addLink('A','B',{});
path.aStar(g5,{oriented:true,distance:(a,b,l)=>{console.log('distance args a=',a.id,'b=',b.id,'link',l.fromId,'->',l.toId);return 1}}).find('A','B');
// 7) blocked target reachable also via unblocked longer path? fine. Also same-from-to
log('same node ->', path.aStar(g5,{oriented:true}).find('A','A').map(n=>n.id));
