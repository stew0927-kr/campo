'use strict';

const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {promisify} = require('node:util');
const {test} = require('node:test');
const {chromium} = require('playwright');

const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const cli = path.resolve(__dirname, '../scripts/wireflow.cjs');
const sample = path.join(__dirname, 'fixtures/neighborhood-tool-rental');

async function verify(cwd, name, flow, size, traceDir) {
  const output = path.join(cwd, name + '.html');
  const reportPath = path.join(cwd, name + '.json');
  const args = [cli, 'verify', flow, sample + '.plan.json', '--output', output, '--report', reportPath,
    '--viewport', size];
  if (traceDir) args.push('--trace-dir', traceDir);

  let status = 0;
  let details = '';
  try {
    await run(process.execPath, args, {cwd:root, timeout:90_000, maxBuffer:2 * 1024 * 1024});
  } catch (error) {
    assert.ok(Number.isInteger(error.code), error.message);
    status = error.code;
    details = error.stderr || error.stdout;
    assert.notEqual(status, 2, details);
  }
  return {status, details, output, report:JSON.parse(await fs.readFile(reportPath, 'utf8'))};
}

async function canvasOptions(page) {
  const more = page.locator('#canvas-more');
  if (!await more.evaluate(el=>el.open)) await more.locator('summary').click();
}

async function openScreen(page,id) {
  await page.locator('.artboard[data-screen="'+id+'"] .overview-hit').click();
  await page.waitForFunction(()=>!document.querySelector('#canvas').hasAttribute('data-overview'));
}

async function openReview(browser, output, viewport = {width:1024,height:768}) {
  const page = await browser.newPage({viewport, reducedMotion:'reduce',locale:'en-US'});
  await page.goto(pathToFileURL(output).href);
  const canvas = await page.locator('#canvas').boundingBox();
  const trigger = page.getByRole('button',{name:'흐름 검증',exact:true});
  const triggerBox = await trigger.boundingBox();
  const buttonStyle = () => trigger.evaluate(node=>{
    const {backgroundColor,borderTopColor,color,fontSize,fontWeight,lineHeight} = getComputedStyle(node);
    return {backgroundColor,borderTopColor,color,fontSize,fontWeight,lineHeight};
  });
  assert.deepEqual(await buttonStyle(),{
    backgroundColor:'rgb(255, 255, 255)',borderTopColor:'rgb(226, 50, 116)',color:'rgb(211, 43, 105)',
    fontSize:'14px',fontWeight:'500',lineHeight:'20px',
  });
  await trigger.click();
  assert.equal(await trigger.getAttribute('aria-expanded'),'true');
  assert.deepEqual(await buttonStyle(),{
    backgroundColor:'rgb(211, 43, 105)',borderTopColor:'rgb(211, 43, 105)',color:'rgb(255, 255, 255)',
    fontSize:'14px',fontWeight:'500',lineHeight:'20px',
  });
  assert.deepEqual(await trigger.boundingBox(),triggerBox);
  if (!await page.locator('#review-results').isVisible()) await page.locator('#run-checks').click();
  await page.locator('.review-group').first().waitFor({state:'visible'});
  assert.deepEqual(await page.locator('#canvas').boundingBox(),canvas);
  await trigger.click();
  assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  assert.deepEqual(await trigger.boundingBox(),triggerBox);
  await trigger.click();
  return page;
}

async function assertRouteFits(page) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.review-sidebar #verification-flow').isVisible(),true);
  const canvas = await page.locator('#canvas').boundingBox();
  const panel = await page.locator('.review-sidebar').boundingBox();
  const boards = await page.locator('.artboard:is(.verification-path,.verification-expected)').all();
  assert.ok(boards.length >= 3);
  for (const artboard of boards) {
    const id = await artboard.getAttribute('data-screen');
    const board = await artboard.boundingBox();
    assert.ok(board.x>=canvas.x && board.y>=canvas.y &&
      board.x+board.width<=canvas.x+canvas.width+1 && board.y+board.height<=canvas.y+canvas.height+1,
    id + ' should fit inside the canvas');
    assert.ok(board.x>=panel.x+panel.width || board.y>=panel.y+panel.height,
      id + ' should avoid the floating panel');
  }
}

