#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { ensureDaemon, request, restartDaemon } from '../src/ipc.js';
import type { DaemonStatus } from '../src/types.js';
import { serverVersion } from '../src/reporting.js';

const command = process.argv[2] || 'open';
async function openDashboard(): Promise<void> {
  const status = await ensureDaemon();
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', status.url] : [status.url];
  const child = spawn(opener, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
  console.log(status.url);
}
try {
  if (command === '--version' || command === 'version' || command === '-v') console.log(`Angine ${serverVersion}`);
  else if (command === 'mcp') await import('../src/mcp.js');
  else if (command === 'daemon') await (await import('../src/daemon.js')).startDaemon();
  else if (command === 'restart') {
    await restartDaemon();
    console.log('Angine restarted. Project history was kept.');
    await openDashboard();
  }
  else if (command === 'setup') {
    const { setup } = await import('../src/setup.js');
    const result = setup(process.argv[3] || 'all');
    console.log(`Angine ready. Configured: ${result.installed.join(', ')}.${result.skipped.length ? ` Not installed: ${result.skipped.join(', ')}.` : ''}\nRestart your agents to begin reporting. Opening the dashboard…`);
    await openDashboard();
  } else if (command === 'uninstall') {
    const { uninstall } = await import('../src/setup.js');
    const result = uninstall();
    console.log(result.removed.length ? `Removed ${result.removed.join(', ')} integration. Local project history was kept.` : 'No Angine integration found.');
  } else if (command === 'token') {
    const { httpWriteToken } = await import('../src/config.js');
    console.log(httpWriteToken());
  } else if (command === 'report') {
    const method = process.argv[3];
    if (!['sync_project', 'update_tasks'].includes(method)) throw new Error('Use: angine report sync_project|update_tasks --agent <name> < input.json');
    const index = process.argv.indexOf('--agent');
    const { agentName } = await import('../src/model.js');
    const agent = agentName(index >= 0 ? process.argv[index + 1] : 'external');
    let body = '';
    for await (const chunk of process.stdin) {
      body += chunk.toString();
      if (body.length > 1_000_000) throw new Error('Report exceeds 1 MB');
    }
    const input = JSON.parse(body);
    const profileIndex = process.argv.indexOf('--profile');
    const { nativeReporterIdentity } = await import('../src/identity.js');
    await ensureDaemon();
    console.log(JSON.stringify(await request(method, { ...nativeReporterIdentity(agent), ...input, ...(profileIndex >= 0 ? { profileKey: process.argv[profileIndex + 1] } : {}), agent })));
  } else if (command === 'doctor') {
    const { doctor } = await import('../src/setup.js');
    const checks = doctor();
    for (const check of checks) console.log(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
    if (checks.some(c => !c.ok)) process.exitCode = 1;
  } else if (command === 'status') {
    const status = await request<DaemonStatus>('status');
    console.log(`Daemon: ${status.daemon}\nDashboard: ${status.url}\nProjects: ${status.projects}${status.missions !== undefined ? `\nMissions: ${status.missions}` : ''}\nRunning missions: ${status.running}`);
  } else if (command === 'open') {
    await openDashboard();
  } else { console.error('Usage: angine [setup [codex|claude]|open|restart|status|doctor|uninstall|token|report|mcp]'); process.exitCode = 1; }
} catch (error) { console.error(`Angine: ${(error as Error).message}`); process.exitCode = 1; }
