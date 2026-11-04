import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dataDir } from './paths.js';
import type { NotificationRules } from './workflow.js';

export type NotificationPreferences = NotificationRules & {
  enabled: boolean;
  completed: boolean;
  attention: boolean;
  agent: string;
};

const preferencesPath = () => path.join(dataDir(), 'notifications.json');
export const defaultNotificationPreferences = (): NotificationPreferences => ({
  enabled: false, completed: true, attention: true, agent: 'all'
});

export function loadNotificationPreferences(): NotificationPreferences {
  try {
    const value = JSON.parse(fs.readFileSync(preferencesPath(), 'utf8')) as Partial<NotificationPreferences>;
    return {
      enabled: value.enabled === true,
      completed: value.completed !== false,
      attention: value.attention !== false,
      agent: typeof value.agent === 'string' && value.agent.length <= 80 ? value.agent : 'all'
    };
  } catch { return defaultNotificationPreferences(); }
}

export function saveNotificationPreferences(value: unknown): NotificationPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid notification settings');
  const input = value as Partial<NotificationPreferences>;
  if (typeof input.enabled !== 'boolean' || typeof input.completed !== 'boolean' || typeof input.attention !== 'boolean' ||
      typeof input.agent !== 'string' || input.agent.length > 80 || !/^[\w .-]*$/.test(input.agent)) throw new Error('Invalid notification settings');
  const preferences = { enabled: input.enabled, completed: input.completed, attention: input.attention, agent: input.agent || 'all' };
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const file = preferencesPath(), temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(preferences)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return preferences;
}

export function notificationCommand(platform: NodeJS.Platform, title: string, body: string): { command: string; args: string[] } {
  const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
  const safeTitle = clean(title), safeBody = clean(body);
  if (platform === 'darwin') {
    const appleString = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return { command: 'osascript', args: ['-e', `display notification "${appleString(safeBody)}" with title "${appleString(safeTitle)}"`] };
  }
  if (platform === 'linux') return { command: 'notify-send', args: [safeTitle, safeBody] };
  throw new Error('System notifications are currently supported on macOS and Linux.');
}

export function sendSystemNotification(title: string, body: string): Promise<void> {
  const { command, args } = notificationCommand(process.platform, title, body);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