test('공구 대여의 독립 기획 검증, 브라우저 실패 재현과 캔버스 표시', {timeout:180_000}, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wireflow-integration-'));
  t.after(()=>fs.rm(temporary, {recursive:true,force:true}));

  let normal;
  await t.test('정상 흐름은 기획 경로와 브라우저 재현을 통과한다', async () => {
    normal = await verify(temporary,'normal',sample + '.flow.json','1440x1000');
    assert.equal(normal.status, 0, normal.details);
    const {schemaVersion,verifiedAt,viewport,model,browser} = normal.report;
    assert.equal(schemaVersion, 1);
    assert.ok(Number.isFinite(Date.parse(verifiedAt)));
    assert.deepEqual(viewport, {width:1440,height:1000});
    assert.ok(model.totalStates > 6);
    assert.ok(model.totalCases > model.totalStates);
    assert.equal(browser.totalCases, model.totalCases);
    assert.equal(browser.passedCases, browser.totalCases);
    assert.deepEqual(model.findings, []);
    assert.deepEqual(browser.findings, []);
  });
  if (!normal || normal.status !== 0) return;

  let broken;
  await t.test('같은 기획으로 검증할 때 수정한 닫기 동작을 좁은 브라우저에서 발견한다', async () => {
    const flow = JSON.parse(await fs.readFile(sample + '.flow.json', 'utf8'));
    const popup = flow.screens.find(screen=>screen.id === 'rental-confirm');
    popup.actions.find(action=>action.id === 'close').to = 'drill';
    const brokenFlow = path.join(temporary,'wrong-return.flow.json');
    await fs.writeFile(brokenFlow,JSON.stringify(flow));
    const traceDir = path.join(temporary,'traces');

    broken = await verify(temporary,'wrong-return',brokenFlow,'360x780',traceDir);
    assert.equal(broken.status, 1, broken.details);
    assert.deepEqual(broken.report.viewport, {width:360,height:780});
    assert.deepEqual(broken.report.model, normal.report.model);
    assert.equal(broken.report.browser.totalCases, normal.report.browser.totalCases);
    assert.ok(broken.report.browser.passedCases < broken.report.browser.totalCases);

    const issue = broken.report.browser.findings.find(item=>item.action === 'close');
    assert.ok(issue, JSON.stringify(broken.report.browser.findings));
    assert.equal(issue.screen, 'rental-confirm');
    assert.equal(issue.expectedScreen, 'rental-date');
    assert.match(issue.actual, /drill|전동 드릴 상세/);
    assert.equal(issue.route.kind, 'Playwright');
    assert.equal(issue.route.start, 'tools');
    assert.equal(issue.route.steps.at(-1).action, 'close');
    assert.match(issue.trace, /\.zip$/);
    assert.ok((await fs.stat(path.join(traceDir,issue.trace))).size > 0);
  });
  if (!broken || broken.status !== 1) return;

  await t.test('생성한 HTML에서 독립 검증 결과와 실패 경로를 확인한다', async () => {
    const browser = await chromium.launch();
    t.after(()=>browser.close());
    const normalPage = await openReview(browser, normal.output);
    const embedded = await normalPage.locator('#build-data').textContent();
    assert.deepEqual(JSON.parse(embedded).verification.browser, normal.report.browser);
    assert.equal(await normalPage.locator('.review-row[data-status="pass"]').count(), 12);
    assert.equal(await normalPage.locator('.review-row[data-status="issue"]').count(), 0);
    await normalPage.locator('[data-review-id="require-date"] .review-item').click();
    const passingDetail = normalPage.locator('[data-review-id="require-date"] .review-item-detail');
    assert.match(await passingDetail.innerText(), /조작이 화면에 표시되지 않았어요/);
    assert.equal(await normalPage.locator('.artboard.is-active').getAttribute('data-screen'), 'rental-date');
    assert.equal(await normalPage.locator('#review').isVisible(), true);
    await normalPage.locator('[data-review-id="view-rentals"] .review-item').click();
    await assertRouteFits(normalPage);
    const zoom = normalPage.locator('#zoom-readout');
    const initial = parseInt(await zoom.textContent(),10);
    await normalPage.getByRole('button',{name:'확대',exact:true}).click();
    await normalPage.waitForFunction(value=>parseInt(document.querySelector('#zoom-readout').textContent,10)>value,initial);
    await normalPage.locator('#flow-fit').click();
    await assertRouteFits(normalPage);
    await normalPage.keyboard.press('Escape');
    assert.equal(await normalPage.locator('#review').isVisible(),false);

    const page = await openReview(browser, broken.output,{width:360,height:780});
    const finding = page.locator('[data-review-id="close-retains-date"]');
    assert.equal(await finding.getAttribute('data-status'), 'issue');
    await finding.locator('.review-item').click();
    assert.match(await finding.locator('.finding-result').first().innerText(), /02\.01.*01\.02/s);
    assert.equal(await page.locator('#review').isVisible(), true);
    await page.locator('#verification-flow').waitFor({state:'visible'});
    assert.match(await page.locator('#flow-title').innerText(), /Playwright/);
    assert.match(await page.locator('#flow-steps').innerText(), /01\.01 공구 목록/);
    assert.equal(await page.locator('.artboard.verification-issue').getAttribute('data-screen'), 'rental-confirm');
    assert.equal(await page.locator('.artboard.verification-expected').getAttribute('data-screen'), 'rental-date');
    await assertRouteFits(page);
    await page.setViewportSize({width:900,height:740});
    await assertRouteFits(page);
  });
});

