import test from 'node:test';
import assert from 'node:assert/strict';
import { ReporterRegistry } from '../dist/src/health.js';
import { attentionTasks, connectionStatus, groupConnections, heartbeatTimeout, protocolVersion } from '../dist/src/reporting.js';
import { defaultProfiles } from '../dist/src/workflow.js';

test('heartbeats confirm reporter connectivity without claiming work progress', () => {
  let clock = Date.parse('2026-10-05T10:00:00Z');
  const registry = new ReporterRegistry(defaultProfiles,()=>clock);
  const input = {reporterId:'one',agent:'codex',protocolVersion,version:'0.1.0'};
  const first = registry.ping(input);
  assert.equal(connectionStatus(first,clock),'connected');
  assert.equal(first.lastReportAt,undefined);
  assert.equal(first.successfulReports,0);
  clock += heartbeatTimeout;
  assert.equal(connectionStatus(registry.view().reporters[0],clock),'disconnected');
  const next = registry.ping(input);
  assert.equal(next.startedAt,first.startedAt);
  assert.equal(next.lastReportAt,undefined);
  assert.equal(connectionStatus(next,clock),'connected');
  registry.report('one',true);
  const reportTime = registry.view().reporters[0].lastReportAt;
  clock += 25000;registry.ping(input);
  assert.equal(registry.view().reporters[0].lastReportAt,reportTime);
  registry.close('one');
  assert.equal(connectionStatus(registry.view().reporters[0],clock),'disconnected');
  registry.ping(input);
  assert.equal(connectionStatus(registry.view().reporters[0],clock),'connected');
});

test('profile and protocol issues are explicit, reports recover, and diagnostics are isolated', () => {
  const profiles = defaultProfiles();
  const registry = new ReporterRegistry(()=>profiles);
  const input = {reporterId:'one',agent:'claude',protocolVersion,profileKey:'unknown'};
  assert.equal(registry.ping(input).issue,'profile_missing');
  registry.report('one',false);
  assert.equal(registry.view().reporters[0].failedReports,1);
  assert.equal(registry.view().reporters[0].issue,'profile_missing');
  input.profileKey='claude-default';
  assert.equal(registry.ping(input).profileId,'profile_claude-default');
  registry.report('one',false);
  assert.equal(registry.view().reporters[0].issue,'report_rejected');
  registry.ping(input);
  assert.equal(registry.view().reporters[0].issue,'report_rejected');
  registry.report('one',true);
  assert.equal(registry.view().reporters[0].issue,undefined);
  assert.equal(registry.ping({...input,protocolVersion:1}).issue,'reporter_outdated');
  assert.equal(registry.ping(input).issue,undefined);
  assert.throws(()=>registry.ping({...input,agent:'codex'}),/identity mismatch/);
  const copy=registry.view();copy.reporters[0].successfulReports=100;
  assert.equal(registry.view().reporters[0].successfulReports,1);
  assert.equal(new ReporterRegistry(()=>profiles).view().reporters.length,0);
});

test('attention prioritises blockers and failures, distinguishes unknown connections, and preserves task state', () => {
  const timestamp=Date.parse('2026-10-05T10:00:00Z');
  const iso=new Date(timestamp).toISOString();
  const task=(id,status,more={})=>({id,key:id,projectId:'p',title:id,status,updatedBy:'codex',createdAt:iso,updatedAt:iso,...more});
  const tasks=[task('blocked','blocked',{blocker:{reason:'API',nextStep:'Approve contract'}}),task('failed','failed'),task('old','in_progress',{updatedAt:new Date(timestamp-3600000).toISOString()}),task('offline','in_progress',{updatedBySessionId:'s'}),task('unknown','in_progress'),task('done','completed'),task('archived','failed',{projectId:'archive'})];
  const state={seq:1,profiles:{},workspaces:{},projects:{p:{id:'p'},archive:{id:'archive',archivedAt:iso}},tasks:Object.fromEntries(tasks.map(t=>[t.id,t])),sessions:{s:{reporterId:'r'}}};
  const health={serverVersion:'0.1.0',protocolVersion,checkedAt:iso,reporters:[{id:'r',agent:'codex',startedAt:iso,lastSeenAt:new Date(timestamp-heartbeatTimeout).toISOString(),successfulReports:0,failedReports:0}]};
  const before=structuredClone(state);
  const results=attentionTasks(state,tasks,health,60,timestamp);
  assert.deepEqual(results.map(r=>r.task.id),['blocked','failed','old','offline']);
  assert.equal(results[0].reason,'Approve contract');
  assert.match(results[3].reason,/disconnected/);
  assert.deepEqual(state,before);
  assert.deepEqual(attentionTasks(state,tasks,null,0,timestamp).map(r=>r.task.id),['blocked','failed']);
  health.reporters[0].lastSeenAt=iso;
  assert.deepEqual(attentionTasks(state,tasks,health,60,timestamp).map(r=>r.task.id),['blocked','failed','old']);
});

test('reporter diagnostics remain bounded and can replace disconnected history', () => {
  let clock=0;
  const registry=new ReporterRegistry(defaultProfiles,()=>clock);
  for(let i=0;i<500;i++) registry.ping({reporterId:String(i),agent:'codex',protocolVersion});
  assert.throws(()=>registry.ping({reporterId:'extra',agent:'codex',protocolVersion}),/Too many/);
  clock+=heartbeatTimeout;
  registry.ping({reporterId:'extra',agent:'codex',protocolVersion});
  assert.equal(registry.view().reporters.length,500);
  assert.ok(registry.view().reporters.some(r=>r.id==='extra'));
});

test('server restart recovers matched history without inventing new report counts',()=>{
  const known='2026-10-05T10:00:00.000Z';
  const registry=new ReporterRegistry(defaultProfiles,()=>Date.parse('2026-10-06T10:00:00Z'),id=>id==='reported' ? known : undefined);
  const old=registry.ping({reporterId:'reported',agent:'codex',protocolVersion});
  assert.equal(old.lastReportAt,known);
  assert.equal(old.successfulReports,0);
  assert.equal(old.failedReports,0);
  assert.equal(registry.ping({reporterId:'new',agent:'codex',protocolVersion}).lastReportAt,undefined);
  registry.report('reported',true);
  assert.equal(registry.view().reporters.find(r=>r.id==='reported').lastReportAt,'2026-10-06T10:00:00.000Z');
});

test('connection groups separate profiles and distinguish heartbeats from submitted work',()=>{
  const timestamp=Date.parse('2026-10-06T10:00:00Z');
  const registry=new ReporterRegistry(defaultProfiles,()=>timestamp);
  const reporting=registry.ping({reporterId:'reporting',agent:'codex',protocolVersion});
  registry.report(reporting.id,true);
  registry.ping({reporterId:'idle',agent:'codex',protocolVersion});
  registry.ping({reporterId:'other-profile',agent:'codex',profileKey:'missing',protocolVersion});
  registry.ping({reporterId:'claude',agent:'claude',protocolVersion});
  registry.close('claude');
  const groups=groupConnections(registry.view().reporters,timestamp);
  assert.equal(groups.length,3);
  const codex=groups.find(g=>g.profileId==='profile_codex-default');
  assert.equal(codex.connected,2);
  assert.equal(codex.sentUpdates,1);
  assert.equal(codex.connectedOnly,1);
  assert.equal(codex.reporters[0].id,'reporting');
  assert.equal(groups[0].issues,1);
  assert.equal(groups.find(g=>g.agent==='claude').connected,0);
});
