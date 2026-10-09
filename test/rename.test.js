import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from '../dist/src/setup.js';

for (const failNew of [false,true]) test(`renamed installation ${failNew ? 'restores the old connection on failure' : 'updates only its managed MCP connection'}`,()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'angine-rename-'));
  const saved={PATH:process.env.PATH,ANGINE_HOME:process.env.ANGINE_HOME,CODEX_HOME:process.env.CODEX_HOME};
  const oldBin='/old/installation/dist/bin/angine.js';
  try {
    const commands=path.join(home,'commands'),data=path.join(home,'data'),config=path.join(home,'codex');
    for(const dir of [commands,data,config]) fs.mkdirSync(dir,{recursive:true});
    const fixture=path.join(home,'connection.json');fs.writeFileSync(fixture,JSON.stringify({bin:oldBin,oldBin,failNew}));
    fs.writeFileSync(path.join(commands,'codex'),`#!${process.execPath}
import fs from 'node:fs';
const file=${JSON.stringify(fixture)};
const state=JSON.parse(fs.readFileSync(file,'utf8'));
const args=process.argv.slice(2);
if(args[0]==='--version') console.log('codex test');
else if(args[1]==='get') { if(state.bin) console.log(state.bin);else process.exitCode=1; }
else if(args[1]==='remove') {state.bin=null;fs.writeFileSync(file,JSON.stringify(state));}
else if(args[1]==='add') {
 const bin=args[args.indexOf('--')+2];
 if(state.failNew && bin!==state.oldBin) process.exitCode=1;
 else {state.bin=bin;fs.writeFileSync(file,JSON.stringify(state));}
}
`,{mode:0o755});
    // Extensionless executables use CommonJS unless explicitly given module syntax.
    const executable=path.join(commands,'codex');fs.writeFileSync(executable,fs.readFileSync(executable,'utf8').replace("import fs from 'node:fs';","const fs=require('node:fs');"));
    fs.writeFileSync(path.join(config,'config.toml'),'[mcp_servers.other]\ncommand = "other"\n');
    fs.writeFileSync(path.join(data,'integration.json'),JSON.stringify({integrations:{codex:{bin:oldBin,mcpInstalled:true,instructionsFile:path.join(config,'AGENTS.md')}}}));
    process.env.PATH=`${commands}${path.delimiter}${saved.PATH}`;process.env.ANGINE_HOME=data;process.env.CODEX_HOME=config;
    const currentBin=fileURLToPath(new URL('../dist/bin/angine.js',import.meta.url));
    if(failNew) assert.throws(()=>setup('codex'),/previous connection was restored/);
    else assert.deepEqual(setup('codex').installed,['codex']);
    assert.equal(JSON.parse(fs.readFileSync(fixture)).bin,failNew ? oldBin : currentBin);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data,'integration.json'))).integrations.codex.bin,failNew ? oldBin : currentBin);
    const contents=fs.readFileSync(path.join(config,'config.toml'),'utf8');
    assert.match(contents,/mcp_servers.other/);
    if(!failNew) {assert.match(contents,/mcp_servers.angine.tools.sync_project/);assert.match(fs.readFileSync(path.join(config,'AGENTS.md'),'utf8'),/Angine/);}
  } finally {
    for(const [key,value] of Object.entries(saved)) if(value===undefined) delete process.env[key];else process.env[key]=value;
    fs.rmSync(home,{recursive:true,force:true});
  }
});
