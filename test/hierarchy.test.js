import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../dist/src/store.js';
import { normalizeHierarchy, isArchivedTask } from '../dist/src/hierarchy.js';
import { notificationChanges } from '../dist/src/workflow.js';

function isolated(run) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'beacon-hierarchy-'));
  const previous=process.env.BEACON_HOME;process.env.BEACON_HOME=home;
  try {const store=new Store();store.load();run(store,home);}
  finally {if(previous===undefined) delete process.env.BEACON_HOME;else process.env.BEACON_HOME=previous;fs.rmSync(home,{recursive:true,force:true});}
}

test('different legacy plans become missions in one active workspace project',()=>isolated((store,home)=>{
  const first=store.syncProject({agent:'codex',project:{key:'connection',name:'Connection health',workspacePath:home},tasks:[{key:'verify',title:'Verify connection',status:'completed'}]});
  const second=store.syncProject({agent:'claude',project:{key:'profiles',name:'Profile help',workspacePath:home},tasks:[{key:'verify',title:'Verify help',status:'in_progress'}]});
  assert.equal(first.rootProjectId,second.rootProjectId);
  assert.equal(Object.keys(store.state.projects).length,1);
  assert.equal(Object.keys(store.state.missions).length,2);
  assert.notEqual(first.taskIds.verify,second.taskIds.verify);
  assert.equal(store.state.tasks[first.taskIds.verify].missionId,first.missionId);
  assert.equal(store.state.tasks[first.taskIds.verify].projectId,first.rootProjectId);
  assert.equal(store.state.missions[first.missionId].status,'completed');
  assert.equal(store.state.projects[first.rootProjectId].status,'active');
  const before=store.view();
  assert.throws(()=>store.updateTasks({projectId:first.rootProjectId,updates:[{taskKey:'verify',status:'completed'}]}),/multiple missions/);
  assert.deepEqual(store.state,before);
  store.updateTasks({projectId:second.projectId,updates:[{taskKey:'verify',status:'completed'}]});
  assert.equal(store.state.projects[first.rootProjectId].status,'active');
  assert.equal(store.state.missions[second.missionId].status,'completed');
  assert.ok(store.missionEvents(first.missionId).every(e=>e.missionId===first.missionId));
  assert.ok(store.projectEvents(first.rootProjectId).some(e=>e.missionId===second.missionId));
  const replayed=new Store();replayed.load();assert.deepEqual(replayed.state,store.state);
}));

test('explicit mission reports share goals across agents and isolate task namespaces',()=>isolated((store,home)=>{
  const project={key:'product',name:'Example Product',workspacePath:home};
  const mission={key:'api',name:'Build API'};
  const first=store.syncProject({project,mission,agent:'claude',tasks:[{key:'api',title:'API',status:'in_progress'}]});
  const second=store.syncProject({project,mission,agent:'codex',tasks:[{key:'test',title:'Tests',status:'todo',relatedTaskKeys:['api']}]});
  assert.equal(first.projectId,first.rootProjectId);
  assert.equal(first.missionId,second.missionId);
  assert.equal(store.state.projects[first.projectId].name,'Example Product');
  store.updateTasks({projectId:first.projectId,missionId:first.missionId,updates:[{taskKey:'api',status:'completed'}]});
  const other=store.syncProject({project,mission:{key:'docs',name:'Documentation'},tasks:[{key:'api',title:'API docs',status:'todo'}]});
  assert.notEqual(other.taskIds.api,first.taskIds.api);
  assert.throws(()=>store.updateTasks({projectId:'wrong',missionId:first.missionId,updates:[{taskKey:'api',status:'completed'}]}),/does not belong/);
  assert.throws(()=>store.editTaskDetails(other.taskIds.api,{relatedTaskKeys:['test']}),/same mission/);
}));

