'use strict';

const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { buildFlow } = require('../scripts/wireflow.cjs');
const { verifyBrowser } = require('./browser.cjs');

const sample = require('./fixtures/neighborhood-tool-rental.flow.json');
const initial = {date:'',dateSelected:false,reservation:'확정 전'};
const friday = {...initial,date:'금요일',dateSelected:true};
const reserved = {...friday,reservation:'예약 확정'};
const days = {'select-friday':'금요일','select-saturday':'토요일'};
const screens = {
  tools:{actions:[{id:'open-drill',to:'drill'}]},
  drill:{
    actions:[{id:'back-to-tools',to:'tools'},{id:'choose-date',to:'rental-date'}],
    assertions:[{selector:'.info-rows div:first-child dd',text:'2대'}],
  },
  'rental-date':{
    actions:[
      {id:'back-to-drill',to:'drill'},
      ...Object.entries(days).map(([id,date])=>({id,to:'rental-date',set:{date,dateSelected:true}})),
      {id:'review-rental',to:'rental-confirm',when:{dateSelected:true}},
    ],
    assertions:Object.entries(days).flatMap(([id,date])=>['','금요일','토요일'].map(value=>({
      selector:'[data-action="'+id+'"]',attribute:'aria-pressed',value:String(value===date),when:{date:value},
    }))),
  },
  'rental-confirm':{
    actions:[{id:'confirm-rental',to:'rental-complete',set:{reservation:'예약 확정'}},{id:'close',to:'rental-date'}],
    assertions:[{selector:'.paper-modal .info-rows div:nth-child(2) dd',text:'{{date}}'}],
  },
  'rental-complete':{actions:[{id:'open-my-rentals',to:'my-rentals'}]},
  'my-rentals':{end:true,actions:[],assertions:[
    {selector:'.info-rows div:nth-child(2) dd',text:'{{date}}'},
    {selector:'.info-rows div:nth-child(3) dd',text:'{{reservation}}'},
  ]},
};
const step = (from,to,action,before,after = before) => ({from,to,action,before,after});
const dates = [step('tools','drill','open-drill',initial),step('drill','rental-date','choose-date',initial)];
const review = [...dates,step('rental-date','rental-date','select-friday',initial,friday),
  step('rental-date','rental-confirm','review-rental',friday)];
const close = [...review,step('rental-confirm','rental-date','close',friday)];
const confirm = [...review,step('rental-confirm','rental-complete','confirm-rental',friday,reserved),
  step('rental-complete','my-rentals','open-my-rentals',reserved)];

function compiled(paths) {
  return {
    title:'독립 공구 대여 기획',start:'tools',initial,screens,totalStates:7,findings:[],
    cases:paths.map((steps,index)=>({id:'case-'+index,title:'공구 대여 검증',start:'tools',initial,steps})),
  };
}

