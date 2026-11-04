import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDashboardRouter, equalSecret } from '../dist/src/dashboard.js';

test('dashboard changes require same-origin browser session and valid JSON', () => {
  const calls = [];
  const store = {
    archiveProject: (...args) => calls.push(['archive', ...args]),
    setColor: input => calls.push(['color', input]),
    saveProfile: input => calls.push(['profile', input]),
    editTaskDetails: (...args) => calls.push(['details', ...args]),
    view: () => ({ seq: calls.length }),
  };
  const router = createDashboardRouter(store);
  const request = (endpoint, method = 'POST', headers = {}, body = '{}') => {
    const req = new EventEmitter(); req.method = method; req.headers = headers;
    const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = JSON.parse(body); } };
    assert.equal(router(req,res,new URL(`http://127.0.0.1:4317/api/dashboard/${endpoint}`)),true);
    req.emit('data',Buffer.from(body)); req.emit('end'); return res;
  };
  assert.equal(request('session','GET',{'sec-fetch-site':'cross-site'}).status,403);
  const session = request('session','GET',{'sec-fetch-site':'same-origin'});
  assert.equal(session.status,200);
  assert.match(session.headers['Set-Cookie'],/HttpOnly; SameSite=Strict/);
  const headers = { origin:'http://127.0.0.1:4317','x-angine-ui':'1','content-type':'application/json',cookie:session.headers['Set-Cookie'].split(';')[0] };
  assert.equal(request('archive','POST',{}).status,403);
  assert.equal(request('archive','POST',{...headers,origin:'https://elsewhere.test'}).status,403);
  assert.equal(request('archive','POST',{...headers,cookie:'angine_dashboard=é'.repeat(64)}).status,403);
  assert.equal(request('archive','POST',{...headers,'content-type':'text/plain'}).status,415);
  assert.equal(request('archive','POST',headers,'{').status,400);
  assert.equal(request('archive','POST',headers,'x'.repeat(65537)).status,413);
  assert.equal(calls.length,0);
  assert.equal(request('archive','POST',headers,JSON.stringify({projectId:'p',archived:true})).status,200);
  assert.equal(request('profiles','POST',headers,JSON.stringify({name:'Work'})).body.state.seq,2);
  assert.equal(request('task-details','POST',headers,JSON.stringify({taskId:'t',relatedTaskKeys:['a']})).status,200);
  assert.deepEqual(calls,[['archive','p',true],['profile',{name:'Work'}],['details','t',{taskId:'t',relatedTaskKeys:['a']}]]);
  assert.equal(request('color','POST',{},JSON.stringify({projectId:'p',color:'#123456'})).status,403);
  assert.equal(request('color','POST',headers,JSON.stringify({projectId:'p',color:'#123456'})).status,200);
  assert.deepEqual(calls.at(-1),['color',{projectId:'p',color:'#123456'}]);
  assert.equal(equalSecret('é','aa'),false);
});

test('dashboard preferences and local actions require the dashboard session', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'angine-dashboard-action-'));
  const home = fs.realpathSync(temporary);
  const calls = [], workspaces = { local: { id: 'local', path: home } };
  let preferences = { enabled: false, completed: true, attention: true, agent: 'all' };
  const store = { state: { workspaces }, view: () => ({ seq: 1 }) };
  const router = createDashboardRouter(store, {
    getNotifications: () => preferences,
    setNotifications: value => preferences = value,
    notify: async (...args) => calls.push(['notify', ...args]),
  });
  const request = (endpoint, method = 'POST', headers = {}, body = '{}') => new Promise(resolve => {
    const req = new EventEmitter(); req.method = method; req.headers = headers;
    const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); }, end(body) { this.body = JSON.parse(body); resolve(this); } };
    assert.equal(router(req,res,new URL(`http://127.0.0.1:4317/api/dashboard/${endpoint}`)),true);
    if (method === 'POST') { req.emit('data',Buffer.from(body)); req.emit('end'); }
  });
  try {
    const session = await request('session','GET',{'sec-fetch-site':'same-origin'});
    const headers = { origin:'http://127.0.0.1:4317','x-angine-ui':'1','content-type':'application/json',cookie:session.headers['Set-Cookie'].split(';')[0] };
    assert.equal((await request('preferences','GET',headers)).body.preferences.enabled,false);
    assert.equal((await request('preferences','POST',headers,JSON.stringify({enabled:true,completed:true,attention:false,agent:'claude'}))).status,200);
    assert.equal(preferences.agent,'claude');
    assert.equal((await request('notification-test','POST',headers)).status,200);
    assert.deepEqual(calls[0],['notify','Angine notification test','System alerts are connected to this computer.']);
  } finally { fs.rmSync(temporary,{recursive:true,force:true}); }
});
