import { httpWriteToken } from '../dist/src/config.js';
import { request } from '../dist/src/ipc.js';

const status = await request('status');
const endpoint = `${status.url}/api/ingest/sync_project`;
const body = JSON.stringify({ agent: 'custom-agent', sessionKey: 'http-smoke', project: {
  key: 'http-smoke', name: 'HTTP smoke test', workspacePath: process.cwd()
}, tasks: [{ key: 'verify', title: 'Verify HTTP reporting', status: 'in_progress' }] });
const unauthorized = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
if (unauthorized.status !== 401) throw new Error(`Expected 401, got ${unauthorized.status}`);
const wrongOrigin = await fetch(endpoint, { method: 'POST', headers: {
  'Content-Type': 'application/json', Authorization: `Bearer ${httpWriteToken()}`, Origin: 'http://example.invalid'
}, body });
if (wrongOrigin.status !== 403) throw new Error(`Expected 403 for wrong Origin, got ${wrongOrigin.status}`);
const authorized = await fetch(endpoint, { method: 'POST', headers: {
  'Content-Type': 'application/json', Authorization: `Bearer ${httpWriteToken()}`
}, body });
if (!authorized.ok) throw new Error(`Expected success, got ${authorized.status}: ${await authorized.text()}`);
const result = await authorized.json();
if (!result.projectId || !result.taskIds.verify) throw new Error('Invalid HTTP result');
const update = await fetch(`${status.url}/api/ingest/update_tasks`, { method: 'POST', headers: {
  'Content-Type': 'application/json', Authorization: `Bearer ${httpWriteToken()}`
}, body: JSON.stringify({ agent: 'custom-agent', sessionKey: 'http-smoke', projectId: result.projectId,
  updates: [{ taskKey: 'verify', status: 'completed' }] }) });
if (!update.ok) throw new Error(`Update failed: ${update.status}`);
const state = await (await fetch(`${status.url}/api/state`)).json();
if (state.tasks[result.taskIds.verify].updatedBy !== 'custom-agent' || state.tasks[result.taskIds.verify].status !== 'completed')
  throw new Error('HTTP update did not persist agent attribution');
console.log('HTTP reporter accepted sync and update, attributed the agent, and rejected anonymous write');
