import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../dist/src/store.js';
import {effectiveColor,projectColor} from '../dist/src/colors.js';

test('project colors inherit, mission overrides reset, and reporting/replay preserve choices',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'angine-colors-'));const previous=process.env.ANGINE_HOME;process.env.ANGINE_HOME=home;
 try {
  const store=new Store();store.load();
  const report=key=>store.syncProject({project:{name:'Product',workspacePath:home},mission:{key,name:key},tasks:[{key:'test',title:'Test',status:'todo'}]});
  const a=report('first'),b=report('second');
  assert.equal(effectiveColor(store.state,a.projectId,a.missionId),effectiveColor(store.state,b.projectId,b.missionId));
  const automatic=projectColor(store.state.projects[a.projectId]);assert.match(automatic,/^#[0-9a-f]{6}$/);
  store.setColor({projectId:a.projectId,color:'#AABBCC'});
  assert.equal(effectiveColor(store.state,a.projectId,a.missionId),'#aabbcc');
  store.setColor({missionId:a.missionId,color:'#123456'});
  store.setColor({projectId:a.projectId,color:'#654321'});
  assert.equal(effectiveColor(store.state,a.projectId,a.missionId),'#123456');
  assert.equal(effectiveColor(store.state,b.projectId,b.missionId),'#654321');
  report('first');store.updateTasks({missionId:b.missionId,updates:[{taskKey:'test',status:'completed'}]});
  assert.equal(store.state.projects[a.projectId].color,'#654321');assert.equal(store.state.missions[a.missionId].color,'#123456');
  for(const input of [{projectId:a.projectId,color:'red'},{missionId:a.missionId,color:'url(x)'},{projectId:a.projectId,missionId:a.missionId,color:'#ffffff'},{projectId:'missing',color:null}])assert.throws(()=>store.setColor(input));
  const replay=new Store();replay.load();assert.equal(effectiveColor(replay.state,a.projectId,a.missionId),'#123456');
  assert.equal(projectColor(replay.state.projects[a.projectId]),'#654321');
  store.setColor({missionId:a.missionId,color:null});assert.equal(effectiveColor(store.state,a.projectId,a.missionId),'#654321');
  store.setColor({projectId:a.projectId,color:null});assert.equal(effectiveColor(store.state,a.projectId,a.missionId),automatic);
 }finally{if(previous===undefined)delete process.env.ANGINE_HOME;else process.env.ANGINE_HOME=previous;fs.rmSync(home,{recursive:true,force:true});}
});
