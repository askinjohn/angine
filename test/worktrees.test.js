import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../dist/src/store.js';
import { workspaceIdentity } from '../dist/src/model.js';
import { groupRepositoryProjects } from '../dist/src/repositories.js';

const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{stdio:'pipe',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1'}}).toString().trim();
function fixture(run) {
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'angine-worktrees-'));
 const previous=process.env.ANGINE_HOME;process.env.ANGINE_HOME=path.join(home,'data');
 try {
  const repo=path.join(home,'services');fs.mkdirSync(repo);git(repo,'init');
  git(repo,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','initial');
  const tree=path.join(home,'feature');git(repo,'worktree','add','-b','feature',tree);
  const store=new Store();store.load();run({home,repo,tree,store});
 } finally {if(previous===undefined) delete process.env.ANGINE_HOME;else process.env.ANGINE_HOME=previous;fs.rmSync(home,{recursive:true,force:true});}
}
const report=(store,workspacePath,key='goal',task='step')=>store.syncProject({reporterId:workspacePath,project:{name:'Services',workspacePath},mission:{key,name:key},tasks:[{key:task,title:task,status:'todo'}]});

test('worktrees share repository project, explicit missions, and retain workspace/branch',()=>fixture(({repo,tree,store,home})=>{
 const a=workspaceIdentity(repo),b=workspaceIdentity(tree);
 assert.notEqual(a.id,b.id);assert.equal(a.repositoryId,b.repositoryId);assert.equal(b.branch,'feature');
 const first=report(store,repo,'shared','main');const second=report(store,tree,'shared','feature');
 assert.equal(first.projectId,second.projectId);assert.equal(first.missionId,second.missionId);
 assert.equal(Object.keys(store.state.projects).length,1);assert.equal(Object.keys(store.state.tasks).length,2);
 assert.deepEqual(new Set(store.state.missions[first.missionId].workspaceIds),new Set([a.id,b.id]));
 assert.equal(new Set(Object.values(store.state.sessions).map(s=>s.workspaceId)).size,2);
 store.updateTasks({reporterId:tree,missionId:first.missionId,updates:[{taskKey:'feature',status:'completed'}]});
 assert.equal(store.state.sessions[store.state.tasks[second.taskIds.feature].updatedBySessionId].workspaceId,b.id);
 const other=path.join(home,'other');fs.mkdirSync(other);git(other,'init');
 assert.notEqual(report(store,other).projectId,first.projectId);
 store.snapshot();const replay=new Store();replay.load();assert.deepEqual(replay.state,store.state);
}));

test('existing duplicate projects merge without merging missions or rewriting history',()=>fixture(({repo,tree,store})=>{
 const first=report(store,repo,'same','one');const second=report(store,tree,'different','two');
 const legacy=structuredClone(store.state);const root=legacy.projects[first.projectId];delete legacy.projects[first.projectId];
 const workspaces=Object.values(legacy.workspaces);
 for(const [i,w] of workspaces.entries()) {
  delete w.repositoryId;delete w.repositoryPath;delete w.branch;
  const id=`prj_${w.id}`;legacy.projects[id]={...root,id,workspaceId:w.id,...(i===1?{archivedAt:'2026-10-01T00:00:00.000Z'}:{})};
  for(const m of Object.values(legacy.missions))if(m.workspaceId===w.id){m.projectId=id;m.key='same';}
  for(const t of Object.values(legacy.tasks))t.projectId=legacy.missions[t.missionId].projectId;
  for(const s of Object.values(legacy.sessions))if(s.workspaceId===w.id){s.projectId=id;s.projectIds=[id];}
 }
 store.state=legacy;store.snapshot();const logs=fs.readFileSync(path.join(process.env.ANGINE_HOME,'events',fs.readdirSync(path.join(process.env.ANGINE_HOME,'events'))[0]),'utf8');
 const replay=new Store();replay.load();
 assert.equal(Object.keys(replay.state.projects).length,1);assert.equal(Object.keys(replay.state.missions).length,2);
 assert.ok(replay.state.missions[second.missionId].archivedAt);
 assert.deepEqual(Object.keys(replay.state.tasks),Object.keys(legacy.tasks));
 assert.ok(fs.existsSync(path.join(process.env.ANGINE_HOME,'state','snapshot.json.before-worktrees')));
 assert.equal(fs.readFileSync(path.join(process.env.ANGINE_HOME,'events',fs.readdirSync(path.join(process.env.ANGINE_HOME,'events'))[0]),'utf8'),logs);
 const oldId=legacy.missions[first.missionId].projectId;
 replay.updateTasks({projectId:oldId,missionId:first.missionId,updates:[{taskKey:'one',status:'completed'}]});
 assert.equal(replay.state.tasks[first.taskIds.one].status,'completed');
 assert.ok(replay.projectEvents(oldId).length);
 const again=report(replay,tree,'same','two');assert.equal(again.missionId,second.missionId);
 assert.notEqual(again.missionId,first.missionId);
 assert.deepEqual(groupRepositoryProjects(replay.state),replay.state);
 // Removed worktrees remain associated after their recorded identity is saved.
 git(repo,'worktree','remove',tree);const reloaded=new Store();reloaded.load();assert.equal(Object.keys(reloaded.state.projects).length,1);
}));
