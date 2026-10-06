import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDashboardRouter, equalSecret } from '../dist/src/dashboard.js';

test('dashboard changes require same-origin browser session and valid JSON', () => {
  const calls = [];
  const store = {
    archiveProject: (...args) => calls.push(['archive', ...args]),
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
  const headers = { origin:'http://127.0.0.1:4317','x-beacon-ui':'1','content-type':'application/json',cookie:session.headers['Set-Cookie'].split(';')[0] };
  assert.equal(request('archive','POST',{}).status,403);
  assert.equal(request('archive','POST',{...headers,origin:'https://elsewhere.test'}).status,403);
  assert.equal(request('archive','POST',{...headers,cookie:'beacon_dashboard=é'.repeat(64)}).status,403);
  assert.equal(request('archive','POST',{...headers,'content-type':'text/plain'}).status,415);
  assert.equal(request('archive','POST',headers,'{').status,400);
  assert.equal(request('archive','POST',headers,'x'.repeat(65537)).status,413);
  assert.equal(calls.length,0);
  assert.equal(request('archive','POST',headers,JSON.stringify({projectId:'p',archived:true})).status,200);
  assert.equal(request('profiles','POST',headers,JSON.stringify({name:'Work'})).body.state.seq,2);
  assert.equal(request('task-details','POST',headers,JSON.stringify({taskId:'t',relatedTaskKeys:['a']})).status,200);
  assert.deepEqual(calls,[['archive','p',true],['profile',{name:'Work'}],['details','t',{taskId:'t',relatedTaskKeys:['a']}]]);
  assert.equal(equalSecret('é','aa'),false);
});
