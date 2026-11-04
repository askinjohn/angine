import type { AgentProfile, Mission, Project, State, Task } from './types.js';

export function defaultProfiles(): Record<string, AgentProfile> {
  return Object.fromEntries([
    ['claude', 'Other'], ['codex', 'Other'], ['antigravity', 'Other'], ['grok', 'Other']
  ].map(([agent, context]) => {
    const key = `${agent}-default`;
    const profile: AgentProfile = { id: `profile_${key}`, key, name: `${agent[0].toUpperCase() + agent.slice(1)} / ${context}`, agent, context, isDefault: true };
    return [profile.id, profile];
  }));
}
export function isStale(item: Pick<Task | Mission | Project, 'status' | 'updatedAt'>, minutes = 60, timestamp = Date.now()): boolean {
  return minutes > 0 && ['running', 'in_progress', 'blocked'].includes(item.status) && timestamp - Date.parse(item.updatedAt) >= minutes * 60000;
}
export interface NotificationRules { completed?: boolean; attention?: boolean; agent?: string }
export function notificationChanges(previous: State | null, next: State, rules: NotificationRules = {}): Task[] {
  if (!previous || next.seq <= previous.seq) return [];
  const statuses = new Set<string>();
  if (rules.completed !== false) statuses.add('completed');
  if (rules.attention !== false) { statuses.add('blocked'); statuses.add('failed'); }
  if (!statuses.size) return [];
  const agent = rules.agent && rules.agent !== 'all' ? rules.agent.toLowerCase() : undefined;
  return Object.values(next.tasks).filter(task => {
    const old = previous.tasks[task.id];
    return old && old.status !== task.status && statuses.has(task.status) && (!agent || task.updatedBy.toLowerCase() === agent) && !next.projects[task.projectId]?.archivedAt && !next.missions?.[task.missionId]?.archivedAt;
  });
}
