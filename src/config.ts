import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths.js';

const file = () => path.join(dataDir(), 'config.json');
export function httpWriteToken(): string {
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(fs.readFileSync(file(), 'utf8')) as Record<string, unknown>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (typeof config.httpWriteToken === 'string' && config.httpWriteToken.length >= 32) return config.httpWriteToken;
  config.httpWriteToken = crypto.randomBytes(32).toString('hex');
  const temp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file());
  return config.httpWriteToken as string;
}
