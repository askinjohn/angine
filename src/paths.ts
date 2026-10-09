import os from 'node:os';
import path from 'node:path';

export const dataDir = () => process.env.ANGINE_HOME || path.join(os.homedir(), '.angine');
export const codexDir = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
export const socketPath = (): string => process.platform === 'win32'
  ? `\\\\.\\pipe\\angine-${process.env.USERNAME || 'user'}`
  : path.join(dataDir(), 'runtime', 'daemon.sock');
export const runtimePath = () => path.join(dataDir(), 'runtime', 'daemon.json');
export const snapshotPath = () => path.join(dataDir(), 'state', 'snapshot.json');
export const eventsDir = () => path.join(dataDir(), 'events');