test('snapshot migration preserves IDs, statuses, archives, links, and session identity with a backup',()=>isolated((store,home)=>{
  const timestamp='2026-10-01T12:00:00.000Z';
  const legacy={seq:0,workspaces:{w:{id:'w',path:home}},projects:{
    proj_old:{id:'proj_old',key:'one',workspaceId:'w',name:'First goal',status:'completed',createdAt:timestamp,updatedAt:timestamp},
    proj_other:{id:'proj_other',key:'two',workspaceId:'w',name:'Second goal',status:'blocked',createdAt:timestamp,updatedAt:timestamp,archivedAt:timestamp}},
    tasks:{t:{id:'t',key:'a',projectId:'proj_old',title:'Task',status:'completed',relatedTaskKeys:['b'],parentKey:'b',updatedBy:'codex',createdAt:timestamp,updatedAt:timestamp},b:{id:'b',key:'b',projectId:'proj_old',title:'Parent',status:'completed',updatedBy:'codex',createdAt:timestamp,updatedAt:timestamp}},
    sessions:{s:{id:'s',key:'unchanged',workspaceId:'w',projectId:'proj_other',projectIds:['proj_old','proj_other'],agent:'codex',sourceSessionId:'native',agentId:'root',startedAt:timestamp,lastSeenAt:timestamp}}};
  fs.mkdirSync(path.join(home,'state'),{recursive:true});const file=path.join(home,'state','snapshot.json');
  const original=JSON.stringify(legacy);fs.writeFileSync(file,original);
  const migrated=new Store();migrated.load();
  assert.equal(Object.keys(migrated.state.projects).length,1);
  assert.equal(migrated.state.missions.proj_old.id,'proj_old');
  assert.equal(migrated.state.missions.proj_other.archivedAt,timestamp);
  assert.equal(migrated.state.tasks.t.missionId,'proj_old');
  assert.equal(migrated.state.tasks.t.parentKey,'b');
  assert.deepEqual(migrated.state.tasks.t.relatedTaskKeys,['b']);
  assert.equal(migrated.state.sessions.s.key,'unchanged');
  assert.equal(migrated.state.sessions.s.sourceSessionId,'native');
  assert.deepEqual(migrated.state.sessions.s.missionIds,['proj_old','proj_other']);
  assert.deepEqual(migrated.state.sessions.s.projectIds,['prj_w']);
  assert.equal(migrated.state.projects.prj_w.status,'active');
  assert.equal(fs.readFileSync(`${file}.before-missions`,'utf8'),original);
  assert.deepEqual(normalizeHierarchy(migrated.state),migrated.state);
  migrated.snapshot();const replayed=new Store();replayed.load();assert.deepEqual(replayed.state,migrated.state);
}));

test('legacy logs replay alongside new events without rewriting history or breaking old update IDs',()=>isolated((store,home)=>{
  const timestamp='2026-10-01T12:00:00.000Z';
  const old={id:'proj_old',key:'old',workspaceId:'w',name:'Old goal',status:'running',createdAt:timestamp,updatedAt:timestamp};
  const events=[
    {seq:1,type:'project.created',projectId:old.id,timestamp,payload:old},
    {seq:2,type:'workspace.upserted',timestamp,payload:{id:'w',path:home}},
    {seq:3,type:'task.created',projectId:old.id,taskId:'t',timestamp,payload:{id:'t',projectId:old.id,key:'a',title:'Task',status:'in_progress',updatedBy:'codex',createdAt:timestamp,updatedAt:timestamp}}
  ];
  const file=path.join(home,'events','2026-10.ndjson');const prefix=events.map(e=>JSON.stringify(e)).join('\n')+'\n';fs.writeFileSync(file,prefix);
  const migrated=new Store();migrated.load();
  assert.equal(migrated.state.projects.prj_w.name,path.basename(home));
  migrated.updateTasks({projectId:old.id,agent:'codex',updates:[{taskKey:'a',status:'completed'}]});
  assert.equal(migrated.state.missions[old.id].status,'completed');
  assert.equal(migrated.state.projects.prj_w.status,'active');
  assert.equal(migrated.state.tasks.t.id,'t');
  assert.ok(fs.readFileSync(file,'utf8').startsWith(prefix));
  assert.ok(migrated.projectEvents('prj_w').some(e=>e.seq===1));
  assert.ok(migrated.missionEvents(old.id).some(e=>e.type==='mission.completed'));
  assert.deepEqual(migrated.projectEvents(old.id),migrated.missionEvents(old.id));
  const replayed=new Store();replayed.load();assert.deepEqual(replayed.state,migrated.state);
}));

test('project archive hides all its missions and notifications without changing mission statuses',()=>isolated((store,home)=>{
  const input={project:{name:'Product',workspacePath:home},mission:{key:'goal',name:'Goal'},tasks:[{key:'a',title:'A',status:'in_progress'}]};
  const result=store.syncProject(input);const before=store.view();
  store.archiveProject(result.projectId,true);
  assert.equal(isArchivedTask(store.state,store.state.tasks[result.taskIds.a]),true);
  store.updateTasks({missionId:result.missionId,updates:[{taskKey:'a',status:'completed'}]});
  assert.deepEqual(notificationChanges(before,store.state),[]);
  assert.ok(store.state.projects[result.projectId].archivedAt);
  assert.equal(store.state.missions[result.missionId].status,'completed');
  store.archiveProject(result.projectId,false);
  store.archiveProject(result.missionId,true);
  store.syncProject({...input,tasks:[{key:'a',title:'A',status:'completed'}]});
  assert.equal(isArchivedTask(store.state,store.state.tasks[result.taskIds.a]),true);
  assert.ok(store.state.missions[result.missionId].archivedAt);
  assert.equal(store.state.projects[result.projectId].archivedAt,undefined);
}));
