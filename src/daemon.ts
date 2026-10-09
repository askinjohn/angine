import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { ReporterRegistry, protocolVersion, serverVersion } from './health.js';
import { createDashboardRouter, equalSecret } from './dashboard.js';
import { dataDir, runtimePath, socketPath } from './paths.js';
import { httpWriteToken } from './config.js';
import type { SyncProjectInput, UpdateTasksInput } from './types.js';

const uiDir = path.resolve(fileURLToPath(new URL('../../ui/dist/', import.meta.url)));
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store'
};
const json = (res: http.ServerResponse, value: unknown, status = 200): void => { res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };

export async function startDaemon(): Promise<void> {
  fs.mkdirSync(path.join(dataDir(), 'runtime'), { recursive: true, mode: 0o700 });
  const store = new Store();
  store.load();
  const reporters = new ReporterRegistry(() => store.state.profiles, () => Date.now(), reporterId =>
    Object.values(store.state.sessions).filter(s => s.reporterId === reporterId).map(s => s.lastSeenAt).sort().at(-1));
  const writeToken = httpWriteToken();
  const dashboard = createDashboardRouter(store);
  let port = Number(process.env.ANGINE_PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid ANGINE_PORT');
  const clients = new Set<http.ServerResponse>();
  const httpServer = http.createServer((req, res) => {
    const host = req.headers.host || '';
    if (!/^((127\.0\.0\.1)|(localhost))(:(\d{1,5}))?$/.test(host)) return json(res, { error: 'Invalid host' }, 403);
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) return json(res, { error: 'Invalid origin' }, 403);
    let url;
    try { url = new URL(req.url || '/', `http://${host}`); } catch { return json(res, { error: 'Invalid URL' }, 400); }
    if (dashboard(req, res, url)) return;
    if (req.method === 'POST' && (url.pathname === '/api/ingest/sync_project' || url.pathname === '/api/ingest/update_tasks')) {
      const header = req.headers.authorization || '';
      const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
      const valid = equalSecret(supplied, writeToken);
      if (!valid) return json(res, { error: 'Unauthorized' }, 401);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, { error: 'JSON required' }, 415);
      let body = '', exceeded = false;
      req.on('data', (chunk: Buffer) => {
        body += chunk;
        if (body.length > 1_000_000) { exceeded = true; req.destroy(); }
      });
      req.on('end', () => {
        if (exceeded) return;
        try {
          const input = JSON.parse(body) as SyncProjectInput | UpdateTasksInput;
          const value = url.pathname.endsWith('sync_project') ? store.syncProject(input as SyncProjectInput) : store.updateTasks(input as UpdateTasksInput);
          json(res, value);
        } catch (error) { json(res, { error: (error as Error).message }, 400); }
      });
      return;
    }
    if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);
    if (url.pathname === '/api/health') return json(res, reporters.view());
    if (url.pathname === '/api/state') return json(res, store.view());
    if (url.pathname.startsWith('/api/missions/') && url.pathname.endsWith('/events')) {
      const missionId = url.pathname.split('/')[3];
      if(!store.state.missions[missionId]) return json(res,{error:'Mission not found'},404);
      return json(res,store.missionEvents(missionId));
    }
    if (url.pathname.startsWith('/api/projects/') && url.pathname.endsWith('/events')) {
      const projectId = url.pathname.split('/')[3];
      if (!store.state.projects[projectId] && !store.state.missions[projectId]) return json(res, { error: 'Project not found' }, 404);
      return json(res, store.projectEvents(projectId));
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify(store.view())}\n\n`);
      res.write(`event: health\ndata: ${JSON.stringify(reporters.view())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const full = path.resolve(uiDir, relative);
    if (!full.startsWith(uiDir + path.sep) && full !== path.join(uiDir, 'index.html')) return json(res, { error: 'Not found' }, 404);
    let content;
    try { content = fs.readFileSync(full); } catch { return json(res, { error: 'Dashboard not built. Run npm run build.' }, 404); }
    res.writeHead(200, { ...securityHeaders, 'Content-Type': mime[path.extname(full)] || 'application/octet-stream' });
    res.end(content);
  });
  store.listeners.add((_events, state) => {
    const message = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const client of clients) client.write(message);
  });
  const healthUpdate = () => { for (const client of clients) client.write(`event: health\ndata: ${JSON.stringify(reporters.view())}\n\n`); };
  const keepalive = setInterval(healthUpdate, 25000);
  const desired = port;
  while (true) {
    try { await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, '127.0.0.1', () => { httpServer.off('error', reject); resolve(); });
    }); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port >= desired + 20) throw error; port++; }
  }
  const sock = socketPath();
  if (process.platform !== 'win32' && fs.existsSync(sock)) {
    try { await new Promise<void>((resolve, reject) => { const probe = net.createConnection(sock); probe.once('connect', () => { probe.destroy(); reject(new Error('Daemon already running')); }); probe.once('error', () => resolve()); }); }
    catch (error) { httpServer.close(); throw error; }
    fs.unlinkSync(sock);
  }
  const ipc = net.createServer(socket => {
    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk;
      if (buffer.length > 1_000_000) return socket.destroy();
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      try {
        const { method, params } = JSON.parse(buffer.slice(0, end)) as { method: string; params: unknown };
        let value: unknown;
        if (method === 'status') value = { serverVersion, protocolVersion, pid: process.pid, daemon: 'running', url: `http://127.0.0.1:${port}`, projects: Object.keys(store.state.projects).length, missions:Object.keys(store.state.missions).length, running: Object.values(store.state.missions).filter(p => p.status === 'running' && !p.archivedAt && !store.state.projects[p.projectId]?.archivedAt).length };
        else if (method === 'reporter_ping') { value = reporters.ping(params as Record<string, unknown>); healthUpdate(); }
        else if (method === 'reporter_close') { reporters.close((params as Record<string, unknown>)?.reporterId); value = {closed:true}; healthUpdate(); }
        else if (method === 'reporter_health') value = reporters.view();
        else if (method === 'sync_project') { try { value = store.syncProject(params as SyncProjectInput); reporters.report((params as SyncProjectInput)?.reporterId,true); } catch(error) { reporters.report((params as SyncProjectInput)?.reporterId,false); throw error; } finally {healthUpdate();} }
        else if (method === 'update_tasks') { try { value = store.updateTasks(params as UpdateTasksInput); reporters.report((params as UpdateTasksInput)?.reporterId,true); } catch(error) { reporters.report((params as UpdateTasksInput)?.reporterId,false); throw error; } finally {healthUpdate();} }
        else throw new Error('Unknown method');
        socket.end(JSON.stringify({ ok: true, value }) + '\n');
      } catch (error) { socket.end(JSON.stringify({ ok: false, error: (error as Error).message }) + '\n'); }
    });
  });
  await new Promise<void>((resolve, reject) => { ipc.once('error', reject); ipc.listen(sock, () => { ipc.off('error', reject); resolve(); }); });
  if (process.platform !== 'win32') fs.chmodSync(sock, 0o600);
  fs.writeFileSync(runtimePath(), JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }), { mode: 0o600 });
  const stop = () => { clearInterval(keepalive); store.snapshot(); for(const client of clients) client.end(); clients.clear(); ipc.close(); httpServer.close(); if (process.platform !== 'win32') try { fs.unlinkSync(sock); } catch {} try { fs.unlinkSync(runtimePath()); } catch {} };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
