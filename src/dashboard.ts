import crypto from 'node:crypto';
import type http from 'node:http';
import type { Store } from './store.js';

export function equalSecret(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied), right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
export function createDashboardRouter(store: Store) {
  const session = crypto.randomBytes(32).toString('hex');
  const respond = (res: http.ServerResponse, body: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  return (req: http.IncomingMessage, res: http.ServerResponse, url: URL): boolean => {
    if (url.pathname === '/api/dashboard/session' && req.method === 'GET') {
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') { respond(res, { error: 'Same-origin request required' }, 403); return true; }
      res.setHeader('Set-Cookie', `angine_dashboard=${session}; HttpOnly; SameSite=Strict; Path=/api/dashboard`);
      respond(res, { ready: true }); return true;
    }
    if (req.method !== 'POST' || !['/api/dashboard/archive', '/api/dashboard/profiles', '/api/dashboard/task-details'].includes(url.pathname)) return false;
    const cookie = (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('angine_dashboard='))?.slice('angine_dashboard='.length) || '';
    if (req.headers.origin !== url.origin || req.headers['x-angine-ui'] !== '1' || !equalSecret(cookie, session)) {
      respond(res, { error: 'Dashboard session required. Reload Angine and try again.' }, 403); return true;
    }
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) { respond(res, { error: 'JSON required' }, 415); return true; }
    let body = '', exceeded = false;
    req.on('data', (chunk: Buffer) => { if (exceeded) return; body += chunk; if (Buffer.byteLength(body) > 65536) { exceeded = true; respond(res, { error: 'Request too large' }, 413); } });
    req.on('end', () => {
      if (exceeded) return;
      try {
        const input = JSON.parse(body);
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid dashboard request');
        if (url.pathname.endsWith('/archive')) store.archiveProject(input.projectId, input.archived);
        if (url.pathname.endsWith('/profiles')) store.saveProfile(input);
        if (url.pathname.endsWith('/task-details')) store.editTaskDetails(input.taskId, input);
        respond(res, { state: store.view() });
      } catch (error) { respond(res, { error: (error as Error).message }, 400); }
    });
    return true;
  };
}
