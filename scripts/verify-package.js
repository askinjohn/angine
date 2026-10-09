// Run against the packed artifact, with isolated storage and simulated agent CLIs.
// This exercises the real MCP client/server protocol, not AI-agent prompt compliance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const archive=path.resolve(process.argv[2] || 'angine-0.1.0.tgz');
if(!fs.existsSync(archive)) throw new Error('Package archive missing. Run npm pack first.');
if(process.platform==='win32') throw new Error('This release smoke check currently supports macOS and Linux.');
const home=fs.mkdtempSync(path.join(os.tmpdir(),'angine-package-check-'));
const prefix=path.join(home,'install'),data=path.join(home,'data'),fakeBin=path.join(home,'commands');
const clients=[];
const env={...process.env,ANGINE_HOME:data,CODEX_HOME:path.join(home,'codex'),CLAUDE_CONFIG_DIR:path.join(home,'claude')};
delete env.CODEX_THREAD_ID;delete env.CODEX_SESSION_ID;
let installed;
try {
  const installArgs=['install','--global','--prefix',prefix,'--no-audit','--no-fund','--logs-dir',path.join(home,'logs')];
  if(process.env.ANGINE_RELEASE_CACHE) installArgs.push('--cache',process.env.ANGINE_RELEASE_CACHE);
  if(process.env.ANGINE_RELEASE_OFFLINE==='1') installArgs.push('--offline');
  execFileSync('npm',[...installArgs,archive],{stdio:'pipe',timeout:120000});
  installed=path.join(prefix,'lib','node_modules','angine');
  const cli=path.join(installed,'dist','bin','angine.js');
  const manifest=JSON.parse(fs.readFileSync(path.join(installed,'package.json')));
  assert.equal(manifest.name,'angine');assert.equal(manifest.license,'MIT');
  assert.equal(manifest.repository.url,'git+https://github.com/askinjohn/angine.git');
  assert.equal(fs.existsSync(path.join(installed,'ui','dist','favicon.svg')),true);
  assert.equal(execFileSync(path.join(prefix,'bin','angine'),['--version'],{encoding:'utf8'}).trim(),`Angine ${manifest.version}`);
  assert.deepEqual(Object.keys(manifest.bin),['angine']);
  fs.mkdirSync(fakeBin,{recursive:true});
  for(const agent of ['codex','claude']) {
    const stateFile=path.join(home,`${agent}-integration.json`);
    fs.writeFileSync(path.join(fakeBin,agent),`#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);const file=${JSON.stringify(stateFile)};
if(args[0]==='--version') console.log('release test CLI');
else if(args[1]==='add') {fs.writeFileSync(file,JSON.stringify(args));console.log('configured');}
else if(args[1]==='get') {if(fs.existsSync(file)) console.log(fs.readFileSync(file,'utf8'));else process.exitCode=1;}
else if(args[1]==='remove') {if(fs.existsSync(file)) fs.unlinkSync(file);}
else process.exitCode=1;
`,{mode:0o755});
  }
  // Avoid opening a browser during the isolated setup test.
  for(const opener of ['open','xdg-open']) fs.writeFileSync(path.join(fakeBin,opener),'#!/bin/sh\nexit 0\n',{mode:0o755});
  env.PATH=`${fakeBin}${path.delimiter}${path.join(prefix,'bin')}${path.delimiter}${env.PATH}`;
  fs.mkdirSync(env.CODEX_HOME,{recursive:true});fs.writeFileSync(path.join(env.CODEX_HOME,'config.toml'),'');
  execFileSync(process.execPath,[cli,'setup'],{env,encoding:'utf8',timeout:20000});
  assert.match(fs.readFileSync(path.join(env.CODEX_HOME,'AGENTS.md'),'utf8'),/Angine/);
  assert.match(fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR,'CLAUDE.md'),'utf8'),/Angine/);
  const installedRequire=createRequire(path.join(installed,'package.json'));
  const {Client}=await import(pathToFileURL(installedRequire.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const {StdioClientTransport}=await import(pathToFileURL(installedRequire.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
  const call=async(client,name,args)=>{
    const result=await client.callTool({name,arguments:args});
    assert.notEqual(result.isError,true,`MCP ${name} failed`);
    return JSON.parse(result.content.find(item=>item.type==='text').text);
  };
  const runtime=()=>JSON.parse(fs.readFileSync(path.join(data,'runtime','daemon.json')));
  const base=()=>`http://127.0.0.1:${runtime().port}`;
  const fetchJson=async(url,options)=>{const response=await fetch(url,{...options,signal:AbortSignal.timeout(5000)});assert.equal(response.ok,true);return response.json();};
  const sessionResponse=await fetch(`${base()}/api/dashboard/session`,{signal:AbortSignal.timeout(5000)});
  assert.equal(sessionResponse.ok,true);
  let cookie=sessionResponse.headers.get('set-cookie').split(';')[0];
  const edit=async(operation,input)=>fetchJson(`${base()}/api/dashboard/${operation}`,{method:'POST',headers:{'Content-Type':'application/json','X-Angine-UI':'1',Origin:base(),Cookie:cookie},body:JSON.stringify(input)});
  const profile=await edit('profiles',{key:'release-codex',name:'Release profile',agent:'codex',context:'Other',isDefault:false});
  assert.ok(Object.values(profile.state.profiles).some(p=>p.key==='release-codex'));
  const project={key:'release',name:'Release verification',workspacePath:home};
  const mission={key:'shared',name:'Shared mission'};
  let first,second;
  for(const agent of ['claude','codex']) {
    const client=new Client({name:'angine-release-verifier',version:manifest.version});clients.push(client);
    await client.connect(new StdioClientTransport({command:process.execPath,args:[cli,'mcp','--agent',agent,...(agent==='codex' ? ['--profile','release-codex'] : [])],env}));
    const tools=await client.listTools();assert.deepEqual(tools.tools.map(t=>t.name).sort(),['check_connection','sync_project','update_tasks']);
    const connection=await call(client,'check_connection',{});assert.equal(connection.reporter.agent,agent);
    const result=await call(client,'sync_project',{project,mission,tasks:[{key:agent,title:`Verify ${agent} reporting`,status:'in_progress'}]});
    if(agent==='claude') first=result;else second=result;
    await call(client,'update_tasks',{projectId:result.projectId,missionId:result.missionId,updates:[{taskKey:agent,status:'completed'}]});
  }
  assert.equal(first.projectId,second.projectId);assert.equal(first.missionId,second.missionId);
  const state=await fetchJson(`${base()}/api/state`);
  assert.equal(state.projects[first.projectId].status,'active');assert.equal(state.missions[first.missionId].status,'completed');
  assert.equal(state.tasks[first.taskIds.claude].updatedBy,'claude');assert.equal(state.tasks[second.taskIds.codex].updatedBy,'codex');
  const codexSession=state.sessions[state.tasks[second.taskIds.codex].updatedBySessionId];
  assert.equal(state.profiles[codexSession.profileId].key,'release-codex');
  const health=await fetchJson(`${base()}/api/health`);
  assert.equal(health.reporters.filter(r=>r.successfulReports>=2).length,2);
  await edit('archive',{projectId:first.missionId,archived:true});
  assert.ok((await fetchJson(`${base()}/api/state`)).missions[first.missionId].archivedAt);
  await edit('archive',{projectId:first.missionId,archived:false});
  for(const client of clients) await client.close();clients.length=0;
  const pid=runtime().pid;
  execFileSync(process.execPath,[cli,'restart'],{env,encoding:'utf8',timeout:15000});
  assert.notEqual(runtime().pid,pid);
  assert.equal((await fetchJson(`${base()}/api/state`)).tasks[second.taskIds.codex].status,'completed');
  execFileSync(process.execPath,[cli,'uninstall'],{env,encoding:'utf8',timeout:15000});
  assert.equal(fs.existsSync(path.join(data,'integration.json')),false);
  assert.ok(fs.existsSync(path.join(data,'state','snapshot.json')));
  console.log('Fresh archive install passed: both CLI names, isolated setup, Claude/Codex MCP reporting, profiles, archive/restore, restart, and uninstall. Agent CLIs were simulated.');
} finally {
  for(const client of clients) try {await client.close();}catch {}
  const runtimeFile=path.join(data,'runtime','daemon.json');
  if(fs.existsSync(runtimeFile)) {
    const runtime=JSON.parse(fs.readFileSync(runtimeFile));
    if(Number.isInteger(runtime.pid) && runtime.pid>1 && runtime.pid!==process.pid) try {
      process.kill(runtime.pid,'SIGTERM');
      for(let i=0;i<30;i++){await new Promise(resolve=>setTimeout(resolve,100));try{process.kill(runtime.pid,0);}catch{break;}}
    }catch {}
  }
  fs.rmSync(home,{recursive:true,force:true});
}
