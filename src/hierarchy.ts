import type { AgentSession, Mission, Project, State, Task, Workspace } from './types.js';
import { defaultProfiles } from './workflow.js';

export const projectIdForWorkspace = (id: string): string => `prj_${id}`;
export const workspaceName = (workspace?: Workspace): string => workspace?.path.split(/[\\/]/).filter(Boolean).pop() || 'Project';
export function projectFromMission(mission: Mission, workspace?: Workspace, previous?: Project): Project {
  return JSON.parse(JSON.stringify({ id:mission.projectId,key:previous?.key || workspaceName(workspace),workspaceId:mission.workspaceId,
    name:previous?.name || workspaceName(workspace),description:previous?.description,status:'active',
    createdAt:previous && previous.createdAt < mission.createdAt ? previous.createdAt : mission.createdAt,
    updatedAt:previous && previous.updatedAt > mission.updatedAt ? previous.updatedAt : mission.updatedAt,
    archivedAt:previous?.archivedAt })) as Project;
}
/** Convert a legacy snapshot or dashboard response without rewriting IDs or history. */
export function normalizeHierarchy(input: State | Record<string, any>): State {
  if(input.schemaVersion !== undefined && input.schemaVersion !== 1 && input.schemaVersion !== 2) throw new Error('Unsupported Angine state version');
  if(input.schemaVersion === 2) return {...input,missions:input.missions || {},profiles:input.profiles || defaultProfiles()} as State;
  const missions: Record<string,Mission> = {},projects: Record<string,Project> = {};
  const workspaces = input.workspaces || {};
  for(const old of Object.values(input.projects || {}) as Array<Omit<Mission,'projectId'>>) {
    const mission:Mission = {...old,projectId:projectIdForWorkspace(old.workspaceId)};
    missions[mission.id] = mission;
    projects[mission.projectId] = projectFromMission(mission,workspaces[mission.workspaceId],projects[mission.projectId]);
  }
  const tasks:Record<string,Task> = {};
  for(const old of Object.values(input.tasks || {}) as Task[]) {
    const mission = missions[old.projectId];
    tasks[old.id] = {...old,missionId:old.missionId || old.projectId,projectId:mission?.projectId || old.projectId};
  }
  const sessions:Record<string,AgentSession> = {};
  for(const old of Object.values(input.sessions || {}) as AgentSession[]) {
    const missionIds = old.missionIds || old.projectIds || [old.projectId];
    sessions[old.id] = {...old,missionId:old.missionId || old.projectId,missionIds,
      projectId:missions[old.projectId]?.projectId || old.projectId,
      projectIds:[...new Set(missionIds.map(id=>missions[id]?.projectId || id))]};
  }
  return {schemaVersion:2,seq:input.seq || 0,workspaces,projects,missions,tasks,sessions,profiles:input.profiles || defaultProfiles()};
}
export function isArchivedTask(state:State,task:Task):boolean {
  return Boolean(state.projects[task.projectId]?.archivedAt || state.missions?.[task.missionId]?.archivedAt);
}