test('English flow localizes controls, verification evidence and generated diagnostics', async t=>{
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'wireflow-english-'));
  t.after(()=>fs.rm(temporary,{recursive:true,force:true}));
  const input = path.join(temporary,'flow.json');
  const output = path.join(temporary,'flow.html');
  const planPath = path.join(temporary,'plan.json');
  const flow = {
    title:'Library pickup',goal:'Reserve a book and choose a collection time.',start:'catalog',
    stages:['Find a book','Pick up a book'],vars:{},
    screens:[
      {id:'catalog',title:'Catalog',stage:0,origin:'source',actions:[{id:'reserve',label:'Reserve',to:'pickup'}]},
      {id:'pickup',title:'Pickup time',stage:1,origin:'source',actions:[{id:'confirm',label:'Confirm',to:null}]},
      {id:'receipt',title:'Reservation receipt',stage:1,origin:'source',end:true,actions:[]},
    ],
    scenarios:[{id:'reserve-book',title:'Reserve a library book',
      steps:[{action:'reserve',screen:'pickup'},{action:'confirm',screen:'receipt'}]}],
  };
  const plan = {
    title:flow.title,start:flow.start,initial:{},
    screens:Object.fromEntries(flow.screens.map(screen=>[screen.id,{
      title:screen.title,end:Boolean(screen.end),
      actions:screen.actions.map(action=>({...action,to:action.to || 'receipt'})),
    }])),
  };
  await fs.writeFile(input,JSON.stringify(flow));
  await fs.writeFile(planPath,JSON.stringify(plan));
  await assert.rejects(run(process.execPath,[cli,'check',input]), error=>{
    assert.equal(error.code,1);
    assert.ok(JSON.parse(error.stdout).findings.length);
    assert.doesNotMatch(error.stdout,/\p{Script=Hangul}/u);
    return true;
  });
  await assert.rejects(run(process.execPath,[cli,'verify',input,planPath,'--output',output],{cwd:root}),{code:1});
  const browser = await chromium.launch();
  t.after(()=>browser.close());
  const page = await browser.newPage({locale:'ko-KR'});
  await page.goto(pathToFileURL(output).href);
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  await page.getByRole('button',{name:'Flow Verification',exact:true}).click();
  await page.locator('[data-review-id="pickup/confirm"] .review-item').click();
  const result = await page.locator('[data-review-id="pickup/confirm"] .review-item-detail').innerText();
  assert.match(result,/Expected/);
  assert.match(result,/Actual/);
  assert.match(result,/broken link|has no destination|Opened 02.01 Pickup time/);
  assert.doesNotMatch(result,/\p{Script=Hangul}/u);
  const {verification} = JSON.parse(await page.locator('#build-data').textContent());
  assert.ok(verification.browser.findings.length);
  assert.doesNotMatch(JSON.stringify(verification.browser.findings),/\p{Script=Hangul}/u);
  assert.equal(await page.getByRole('button',{name:'Fit path',exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Zoom in',exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'Add to AI requests',exact:true}).first().click();
  await page.getByRole('button',{name:'AI change requests: 1',exact:true}).click();
  assert.equal(await page.getByRole('heading',{name:'AI change requests',exact:true}).isVisible(),true);
  assert.match(await page.locator('#saved-requests').innerText(),/Changes needed/);
});

test('a required behavior and a proposed screen stay distinct through edit, reload and clipboard copy', async t=>{
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'wireflow-provenance-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const flow = {
    title:'Banner review',goal:'Resubmit a revision',stages:['Review'],start:'feedback',
    screens:[
      {id:'feedback',title:'Feedback',origin:'source',stage:0,actions:[{id:'upload',label:'Upload revision',to:null}]},
      {id:'draft',title:'Revision editor',origin:'inferred',stage:0,end:true,actions:[]},
    ],
    review:{locale:'en',requirements:[{id:'resubmit',screen:'feedback',action:'upload',group:'Review',
      title:'Resubmit',expected:'The designer can submit a new version for review.',origin:'source',suggestedScreens:['draft']}]},
  };
  const input=path.join(folder,'sample.json'), output=path.join(folder,'sample.html');
  await fs.writeFile(input,JSON.stringify(flow));
  await run(process.execPath,[cli,'build',input,output]);
  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:1280,height:960}});
  const page=await context.newPage();
  await page.goto(pathToFileURL(output).href);
  await page.locator('#review-open').click();
  const row=page.locator('[data-review-id="resubmit"]');
  await row.locator('.review-item').click();
  const required=flow.review.requirements[0].expected;
  const assertBasis=text=>{
    assert.match(text,/Required by the brief\s+(?:— )?The designer can submit a new version for review\./);
    assert.match(text,/AI-proposed screen \(unconfirmed\)\s+(?:— )?01\.02 Revision editor/);
  };
  assertBasis(await row.locator('.finding-result').first().innerText());
  await row.getByRole('button',{name:'Add to AI requests'}).first().click();
  await page.locator('#requests-open').click();
  await page.locator('#saved-requests li button').first().click();
  assertBasis(await page.locator('#request-planning').innerText());
  await page.locator('#request-text').fill('Keep the original feedback during resubmission.');
  await page.locator('#request-save').click();
  await page.reload();
  await page.locator('#requests-open').click();
  assertBasis(await page.locator('#saved-requests').innerText());
  await page.locator('#copy-requests').click();
  await page.waitForFunction(()=>document.querySelector('#copy-status').textContent.includes('Copied'));
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  assertBasis(copied);
  assert.ok(copied.includes(required) && copied.includes('Keep the original feedback during resubmission.'));
});