async function verifyFixture(t,paths,{change,extra, trace = false} = {}) {
  const folder = await mkdtemp(join(tmpdir(),'wireflow-browser-test-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const flow = structuredClone(sample);
  if (change) change(flow);
  const source = join(folder,'fixture.json');
  const html = join(folder,'fixture.html');
  await writeFile(source,JSON.stringify(flow),'utf8');
  buildFlow(source,html);
  if (extra) {
    const document = await readFile(html,'utf8');
    await writeFile(html,document.replace('</head>',extra+'</head>'),'utf8');
  }
  const traceDir = trace ? join(folder,'traces') : undefined;
  const result = await verifyBrowser(html,compiled(paths),{timeoutMs:1000,traceDir});
  return {result,traceDir};
}

function screen(flow,id) {
  return flow.screens.find(item=>item.id===id);
}

function action(flow,id,actionId) {
  return screen(flow,id).actions.find(item=>item.id===actionId);
}

test('Chromium replays date selection, both popup close controls and final reservation status',async t=>{
  const {result,traceDir} = await verifyFixture(t,[close,confirm],{trace:true});
  assert.equal(result.passedCases,2);
  assert.deepEqual(result.findings,[]);
  assert.deepEqual(await readdir(traceDir),[]);
  const closeChecks = result.passedChecks.filter(check=>check.includes('"click","close"'));
  assert.equal(closeChecks.length,2);
  assert.ok(closeChecks.some(check=>check.endsWith(',0]')));
  assert.ok(closeChecks.some(check=>check.endsWith(',1]')));
});

test('the real click test detects a visible popup action covered by a different element',async t=>{
  const coveredFooter = `<style>
    .artboard.is-active .paper-modal-actions button[data-action="close"] { pointer-events:none }
  </style>`;
  const {result,traceDir} = await verifyFixture(t,[close],{extra:coveredFooter,trace:true});
  assert.equal(result.passedCases,0);
  assert.equal(result.findings.length,1);
  const finding = result.findings[0];
  assert.equal(finding.screen,'rental-confirm');
  assert.equal(finding.action,'close');
  assert.equal(finding.reason,'not-actionable');
  assert.match(finding.actual,/다른 요소가 조작을 가려서/);
  assert.equal(finding.route.steps.length,4 + 1);
  assert.equal(finding.route.steps.at(-1).to,undefined);
  assert.equal(finding.route.issue.selector,'.paper-modal-actions [data-action]');
  assert.deepEqual(await readdir(traceDir),[finding.trace]);
  const trace = await readFile(join(traceDir,finding.trace));
  assert.equal(trace.toString('latin1',0,2),'PK');
});

test('wrong transitions are reported once and retain the shortest observed sequence',async t=>{
  const {result} = await verifyFixture(t,[confirm,review],{change:flow=>{
    action(flow,'rental-date','review-rental').to = 'drill';
  }});
  assert.equal(result.passedCases,0);
  assert.equal(result.findings.length,1);
  const finding = result.findings[0];
  assert.equal(finding.expectedScreen,'rental-confirm');
  assert.equal(finding.reason,'wrong-destination');
  assert.match(finding.actual,/전동 드릴 상세/);
  assert.equal(finding.route.steps.at(-1).to,'drill');
  assert.equal(finding.route.steps.length,review.length);
});

test('a premature action and independent visible state mismatch on the same view both surface',async t=>{
  const {result} = await verifyFixture(t,[dates],{change:flow=>{
    delete action(flow,'rental-date','review-rental').when;
  },extra:'<style>.artboard.is-active button[data-action="select-friday"] {display:none}</style>'});
  assert.equal(result.passedCases,0);
  assert.equal(result.findings.length,3);
  assert.ok(result.findings.some(finding=>finding.action==='review-rental' && finding.reason==='unexpected-control'));
  assert.ok(result.findings.some(finding=>finding.action==='select-friday' && finding.reason==='missing-control'));
  assert.ok(result.findings.some(finding=>finding.reason==='wrong-state'));
  assert.equal(result.findings[0].route.steps.at(-1).from,'rental-date');
});

test('a different visible quantity fails exact normalized text comparison',async t=>{
  const {result} = await verifyFixture(t,[[dates[0]]],{change:flow=>{
    screen(flow,'drill').ui.blocks.find(block=>block.type==='rows').rows[0].value = '12대';
  }});
  assert.equal(result.passedCases,0);
  assert.equal(result.findings.length,1);
  assert.equal(result.findings[0].reason,'wrong-state');
  assert.equal(result.findings[0].expected,'2대');
  assert.equal(result.findings[0].actual,'12대');
});

test('a local preview cannot load an external network resource during verification',async t=>{
  let requests = 0;
  const server = createServer((_,response)=>{
    requests++;
    response.writeHead(200,{'Content-Type':'application/javascript'});
    response.end('window.nonlocalProbe = true');
  });
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const port = server.address().port;
  const {result} = await verifyFixture(t,[[dates[0]]],{
    extra:'<script src="http://127.0.0.1:'+port+'/probe.js"></'+'script>',
  });
  assert.equal(result.passedCases,1);
  assert.equal(requests,0);
});

test('reports a visible action outside the plan at its first source screen', async t=>{
  const {result} = await verifyFixture(t,[confirm],{change:flow=>{
    screen(flow,'tools').actions.push({id:'instant',label:'즉시 대여',to:'my-rentals'});
  }});
  assert.equal(result.passedCases,0);
  assert.equal(result.findings.length,1);
  assert.equal(result.findings[0].reason,'unplanned-control');
  assert.equal(result.findings[0].screen,'tools');
  assert.equal(result.findings[0].action,'instant');
  assert.match(result.findings[0].actual,/즉시 대여/);
});
