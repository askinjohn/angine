import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadNotificationPreferences, notificationCommand, saveNotificationPreferences } from '../dist/src/notifications.js';

test('notification rules persist in the private Angine data directory', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'angine-notifications-'));
  const prior = process.env.ANGINE_HOME; process.env.ANGINE_HOME = home;
  try {
    assert.deepEqual(loadNotificationPreferences(), { enabled: false, completed: true, attention: true, agent: 'all' });
    const saved = saveNotificationPreferences({ enabled: true, completed: true, attention: false, agent: 'claude' });
    assert.deepEqual(loadNotificationPreferences(), saved);
    if (process.platform !== 'win32') assert.equal((fs.statSync(path.join(home, 'notifications.json')).mode & 0o777), 0o600);
    assert.throws(() => saveNotificationPreferences({ enabled: true, completed: true, attention: true, agent: 'claude; rm -rf' }), /Invalid notification settings/);
  } finally {
    if (prior === undefined) delete process.env.ANGINE_HOME; else process.env.ANGINE_HOME = prior;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('native alert commands use fixed executables with argument arrays', () => {
  assert.deepEqual(notificationCommand('darwin', 'Angine', 'task "done"'), {
    command: 'osascript', args: ['-e', 'display notification "task \\"done\\"" with title "Angine"']
  });
  assert.deepEqual(notificationCommand('linux', 'Angine', 'Task completed'), { command: 'notify-send', args: ['Angine', 'Task completed'] });
  assert.throws(() => notificationCommand('win32', 'Angine', 'Task completed'), /macOS and Linux/);
});
