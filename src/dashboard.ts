import crypto from 'node:crypto';
import type http from 'node:http';
import type { Store } from './store.js';
import { loadNotificationPreferences, saveNotificationPreferences, type NotificationPreferences } from './notifications.js';

export function equalSecret(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied), right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
export function createDashboardRouter(store: Store, actions: {
  notify?: (title: string, body: string) => Promise<void>;
  getNotifications?: () => NotificationPreferences;
  setNotifications?: (value: unknown) => NotificationPreferences;
} = {}) {
  const session = crypto.randomBytes(32).toString('hex');
  const getNotifications = actions.getNotifications || loadNotificationPreferences;
  const setNotifications = actions.setNotifications || saveNotificationPreferences;
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
    if (url.pathname === '/api/dashboard/preferences' && req.method === 'GET') {
      if ((req.headers.origin && req.headers.origin !== url.origin) || req.headers['x-angine-ui'] !== '1') { respond(res, { error: 'Dashboard session required. Reload Angine and try again.' }, 403); return true; }
      const cookie = (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('angine_dashboard='))?.slice('angine_dashboard='.length) || '';
      if (!equalSecret(cookie, session)) { respond(res, { error: 'Dashboard session required. Reload Angine and try again.' }, 403); return true; }
      respond(res, { preferences: getNotifications(), systemNotificationsSupported: process.platform === 'darwin' || process.platform === 'linux' }); return true;
    }
    const endpoints = ['/api/dashboard/archive', '/api/dashboard/profiles', '/api/dashboard/task-details', '/api/dashboard/color', '/api/dashboard/preferences', '/api/dashboard/notification-test'];
    if (req.method !== 'POST' || !endpoints.includes(url.pathname)) return false;
    const cookie = (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('angine_dashboard='))?.slice('angine_dashboard='.length) || '';
    if (req.headers.origin !== url.origin || req.headers['x-angine-ui'] !== '1' || !equalSecret(cookie, session)) {
      respond(res, { error: 'Dashboard session required. Reload Angine and try again.' }, 403); return true;
    }
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) { respond(res, { error: 'JSON required' }, 415); return true; }
    let body = '', exceeded = false;
    req.on('data', (chunk: Buffer) => { if (exceeded) return; body += chunk; if (Buffer.byteLength(body) > 65536) { exceeded = true; respond(res, { error: 'Request too large' }, 413); } });
    req.on('end', async () => {
      if (exceeded) return;
      try {
        const input = JSON.parse(body);
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid dashboard request');
        if (url.pathname.endsWith('/color')) store.setColor(input);
        if (url.pathname.endsWith('/archive')) store.archiveProject(input.projectId, input.archived);
        if (url.pathname.endsWith('/profiles')) store.saveProfile(input);
        if (url.pathname.endsWith('/task-details')) store.editTaskDetails(input.taskId, input);
        if (url.pathname.endsWith('/preferences')) setNotifications(input);
        if (url.pathname.endsWith('/notification-test')) {
          const notify = actions.notify;
          if (!notify) throw new Error('System notifications are unavailable.');
          await notify('Angine notification test', 'System alerts are connected to this computer.');
        }
        respond(res, { state: store.view() });
      } catch (error) { respond(res, { error: (error as Error).message }, 400); }
    });
    return true;
  };
}