test('embedded map hotspots work beside details and above them on a narrow frame', async t=>{
  const folder = await fs.mkdtemp(path.join(os.tmpdir(),'wireflow-map-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const input=path.join(folder,'map.json'), output=path.join(folder,'map.html');
  const flow={
    title:'Gallery',goal:'Inspect the east wing',device:'desktop',stages:['Visit'],start:'map',
    images:{plan:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Z5kAAAAASUVORK5CYII='},
    screens:[
      {id:'map',title:'Floor plan',stage:0,origin:'source',actions:[{id:'east',label:'East',to:'room'}],
        ui:{layout:'split',blocks:[{type:'visual',image:'plan',aspect:'wide',label:'East gallery',
          hotspots:[{action:'east',x:60,y:30,width:20,height:15}]},{type:'notice',label:'Open to visitors'}]}},
      {id:'room',title:'East gallery',stage:0,origin:'source',actions:[],end:true},
    ],
  };
  await fs.writeFile(input,JSON.stringify(flow));
  await run(process.execPath,[cli,'build',input,output]);
  const browser=await chromium.launch();
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1400,height:1000},reducedMotion:'reduce'});
  for (const size of ['desktop','mobile']) {
    await page.goto(pathToFileURL(output).href);
    await canvasOptions(page);
    await page.locator('#device-picker').selectOption(size);
    await page.locator('#center').click();
    await page.waitForFunction(()=>!document.querySelector('#canvas').hasAttribute('data-overview'));
    const device=page.locator('.artboard.is-active .device');
    const image=device.locator('.wireflow-diagram');
    await image.evaluate(img=>img.decode());
    const art=await image.boundingBox(), side=await device.locator('.wireflow-side').boundingBox();
    assert.ok(size==='desktop' ? side.x>=art.x+art.width-1 : side.y>=art.y+art.height-1,JSON.stringify({size,side,art}));
    const spot=await device.getByRole('button',{name:'East',exact:true}).boundingBox();
    assert.ok(spot.x>art.x+art.width/2 && spot.x+spot.width<=art.x+art.width);
    await page.mouse.click(spot.x+spot.width/2,spot.y+spot.height/2);
    assert.equal(await page.locator('.artboard.is-active').getAttribute('data-screen'),'room');
  }
});

