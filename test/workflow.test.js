import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../dist/src/store.js';
import { isStale, notificationChanges } from '../dist/src/workflow.js';
function isolated(run) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'angine-workflow-'));
  const prior = process.env.ANGINE_HOME; process.env.ANGINE_HOME = home;
  try { const store = new Store(); store.load(); run(store,home); }
  finally { if (prior === undefined) delete process.env.ANGINE_HOME; else process.env.ANGINE_HOME = prior; fs.rmSync(home,{recursive:true,force:true}); }
}
test('archive preserves history and reporting does not restore archived work', () => isolated((store,home) => {
  const project = {key:'archive',name:'Archive',workspacePath:home};
  const result = store.syncProject({agent:'codex',project,tasks:[{key:'a',title:'A',status:'in_progress'}]});
  const updatedAt = store.state.missions[result.missionId].updatedAt;
  store.archiveProject(result.projectId,true);
  assert.equal(store.state.missions[result.missionId].updatedAt,updatedAt);
  store.syncProject({agent:'codex',project,tasks:[{key:'a',title:'A',status:'completed'}]});
  assert.ok(store.state.missions[result.missionId].archivedAt);
  assert.ok(store.state.tasks[result.taskIds.a]);
  assert.ok(store.projectEvents(result.projectId).length >= 5);
  store.archiveProject(result.projectId,false);
  assert.equal(store.state.missions[result.missionId].archivedAt,undefined);
  const replayed = new Store(); replayed.load(); assert.deepEqual(replayed.state,store.state);
}));
test('two agents link tasks in one project and blocker details survive reports', () => isolated((store,home) => {
  const project = {key:'shared',name:'Shared',workspacePath:home};
  const first = store.syncProject({agent:'claude',project,tasks:[{key:'api',title:'API',status:'in_progress'}]});
  const second = store.syncProject({agent:'codex',project,tasks:[{key:'ui',title:'UI',parentKey:'api',relatedTaskKeys:['api'],status:'blocked',blocker:{reason:'Waiting for API',nextStep:'Finish API contract',owner:'Work team'}}]});
  assert.equal(first.projectId,second.projectId);
  assert.equal(Object.keys(store.state.tasks).length,2);
  assert.equal(store.state.tasks[second.taskIds.ui].blocker.nextStep,'Finish API contract');
  store.updateTasks({agent:'codex',projectId:first.projectId,updates:[{taskKey:'ui',status:'blocked',note:'Still waiting'}]});
  assert.equal(store.state.tasks[second.taskIds.ui].blocker.reason,'Waiting for API');
  const before = store.view();
  assert.throws(() => store.editTaskDetails(second.taskIds.ui,{relatedTaskKeys:['missing']}),/must exist/);
  assert.deepEqual(store.state,before);
  store.editTaskDetails(first.taskIds.api,{relatedTaskKeys:['ui']});
  assert.deepEqual(store.state.tasks[first.taskIds.api].relatedTaskKeys,['ui']);
  store.updateTasks({agent:'codex',projectId:first.projectId,updates:[{taskKey:'ui',status:'completed'}]});
  assert.equal(store.state.tasks[second.taskIds.ui].blocker,undefined);
}));
test('profiles distinguish work and personal sessions and retain shared project membership', () => isolated((store,home) => {
  const work = store.saveProfile({key:'codex-work',name:'Codex / Work',agent:'codex',context:'Work',ownerName:'Example Owner',ownerEmail:'owner@example.com',isDefault:false});
  const project = {key:'profiles',name:'Profiles',workspacePath:home};
  const first = store.syncProject({agent:'codex',sessionKey:'same',profileKey:work.key,sourceSessionId:'native',project,tasks:[{key:'work',title:'Work',status:'in_progress'}]});
  const second = store.syncProject({agent:'codex',sessionKey:'same',sourceSessionId:'native',project,tasks:[{key:'personal',title:'Personal',status:'in_progress'}]});
  const workSession = store.state.sessions[store.state.tasks[first.taskIds.work].updatedBySessionId];
  const personalSession = store.state.sessions[store.state.tasks[second.taskIds.personal].updatedBySessionId];
  assert.equal(workSession.profileId,work.id);
  assert.notEqual(workSession.id,personalSession.id);
  assert.equal(store.state.profiles[personalSession.profileId].context,'Other');
  const another = store.syncProject({agent:'codex',sessionKey:'same',profileKey:work.key,sourceSessionId:'native',project:{...project,key:'another'},tasks:[]});
  assert.deepEqual(new Set(store.state.sessions[workSession.id].missionIds),new Set([first.missionId,another.missionId]));
  store.saveProfile({...work,isDefault:true});
  assert.equal(Object.values(store.state.profiles).filter(p=>p.agent==='codex' && p.isDefault).length,1);
  assert.throws(()=>store.saveProfile({...work,ownerEmail:'invalid'}),/email/);
  assert.throws(()=>store.syncProject({agent:'claude',profileKey:work.key,project,tasks:[]}),/Unknown profile/);
  const replayed = new Store(); replayed.load(); assert.deepEqual(replayed.state,store.state);
}));
test('old snapshots acquire profiles without losing task or session records', () => isolated((store,home) => {
  const result = store.syncProject({agent:'external',project:{name:'Old',workspacePath:home},tasks:[{key:'a',title:'A',status:'todo'}]});
  store.snapshot();
  const file = path.join(home,'state','snapshot.json');
  const old = JSON.parse(fs.readFileSync(file)); delete old.profiles;
  fs.writeFileSync(file,JSON.stringify(old));
  const replayed = new Store(); replayed.load();
  assert.ok(replayed.state.tasks[result.taskIds.a]);
  assert.ok(Object.values(replayed.state.profiles).some(p=>p.agent==='external'));
}));
test('stale flags describe active reporting only and notifications ignore old or archived updates', () => isolated((store,home) => {
  const timestamp = Date.parse('2026-10-05T12:00:00Z');
  const item = {status:'in_progress',updatedAt:'2026-10-05T10:00:00Z'};
  assert.equal(isStale(item,60,timestamp),true);
  assert.equal(isStale(item,0,timestamp),false);
  assert.equal(isStale({...item,status:'completed'},60,timestamp),false);
  const result = store.syncProject({project:{name:'Notify',workspacePath:home},tasks:[{key:'a',title:'A',status:'in_progress'}]});
  const before = store.view(); assert.deepEqual(notificationChanges(null,before),[]);
  store.updateTasks({projectId:result.projectId,updates:[{taskKey:'a',status:'blocked'}]});
  assert.equal(notificationChanges(before,store.state)[0].status,'blocked');
  assert.deepEqual(notificationChanges(store.state,store.state),[]);
  const blocked = store.view(); store.archiveProject(result.projectId,true);
  store.updateTasks({projectId:result.projectId,updates:[{taskKey:'a',status:'completed'}]});
  assert.deepEqual(notificationChanges(blocked,store.state),[]);
}));
