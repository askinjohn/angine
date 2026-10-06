import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Task, TaskStatus, MissionStatus, Workspace } from './types.js';

export const taskStatuses = new Set<TaskStatus>(['todo', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled']);
export const id = (prefix: string): string => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
export const now = () => new Date().toISOString();
export function agentName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9._-]{0,79}$/i.test(value) || redact(value) !== value) throw new Error('Agent must be 1–80 letters, digits, dots, dashes, or underscores');
  return value.toLowerCase();
}
export const workspaceIdentity = (workspacePath: string): Workspace => {
  const realPath = fs.realpathSync(workspacePath);
  if (!fs.statSync(realPath).isDirectory()) throw new Error('Workspace must be a directory');
  return { id: crypto.createHash('sha256').update(realPath).digest('hex'), path: redact(realPath) };
};
export const redact = (value: string): string => String(value)
  .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g, '[REDACTED]')
  .replace(/\b(?:Bearer\s+|Authorization:\s*)(?:[A-Za-z0-9._~+/-]{16,})/gi, '[REDACTED]')
  .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[opusr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g, '[REDACTED]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]');
export function shortText(value: unknown, max: number, label: string, required: true): string;
export function shortText(value: unknown, max: number, label: string, required?: false): string | undefined;
export function shortText(value: unknown, max: number, label: string, required = false): string | undefined {
  if (value == null || value === '') {
    if (required) throw new Error(`${label} is required`);
    return undefined;
  }
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} must be text of at most ${max} characters`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new Error(`${label} is required`);
  return redact(trimmed);
}
export function deriveStatus(tasks: Task[]): MissionStatus {
  if (!tasks.length) return 'planned';
  if (tasks.some(t => t.status === 'in_progress')) return 'running';
  if (tasks.every(t => t.status === 'completed' || t.status === 'cancelled'))
    return tasks.some(t => t.status === 'completed') ? 'completed' : 'cancelled';
  if (tasks.some(t => t.status === 'todo')) return 'planned';
  if (tasks.some(t => t.status === 'blocked')) return 'blocked';
  if (tasks.some(t => t.status === 'failed')) return 'failed';
  return 'planned';
}
export function taskProgress(value: unknown, status: TaskStatus, previous?: number, previousStatus?: TaskStatus): number | undefined {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100))
    throw new Error('Progress must be a number from 0 to 100');
  if (status === 'completed') return 100;
  if (status === 'todo') return 0;
  return value === undefined ? (previousStatus === 'completed' ? undefined : previous) : value as number;
}

export function blockerDetails(value: unknown, status: TaskStatus, previous?: import('./types.js').Blocker): import('./types.js').Blocker | undefined {
  if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) throw new Error('Invalid blocker details');
  const raw = value as import('./types.js').Blocker | undefined;
  const validated = raw ? { reason: shortText(raw.reason, 500, 'Blocker reason', true), nextStep: shortText(raw.nextStep, 500, 'Next step'), owner: shortText(raw.owner, 160, 'Blocker owner') } : undefined;
  return status === 'blocked' ? (value === undefined ? previous : validated) : undefined;
}
export function relatedKeys(value: unknown, taskKey: string, available: Set<string>, previous?: string[]): string[] | undefined {
  if (value === undefined) return previous;
  if (!Array.isArray(value) || value.length > 20) throw new Error('Related tasks must be a list of at most 20 keys');
  const keys = [...new Set(value.map(key => shortText(key, 160, 'Related task key', true)))];
  if (keys.some(key => key === taskKey || !available.has(key))) throw new Error('Related tasks must exist in the same mission and cannot reference themselves');
  return keys;
}
