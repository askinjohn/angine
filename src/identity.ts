import { shortText } from './model.js';

// Only explicit runtime identity fields are read; credentials are never inspected.
export function nativeReporterIdentity(agent: string, env: NodeJS.ProcessEnv = process.env): { sourceSessionId?: string } {
  if (agent !== 'codex') return {};
  const candidate = env.CODEX_THREAD_ID || env.CODEX_SESSION_ID;
  if (!candidate || candidate.length > 160) return {};
  const sourceSessionId = shortText(candidate, 160, 'Source session ID');
  return sourceSessionId && sourceSessionId === candidate ? { sourceSessionId } : {};
}
