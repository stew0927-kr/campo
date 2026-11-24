#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {randomUUID} = require('node:crypto');
const assets = path.join(__dirname, '..', 'assets');
const wireflow = require(path.join(assets, 'engine.js'));
const {resolve:resolveLocale,translator} = require(path.join(assets, 'locale.js'));
const paperStyles = require(path.join(assets, 'paper', 'styles.cjs'));
const readAsset = name => fs.readFileSync(path.join(assets, name), 'utf8');
const embed = value => JSON.stringify(value).replace(/</g, '\\u003c');

function readFlow(input) {
  return wireflow.validateModel(JSON.parse(fs.readFileSync(input, 'utf8')));
}

function prepareFlow(input, workspace) {
  const model = readFlow(input);
  const flowPath = path.relative(workspace, path.resolve(input)).split(path.sep).join('/');
  const template = readAsset('viewer.html');
  const slots = {
    data: embed(model),
    styles: paperStyles()+'\n'+readAsset('viewer.css'),
    connections: readAsset('paper/connections.js'),
    workshop: model.review?.renderer === 'workshop' ? readAsset('workshop.js') : '',
  };
  for (const key of ['locale', 'engine', 'layout', 'audit', 'reachability-audit', 'verification-view', 'review-panel', 'screen', 'viewer']) {
    slots[key] = readAsset(key+'.js');
  }
  return {
    model,
    render(verification) {
      const build = embed({flowPath,verification});
      return template.replace(/<!-- wireflow:([\w-]+) -->|\/\* wireflow:([\w-]+) \*\//g,
        (_, comment, script) => (comment || script) === 'build' ? build : slots[comment || script]);
    },
  };
}

function writeOutput(output,data) {
  const destination = path.resolve(output);
  fs.mkdirSync(path.dirname(destination), {recursive:true});
  const temporary = path.join(path.dirname(destination),'.wireflow-'+randomUUID());
  try {
    fs.writeFileSync(temporary,data);
    fs.renameSync(temporary,destination);
  } finally {
    fs.rmSync(temporary,{force:true});
  }
}

function buildFlow(input, output, workspace = process.cwd()) {
  if (path.resolve(input) === path.resolve(output)) throw new Error('The HTML output must be separate from the input JSON');
  const preview = prepareFlow(input,workspace);
  writeOutput(output,preview.render());
  return preview.model;
}

const verifyUsage = 'verify FLOW.json PLAN.json [--output VIEWER.html] [--report REPORT.json] [--trace-dir DIR] [--viewport WIDTHxHEIGHT]';

function verifyOptions(args) {
  const [input,planPath,...flags] = args;
  const options = new Map();
  if (!input || !planPath || planPath.startsWith('--') || flags.length%2) throw new Error('Usage: wireflow.cjs '+verifyUsage);
  for (let i=0; i<flags.length; i+=2) {
    const [flag,value] = flags.slice(i,i+2);
    if (!['--output','--report','--trace-dir','--viewport'].includes(flag) || options.has(flag) || !value || value.startsWith('--')) {
      throw new Error('Invalid verification option: '+flag);
    }
    options.set(flag,value);
  }
  const dimensions = /^(\d{1,4})x(\d{1,4})$/.exec(options.get('--viewport') || '1440x1000');
  if (!dimensions || Number(dimensions[1])<1 || Number(dimensions[2])<1) throw new Error('Viewport must be WIDTHxHEIGHT');
  const output = options.get('--output');
  const reportPath = options.get('--report');
  const files = [input,planPath,output,reportPath].filter(Boolean).map(file=>path.resolve(file));
  if (new Set(files).size!==files.length) throw new Error('Use distinct paths for the flow, plan, HTML, and report');
  const traceDir = options.get('--trace-dir');
  return {input,planPath,output,reportPath,traceDir:traceDir && path.resolve(traceDir),
    viewport:{width:Number(dimensions[1]),height:Number(dimensions[2])}};
}

async function verifyFlow(args) {
  const options = verifyOptions(args);
  const {input,planPath,output,reportPath,traceDir,viewport} = options;
  if (Number(process.versions.node.split('.')[0])<20) throw new Error('Independent verification requires Node.js 20+');
  const verificationDir = path.join(__dirname,'..','verification');
  for (const dependency of ['xstate','playwright']) {
    try { require.resolve(dependency,{paths:[verificationDir]}); }
    catch { throw new Error('Install the verification dependencies with npm ci --prefix '+verificationDir); }
  }
  const {compilePlan} = require('../verification/plan.cjs');
  const {verifyBrowser} = require('../verification/browser.cjs');
  const preview = prepareFlow(input,process.cwd());
  const compiled = compilePlan(JSON.parse(fs.readFileSync(planPath,'utf8')),resolveLocale(preview.model));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'wireflow-verify-'));
  let browser;
  try {
    const candidate = path.join(directory,'candidate.html');
    fs.writeFileSync(candidate,preview.render());
    browser = await verifyBrowser(candidate,compiled,{viewport,traceDir});
  } finally {
    fs.rmSync(directory,{recursive:true,force:true});
  }
  const report = {
    schemaVersion:1,
    verifiedAt:new Date().toISOString(),
    viewport,
    planTitle:compiled.title,
    model:{totalStates:compiled.totalStates,totalCases:compiled.cases.length,findings:compiled.findings,
      passedChecks:compiled.passedChecks ?? []},
    browser,
  };
  if (reportPath) writeOutput(reportPath,JSON.stringify(report,null,2)+'\n');
  if (output) writeOutput(output,preview.render(report));
  return report;
}

module.exports = {buildFlow};

async function main(argv) {
  const [command,input,argument,option,...extra] = argv;
  if (command === 'verify') {
    const report = await verifyFlow(argv.slice(1));
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    return report.model.findings.length || report.browser.findings.length ? 1 : 0;
  }
  const checkArguments = command === 'check' && (!argument && !option || argument === '--with' && option);
  const buildArguments = command === 'build' && argument && !option;
  if (!input || extra.length || !(checkArguments || buildArguments)) {
    throw new Error('Usage: wireflow.cjs check FLOW.json [--with ID,ID] | build FLOW.json VIEWER.html | '+verifyUsage);
  }
  if (command === 'check') {
    const model = readFlow(input);
    const candidate = option ? wireflow.applyProposals(model, option.split(',')) : model;
    const result = wireflow.check(candidate,translator(resolveLocale(model)));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.findings.length ? 1 : 0;
  }
  const model = buildFlow(input,argument);
  const {findings,scenarios} = wireflow.check(model);
  console.log(`${argument} · ${model.screens.length} screens · ${findings.length} findings · ${scenarios.filter(test => test.passed).length}/${scenarios.length} scenarios passed`);
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then(code=>{
  process.exitCode = code;
},error=>{
  console.error(error.message);
  process.exitCode = 2;
});