test('overview choices work with legacy flows without scenarios and leave broken links at their source', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'wireflow-overview-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const flow = {
    title:'Room inspection', goal:'Check a room', start:'map', stages:['Rooms','Inspection'],
    screens:[
      {id:'map',stage:0,origin:'source',title:'Floor plan',actions:[{id:'enter',label:'Open room',to:'room'}]},
      {id:'room',stage:1,origin:'source',title:'Room',actions:[{id:'reopen',label:'Read note',to:null}]},
    ],
  };
  const input = path.join(directory,'rooms.json'), output = path.join(directory,'rooms.html');
  await fs.writeFile(input,JSON.stringify(flow));
  await run(process.execPath,[cli,'build',input,output]);
  const browser = await chromium.launch();
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await page.goto(pathToFileURL(output).href);
  await page.locator('#overview').click();
  const structure = ()=>page.locator('.stage-cluster,.artboard').evaluateAll(nodes=>
    nodes.map(n=>[n.offsetLeft,n.offsetTop,n.offsetWidth,n.offsetHeight]));
  const original = await structure();
  const picker = page.getByRole('combobox',{name:'Show a path'});
  await canvasOptions(page);
  await picker.selectOption('map/enter');
  const enter = page.locator('[data-screen="map"] button[data-action="enter"]');
  assert.equal(await enter.getAttribute('data-route-control'),'1');
  assert.deepEqual(await structure(),original);
  await openScreen(page,'map');
  await enter.click();
  assert.equal(await page.locator('.artboard.is-active').getAttribute('data-screen'),'room');
  await canvasOptions(page);
  await picker.selectOption('room/reopen');
  await openScreen(page,'room');
  assert.equal(await page.locator('[data-action="reopen"][data-route-failed]').count(),1);
  assert.equal(await page.locator('#route-stop').isVisible(),true);
  await canvasOptions(page);
  await picker.selectOption('');
  assert.equal(await page.locator('[data-route-control]').count(),0);
  assert.equal(await page.locator('#route-stop').isVisible(),false);
});

