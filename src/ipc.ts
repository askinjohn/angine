import net from 'node:net';
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runtimePath, socketPath } from './paths.js';
import type { DaemonStatus } from './types.js';

const bin = fileURLToPath(new URL('../bin/beacon.js', import.meta.url));
export function isBeaconDaemonCommand(command: string, binPath: string): boolean {
  const suffix = ` ${binPath} daemon`;
  const trimmed = command.trim();
  if (!trimmed.endsWith(suffix)) return false;
  const executable = trimmed.slice(0, -suffix.length);
  return /(^|[/\\])node(?:\.exe)?$/.test(executable);
}
export async function restartDaemon(): Promise<DaemonStatus> {
  let status: DaemonStatus;
  try { status = await request<DaemonStatus>('status'); }
  catch (error) {
    if (['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code || '')) return ensureDaemon();
    throw error;
  }
  const runtime = JSON.parse(fs.readFileSync(runtimePath(), 'utf8')) as { pid: number; port: number };
  if (!Number.isInteger(runtime.pid) || runtime.pid <= 1 || runtime.pid === process.pid || status.url !== `http://127.0.0.1:${runtime.port}`) throw new Error('Could not verify the running Angine daemon');
  if (status.pid !== undefined) {
    if (status.pid !== runtime.pid) throw new Error('Angine process identity changed; try again');
  } else {
    // Older daemons do not return their PID. Verify the process before stopping it.
    if (process.platform === 'win32') throw new Error('Close the older Angine daemon, then run angine again');
    const command = execFileSync('ps', ['-p', String(runtime.pid), '-o', 'command='], { encoding: 'utf8' });
    if (!isBeaconDaemonCommand(command, bin)) throw new Error('The recorded process is not this Angine daemon');
  }
  process.kill(runtime.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try { process.kill(runtime.pid, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return ensureDaemon();
      throw error;
    }
  }
  throw new Error('Angine is still shutting down. Wait a moment, then run angine again.');
}
export function request<T = unknown>(method: string, params: Record<string, unknown> = {}, timeout = 1500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const socket = net.createConnection(socketPath());
    let buffer = '';
    let settled = false;
    const timer = setTimeout(() => socket.destroy(new Error('Angine daemon timed out')), timeout);
    socket.on('connect', () => socket.write(JSON.stringify({ method, params }) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end >= 0) {
        settled = true;
        clearTimeout(timer);
        socket.end();
        try {
          const result = JSON.parse(buffer.slice(0, end));
          result.ok ? resolve(result.value as T) : reject(new Error(result.error));
        } catch (error) { reject(error); }
      }
    });
    socket.on('error', error => { clearTimeout(timer); reject(error); });
    socket.on('close', () => { clearTimeout(timer); if (!settled) reject(new Error('Angine daemon closed the connection')); });
  });
}
export async function ensureDaemon(): Promise<DaemonStatus> {
  try { return await request<DaemonStatus>('status'); }
  catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
  }
  const child = spawn(process.execPath, [bin, 'daemon'], { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try { return await request<DaemonStatus>('status'); } catch { /* retry briefly */ }
  }
  throw new Error('Angine daemon is unavailable');
}
