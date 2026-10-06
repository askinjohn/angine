import type { AgentProfile, Mission, Project, State, Task } from './types.js';

export function defaultProfiles(): Record<string, AgentProfile> {
  return Object.fromEntries([
    ['claude', 'Other'], ['codex', 'Other'], ['grok', 'Other']
  ].map(([agent, context]) => {
    const key = `${agent}-default`;
    const profile: AgentProfile = { id: `profile_${key}`, key, name: `${agent[0].toUpperCase() + agent.slice(1)} / ${context}`, agent, context, isDefault: true };
    return [profile.id, profile];
  }));
}
export function isStale(item: Pick<Task | Mission | Project, 'status' | 'updatedAt'>, minutes = 60, timestamp = Date.now()): boolean {
  return minutes > 0 && ['running', 'in_progress', 'blocked'].includes(item.status) && timestamp - Date.parse(item.updatedAt) >= minutes * 60000;
}
export function notificationChanges(previous: State | null, next: State): Task[] {
  if (!previous || next.seq <= previous.seq) return [];
  return Object.values(next.tasks).filter(task => {
    const old = previous.tasks[task.id];
    return old && old.status !== task.status && ['completed', 'blocked'].includes(task.status) && !next.projects[task.projectId]?.archivedAt && !next.missions?.[task.missionId]?.archivedAt;
  });
}
