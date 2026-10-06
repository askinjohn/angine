import http from 'node:http';
import { request } from '../dist/src/ipc.js';

const status = await request('status');
const url = new URL('/api/events', status.url);
let messages = 0;
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Timed out waiting for live update')), 5000);
  const stream = http.get(url, response => {
    if (response.statusCode !== 200) return reject(new Error(`SSE returned ${response.statusCode}`));
    let buffer = '';
    response.on('data', async chunk => {
      buffer += chunk;
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        if (!part.includes('event: state')) continue;
        messages++;
        if (messages === 1) {
          try { await request('sync_project', { project: { key: 'live-smoke', name: 'Live smoke test', workspacePath: process.cwd() }, tasks: [{ key: 'check', title: 'Confirm SSE', status: 'in_progress' }] }); }
          catch (error) { clearTimeout(timer); reject(error); }
        } else {
          const data = part.split('\n').find(line => line.startsWith('data: '));
          const state = JSON.parse(data.slice(6));
          if (!Object.values(state.missions).some(mission => mission.key === 'live-smoke')) return reject(new Error('Live update missing mission'));
          clearTimeout(timer); stream.destroy(); resolve();
        }
      }
    });
  });
  stream.on('error', reject);
});
console.log('SSE delivered project update');
