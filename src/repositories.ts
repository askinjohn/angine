import type { State, Workspace } from './types.js';
import { workspaceIdentity } from './model.js';
import { projectIdForWorkspace } from './hierarchy.js';

export const projectIdForRepository = (workspace: Workspace) => workspace.repositoryId
  ? `prj_repo_${workspace.repositoryId}` : projectIdForWorkspace(workspace.id);

/** Called after event replay. Preserve event logs and mission/task/session IDs. */
export function groupRepositoryProjects(state: State): State {
  const next = structuredClone(state);
  for (const workspace of Object.values(next.workspaces)) {
    try { const detected = workspaceIdentity(workspace.path); if (detected.repositoryId) { workspace.repositoryId = detected.repositoryId; workspace.repositoryPath = detected.repositoryPath; workspace.branch = detected.branch; } }
    catch { /* Removed worktrees retain their last known identity. */ }
  }
  const aliases = {...next.projectAliases};
  const originalProjects = state.projects;
  const groups = new Map<string, typeof state.projects[string][]>();
  for (const project of Object.values(originalProjects)) {
    const workspace = next.workspaces[project.workspaceId];
    const id = workspace?.repositoryId ? projectIdForRepository(workspace) : project.id;
    groups.set(id, [...(groups.get(id) || []), project]);
    if (id !== project.id) aliases[project.id] = id;
  }
  next.projects = {};
  for (const [id, projects] of groups) {
    if (projects.length === 1 && projects[0].id === id) { next.projects[id] = projects[0]; continue; }
    projects.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const first = projects.find(p => !p.archivedAt) || projects[0];
    next.projects[id] = {...first,id,createdAt:projects[0].createdAt,
      updatedAt:projects.map(p=>p.updatedAt).sort().at(-1)!,
      archivedAt:projects.every(p=>p.archivedAt) ? first.archivedAt : undefined};
  }
  const canonical = (id: string) => aliases[id] || id;
  for (const mission of Object.values(next.missions)) {
    // An archived source project must not silently expose its missions on merge.
    const old = originalProjects[mission.projectId];
    if (old?.archivedAt && next.projects[canonical(mission.projectId)] && !next.projects[canonical(mission.projectId)].archivedAt)
      mission.archivedAt ||= old.archivedAt;
    mission.projectId = canonical(mission.projectId);
  }
  for (const task of Object.values(next.tasks)) task.projectId = canonical(task.projectId);
  for (const session of Object.values(next.sessions)) {
    session.projectId = canonical(session.projectId);
    if (session.projectIds) session.projectIds = [...new Set(session.projectIds.map(canonical))];
  }
  if (Object.keys(aliases).length) next.projectAliases = aliases;
  return JSON.parse(JSON.stringify(next)) as State;
}