test('a missing retry stays blocked until the viewer applies a proposal without a finding ID', async t => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(),'wireflow-retry-'));
  t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
  const input = path.join(cwd,'flow.json'), output = path.join(cwd,'flow.html');
  const flow = {
    title:'Repair request',goal:'Retry a failed request',start:'form',stages:['Request','Result'],
    vars:{note:''},review:{locale:'en'},
    screens:[
      {id:'form',title:'Request',origin:'source',stage:0,ui:{blocks:[{type:'input',field:'note',label:'Note'}]},
        actions:[{id:'fail',label:'Simulate failure',to:'failure'},{id:'submit',label:'Submit',to:'done'}]},
      {id:'failure',title:'Failed',origin:'source',stage:1,actions:[]},
      {id:'done',title:'Done',origin:'source',stage:1,terminal:true,body:'Received {{note}}',actions:[]}
    ],
    scenarios:[{id:'recover',title:'Recover',steps:[{action:'fail',screen:'failure'},{action:'retry',screen:'form'},{action:'submit',screen:'done'}]},
      {id:'cancel',title:'Cancel',steps:[{action:'fail',screen:'failure'},{action:'cancel',screen:'form'}]}],
    proposals:[{id:'recover-input',title:'Return to the form',reason:'Keep the entered note',
      changes:[{screen:'failure',action:{id:'retry',label:'Retry',to:'form'}}]},
      {id:'edit-submit',title:'Rename submit',reason:'Clarify submission',
        changes:[{screen:'form',action:{id:'submit',label:'Send',to:'done'}}]}]
  };
  await fs.writeFile(input,JSON.stringify(flow));
  await run(process.execPath,[cli,'build',input,output]);
  const browser = await chromium.launch();
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await page.goto(pathToFileURL(output).href);
  assert.equal(await page.locator('#route-picker').inputValue(),'recover');
  assert.equal(await page.locator('#route-stop').isVisible(),false);
  await openScreen(page,'failure');
  assert.equal(await page.locator('#route-stop').isVisible(),true);
  const preview = page.getByRole('button',{name:'View proposed fixes'});
  const picker = page.locator('#route-picker');
  await canvasOptions(page);
  await picker.selectOption('cancel');
  await openScreen(page,'failure');
  assert.equal(await page.locator('#route-stop').isVisible(),true);
  assert.equal(await preview.isVisible(),false);
  await canvasOptions(page);
  await picker.selectOption('');
  assert.equal(await preview.isVisible(),false);
  await picker.selectOption('recover');
  await openScreen(page,'form');
  const device = page.locator('.artboard.is-active .device');
  await device.locator('[data-control="note"]').fill('broken handle');
  await device.locator('[data-action="fail"]').click();
  assert.equal(await device.locator('[data-action="retry"]').count(),0);
  await preview.click();
  const dialog = page.getByRole('dialog',{name:/Proposed fixes/});
  assert.match(await dialog.innerText(),/Keep the entered note/);
  assert.equal(await dialog.locator('[data-proposal]').count(),1);
  assert.equal(await device.locator('[data-action="retry"]').count(),0);
  await page.keyboard.press('Escape');
  assert.equal(await preview.evaluate(node=>node===document.activeElement),true);
  assert.equal(await page.locator('#route-stop').isVisible(),true);
  await preview.click();
  await dialog.getByRole('button',{name:'Apply fix · Return to the form'}).click();
  assert.equal(await dialog.isVisible(),false);
  assert.equal(await preview.isVisible(),false);
  assert.equal(await page.locator('#route-stop').isVisible(),false);
  await device.locator('[data-action="retry"]').click();
  assert.equal(await device.locator('[data-control="note"]').inputValue(),'broken handle');
  await device.locator('[data-action="submit"]').click();
  assert.match(await device.innerText(),/Received broken handle/);
  await page.locator('#review-open').click();
  await page.getByRole('button',{name:'Undo proposed fixes'}).click();
  await page.locator('#overview').click();
  await openScreen(page,'failure');
  assert.equal(await page.locator('#route-stop').isVisible(),true);
  assert.equal(await page.locator('[data-screen="failure"] [data-action="retry"]').count(),0);
});

test('group outlines use the same side and bottom inset in overview and focus', async t=>{
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'wireflow-group-inset-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const output = path.join(directory,'library.html');
  await run(process.execPath,[cli,'build',sample+'.flow.json',output]);
  const browser = await chromium.launch();
  t.after(()=>browser.close());
  for (const width of [390,1280]) {
    const page = await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});
    await page.goto(pathToFileURL(output).href);
    for (const preset of ['mobile','tablet-landscape','watch']) {
      await canvasOptions(page);
      await page.locator('#device-picker').selectOption(preset);
      await page.locator('#overview').click();
      for (const overview of [true,false]) {
        if (!overview) await page.locator('.artboard.is-active .overview-hit').click();
        await page.waitForFunction(value=>document.querySelector('#canvas').hasAttribute('data-overview')===value,overview);
        if (!overview) {
          await page.waitForFunction(()=>!slide && cameraFrame===undefined);
          const board = await page.locator('.artboard.is-active .device').boundingBox();
          const canvas = await page.locator('#canvas').boundingBox();
          assert.ok(board.width<=canvas.width*.70+1 && board.height<=canvas.height*.70+1);
          for (const [pos,length] of [['x','width'],['y','height']]) {
            const leading = board[pos]-canvas[pos];
            const trailing = canvas[length]-board[length]-leading;
            assert.ok(Math.abs(leading-trailing)<=1,'Focused screen must be centered on both axes');
          }
        }
        const groups = await page.evaluate(()=>layout.groups.map(group=>{
          const outline = [...document.querySelectorAll('.stage-cluster')].find(el=>el.dataset.groupRoot===group.root);
          const devices = group.ids.map(id=>artboards.get(id).querySelector('.device'));
          const bounds = outline.getBoundingClientRect();
          const boxes = devices.map(device=>device.getBoundingClientRect());
          const scale = boxes[0].width/devices[0].offsetWidth;
          return {
            margins:[Math.min(...boxes.map(b=>b.left))-bounds.left, bounds.right-Math.max(...boxes.map(b=>b.right)),
              bounds.bottom-Math.max(...boxes.map(b=>b.bottom))].map(length=>length/scale),
            radius:parseFloat(getComputedStyle(outline).borderBottomLeftRadius),
            screenRadius:parseFloat(getComputedStyle(devices[0]).borderBottomLeftRadius),
          };
        }));
        assert.ok(groups.length>1);
        for (const {margins,radius,screenRadius} of groups) {
          assert.ok(margins.every(value=>Math.abs(value-24)<.02),JSON.stringify(margins));
          assert.equal(radius,screenRadius+24);
        }
      }
    }
    await page.close();
  }
});

test('following an action slides the new screen to the center of the canvas', async t=>{
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'wireflow-center-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const output = path.join(directory,'rental.html');
  await run(process.execPath,[cli,'build',sample+'.flow.json',output]);
  const browser = await chromium.launch();
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:1280,height:850},reducedMotion:'no-preference'});
  await page.goto(pathToFileURL(output).href);
  await openScreen(page,'tools');
  await page.waitForFunction(()=>!slide && cameraFrame===undefined);
  for (const [action,target] of [['open-drill','drill'],['choose-date','rental-date']]) {
    await page.locator('.artboard.is-active [data-action="'+action+'"]').first().click();
    await page.waitForFunction(id=>active===id && slide?.elapsed>0 && slide.elapsed<slide.duration,target);
    await page.waitForFunction(()=>!slide && cameraFrame===undefined);
    const frame = await page.locator('.artboard.is-active').boundingBox();
    const canvas = await page.locator('#canvas').boundingBox();
    assert.ok(Math.abs(frame.x+frame.width/2-canvas.x-canvas.width/2)<1);
    assert.ok(Math.abs(frame.y+frame.height/2-canvas.y-canvas.height/2)<1);
  }
});

test('switching review panels retains the inspected screen and request draft', async t=>{
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'wireflow-panels-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const output = path.join(directory,'rental.html');
  await run(process.execPath,[cli,'build',sample+'.flow.json',output]);
  const browser = await chromium.launch();
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await page.goto(pathToFileURL(output).href);
  await openScreen(page,'tools');
  const panels = page.locator('#review:visible, #request-editor:visible, #screen-description:visible, #request-list[open]');
  async function switchTo(button,panel) {
    await page.locator('#'+button).click();
    assert.deepEqual(await panels.evaluateAll(nodes=>nodes.map(n=>n.id)),[panel]);
  }
  await switchTo('request-open','request-editor');
  await page.locator('#request-text').fill('Check the tool details.');
  await switchTo('review-open','review');
  await switchTo('description-open','screen-description');
  await switchTo('request-open','request-editor');
  assert.equal(await page.locator('#request-text').inputValue(),'Check the tool details.');
  await switchTo('review-open','review');
  await page.locator('#review-scope > summary').click();
  await page.locator('#scenario-results > summary').click();
  await page.locator('[data-route="reserve-friday"] button').first().click();
  await page.locator('#flow-steps button').nth(2).click();
  await page.locator('.artboard[data-screen="rental-date"].is-active').waitFor();
  await switchTo('request-open','request-editor');
  assert.equal(await page.locator('#verification-flow').isVisible(),false);
  assert.match(await page.locator('#request-title').innerText(),/02\.01/);
  assert.equal(await page.locator('#request-text').inputValue(),'');
  await switchTo('requests-open','request-list');
});
