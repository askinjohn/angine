import fs from 'node:fs';
import path from 'node:path';
import { eventsDir, snapshotPath } from './paths.js';
import { agentName, blockerDetails, relatedKeys, deriveStatus, id, now, shortText, taskProgress, taskStatuses, workspaceIdentity } from './model.js';
import { defaultProfiles } from './workflow.js';
import { normalizeHierarchy, projectFromMission, projectIdForWorkspace, workspaceName } from './hierarchy.js';
import type { AgentProfile, AgentSession, Blocker, Change, Event, Mission, Project, State, SyncProjectInput, SyncProjectResult, Task, UpdateTasksInput, UpdateTasksResult, Workspace } from './types.js';

const emptyState = (): State => ({ schemaVersion:2, seq: 0, workspaces: {}, projects: {}, missions:{}, tasks: {}, sessions: {}, profiles: defaultProfiles() });
const clone = <T>(value: T): T => structuredClone(value);
export function reduce(state: State, event: Event): State {
  const next = clone(state);
  next.seq = event.seq;
  const { type, payload } = event;
  if (type === 'workspace.upserted') {
    const workspace = payload as Workspace; next.workspaces[workspace.id] = workspace;
    const root = next.projects[projectIdForWorkspace(workspace.id)];
    if(root?.name === 'Project') next.projects[root.id] = {...root,name:workspaceName(workspace),key:workspaceName(workspace)};
  }
  if (type.startsWith('mission.') || type.startsWith('project.') && (payload as Project).status !== 'active') {
    const old = payload as Mission;
    const mission:Mission = {...old,projectId: type.startsWith('mission.') ? old.projectId : projectIdForWorkspace(old.workspaceId)};
    next.missions[mission.id] = mission;
    next.projects[mission.projectId] = projectFromMission(mission,next.workspaces[mission.workspaceId],next.projects[mission.projectId]);
  } else if(type.startsWith('project.')) next.projects[payload.id] = payload as Project;
  if (type === 'task.removed') delete next.tasks[payload.id];
  else if(type.startsWith('task.')) {
    const old = payload as Task;
    next.tasks[old.id] = old.missionId ? old : {...old,missionId:old.projectId,projectId:next.missions[old.projectId]?.projectId || old.projectId};
  }
  next.profiles ||= defaultProfiles();
  if (type === 'profile.updated') next.profiles[payload.id] = payload as AgentProfile;
  if (type.startsWith('session.')) {
    const old = payload as AgentSession;
    const missionIds = old.missionIds || old.projectIds || [old.projectId];
    next.sessions[old.id] = old.missionId ? old : {...old,missionId:old.projectId,missionIds,
      projectId:next.missions[old.projectId]?.projectId || old.projectId,
      projectIds:[...new Set(missionIds.map(id => next.missions[id]?.projectId || id))]};
  }
  return next;
}
const monthFile = (date: string): string => path.join(eventsDir(), `${date.slice(0, 7)}.ndjson`);
function writeAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}

export class Store {
  state: State = emptyState();
  listeners = new Set<(events: Event[], state: State) => void>();
  sinceSnapshot = 0;
  load(): State {
    fs.mkdirSync(eventsDir(), { recursive: true, mode: 0o700 });
    try {
      const raw = JSON.parse(fs.readFileSync(snapshotPath(), 'utf8'));
      if(raw.schemaVersion !== 2 && !fs.existsSync(`${snapshotPath()}.before-missions`)) fs.copyFileSync(snapshotPath(),`${snapshotPath()}.before-missions`);
      this.state = normalizeHierarchy(raw);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const files = fs.readdirSync(eventsDir()).filter(f => /^\d{4}-\d{2}\.ndjson$/.test(f)).sort();
    for (const file of files) {
      const full = path.join(eventsDir(), file);
      const raw = fs.readFileSync(full, 'utf8');
      let offset = 0;
      for (const line of raw.split('\n')) {
        if (!line) { offset += 1; continue; }
        let event: Event;
        try { event = JSON.parse(line) as Event; } catch {
          if (offset + line.length !== raw.length) throw new Error(`Corrupt event log: ${file}`);
          writeAtomic(`${full}.corrupt-${Date.now()}`, line);
          fs.truncateSync(full, offset);
          break;
        }
        if (event.seq > this.state.seq) {
          if (event.seq !== this.state.seq + 1) throw new Error(`Event sequence gap in ${file}`);
          this.state = reduce(this.state, event);
        }
        offset += Buffer.byteLength(line) + 1;
      }
    }
    for (const agent of new Set([...Object.values(this.state.sessions).map(s => s.agent || 'external'), ...Object.values(this.state.tasks).map(t => t.updatedBy || 'external')])) {
      if (!Object.values(this.state.profiles).some(p => p.agent === agent)) {
        const profile = this.genericProfile(agent); this.state.profiles[profile.id] = profile;
      }
    }
    return this.state;
  }
  genericProfile(agent: string): AgentProfile {
    agent = agentName(agent);
    const key = `${agent}-default`;
    return { id: `profile_${key}`, key, agent, name: `${agent[0].toUpperCase() + agent.slice(1)} / Other`, context: 'Other', isDefault: true };
  }
  commit(changes: Change[]): void {
    if (!changes.length) return;
    let draft = this.state;
    const events = changes.map(({ type, payload, projectId, missionId, taskId, sessionId }): Event => {
      const event = JSON.parse(JSON.stringify({ seq: draft.seq + 1, type, projectId, missionId, taskId, sessionId, timestamp: now(), payload })) as Event;
      draft = reduce(draft, event);
      return event;
    });
    const file = monthFile(events[0].timestamp);
    const fd = fs.openSync(file, 'a', 0o600);
    try { fs.writeSync(fd, events.map(e => JSON.stringify(e)).join('\n') + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    this.state = draft;
    this.sinceSnapshot += events.length;
    for (const listener of this.listeners) listener(events, this.state);
    if (this.sinceSnapshot >= 100) this.snapshot();
  }
  snapshot(): void { writeAtomic(snapshotPath(), JSON.stringify(this.state)); this.sinceSnapshot = 0; }
  touchSession(input: SyncProjectInput | UpdateTasksInput, workspaceId: string, mission: Mission, changes: Change[]): string {
    const projectId = mission.projectId, missionId = mission.id;
    let agent = input.agent || 'external';
    agent = agentName(agent);
    const agentVersion = shortText(input.agentVersion, 80, 'Agent version');
    const reporterId = shortText(input.reporterId, 160, 'Reporter ID');
    const sessionKey = shortText(input.sessionKey, 160, 'Session key') || 'unknown';
    const sourceSessionId = shortText(input.sourceSessionId, 160, 'Source session ID');
    const agentId = shortText(input.agentId, 160, 'Agent ID');
    const parentAgentId = shortText(input.parentAgentId, 160, 'Parent agent ID');
    const profileKey = shortText(input.profileKey, 160, 'Profile key');
    let profile = Object.values(this.state.profiles).find(p => p.agent === agent && (profileKey ? p.key === profileKey : p.isDefault));
    if (!profileKey && !profile && !Object.values(this.state.profiles).some(p => p.agent === agent)) {
      profile = this.genericProfile(agent); changes.push({ type: 'profile.updated', payload: profile });
    }
    if (profileKey && !profile) throw new Error('Unknown profile for this agent');
    const accountLabel = shortText(input.accountLabel, 160, 'Account label') || profile?.accountLabel;
    if (parentAgentId && !agentId) throw new Error('Agent ID is required with parent agent ID');
    const key = JSON.stringify([agent, sourceSessionId || sessionKey, workspaceId, agentId || 'root', profile?.id || 'unassigned']);
    const reporterKey = JSON.stringify([agent, sessionKey, workspaceId, agentId || 'root', profile?.id || 'unassigned']);
    const legacyKey = `${agent}:${sessionKey}:${workspaceId}`;
    const existing = Object.values(this.state.sessions).find(s => s.key === key || s.key === reporterKey ||
      (sourceSessionId && s.sourceSessionId === sourceSessionId && s.agent === agent && s.workspaceId === workspaceId && (s.agentId || 'root') === (agentId || 'root') && (!s.profileId || s.profileId === profile?.id)) ||
      (!agentId && s.key === legacyKey));
    const session: AgentSession = existing ? { ...existing, key, lastSeenAt: now(), projectId, missionId,
      agentVersion: agentVersion || existing.agentVersion, reporterId: reporterId || existing.reporterId,
      sourceSessionId: sourceSessionId || existing.sourceSessionId,
      agentId: agentId || existing.agentId,
      parentAgentId: parentAgentId || existing.parentAgentId,
      accountLabel: accountLabel || existing.accountLabel, profileId: profile?.id || existing.profileId,
      projectIds: [...new Set([...(existing.projectIds || [existing.projectId]), projectId])],
      missionIds: [...new Set([...(existing.missionIds || [existing.missionId]), missionId])] } : {
      id: id('ses'), key, workspaceId, projectId, missionId, agent, agentVersion, reporterId,
      sourceSessionId, agentId, parentAgentId, accountLabel, profileId: profile?.id, projectIds: [projectId], missionIds:[missionId], startedAt: now(), lastSeenAt: now()
    };
    changes.push({ type: existing ? 'session.updated' : 'session.started', payload: session, projectId, missionId, sessionId: session.id });
    return session.id;
  }
  syncProject(input: SyncProjectInput): SyncProjectResult {
    if (!input || !input.project || !Array.isArray(input.tasks) || input.tasks.length > 100) throw new Error('Invalid project or tasks');
    if (typeof input.project.workspacePath !== 'string') throw new Error('Workspace path is required');
    const workspace = workspaceIdentity(input.project.workspacePath);
    const agent = agentName(input.agent || 'external');
    const plan = input.mission || input.project;
    const name = shortText(plan.name, 160, 'Mission name', true);
    const key = shortText(plan.key, 160, 'Mission key') || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const description = shortText(plan.description, 2048, 'Mission description');
    const rootId = projectIdForWorkspace(workspace.id);
    const oldRoot = this.state.projects[rootId];
    const existing = Object.values(this.state.missions).find(p => p.projectId === rootId && p.key === key);
    const project: Mission = existing ? { ...existing, name, description, updatedAt: now() } : {
      id: id('mis'), key, projectId:rootId, workspaceId: workspace.id, name, description, status: 'planned', createdAt: now(), updatedAt: now()
    };
    const root:Project = {id:rootId,key:input.mission ? shortText(input.project.key,160,'Project key') || oldRoot?.key || workspaceName(workspace) : oldRoot?.key || workspaceName(workspace),
      name:input.mission ? shortText(input.project.name,160,'Project name',true) : oldRoot?.name || workspaceName(workspace),
      description:input.mission ? shortText(input.project.description,2048,'Project description') || oldRoot?.description : oldRoot?.description,
      workspaceId:workspace.id,status:'active',createdAt:oldRoot?.createdAt || now(),updatedAt:now(),archivedAt:oldRoot?.archivedAt};
    const changes: Change[] = [];
    const reporterSessionId = this.touchSession(input, workspace.id, project, changes);
    if (!this.state.workspaces[workspace.id]) changes.unshift({ type: 'workspace.upserted', payload: workspace });
    changes.push({type:oldRoot ? 'project.updated' : 'project.created',payload:root,projectId:root.id});
    const priorTasks = Object.values(this.state.tasks).filter(t => t.missionId === project.id);
    const availableKeys = new Set([...priorTasks.map(t => t.key), ...input.tasks.map(t => t.key)].filter(key => !(input.removedTaskKeys || []).includes(key)));
    const taskIds: Record<string, string> = {};
    const keys = new Set<string>();
    for (const raw of input.tasks) {
      const taskKey = shortText(raw.key, 160, 'Task key', true);
      if (keys.has(taskKey)) throw new Error(`Duplicate task key: ${taskKey}`);
      keys.add(taskKey);
      if (!taskStatuses.has(raw.status)) throw new Error(`Invalid task status: ${raw.status}`);
      const old = priorTasks.find(t => t.key === taskKey);
      const task: Task = {
        id: old?.id || id('task'), projectId: project.projectId, missionId:project.id, key: taskKey,
        title: shortText(raw.title, 240, 'Task title', true),
        description: shortText(raw.description, 2048, 'Task description'),
        parentKey: shortText(raw.parentKey, 160, 'Parent key'), status: raw.status,
        updatedBy: agent, updatedBySessionId: reporterSessionId, progress: taskProgress(raw.progress, raw.status, old?.progress, old?.status),
        blocker: blockerDetails(raw.blocker, raw.status, old?.blocker), relatedTaskKeys: relatedKeys(raw.relatedTaskKeys, taskKey, availableKeys, old?.relatedTaskKeys),
        note: old?.note, createdAt: old?.createdAt || now(), updatedAt: now(),
        startedAt: old?.startedAt || (raw.status === 'in_progress' ? now() : undefined),
        completedAt: raw.status === 'completed' ? (old?.completedAt || now()) : undefined
      };
      taskIds[taskKey] = task.id;
      if (!old || JSON.stringify({ ...old, updatedAt: null }) !== JSON.stringify({ ...task, updatedAt: null }))
        changes.push({ type: old ? (old.status !== task.status ? 'task.status_changed' : 'task.updated') : 'task.created', payload: task, projectId: project.projectId, missionId:project.id, taskId: task.id });
    }
    for (const raw of input.tasks) if (raw.parentKey && !availableKeys.has(raw.parentKey)) throw new Error(`Unknown parent key: ${raw.parentKey}`);
    const removed = input.removedTaskKeys || [];
    if (!Array.isArray(removed) || removed.some(taskKey => typeof taskKey !== 'string' || keys.has(taskKey))) throw new Error('Invalid removedTaskKeys');
    for (const taskKey of removed) {
      const old = priorTasks.find(t => t.key === taskKey);
      if (old) changes.push({ type: 'task.removed', payload: old, projectId: project.projectId, missionId:project.id, taskId: old.id });
    }
    const effectiveTasks: Task[] = [...priorTasks.filter(t => !keys.has(t.key) && !removed.includes(t.key)),
      ...input.tasks.map(raw => (changes.find(c => c.taskId && (c.payload as Task).key === raw.key)?.payload as Task | undefined) || priorTasks.find(t => t.key === raw.key)!)];
    project.status = deriveStatus(effectiveTasks);
    if (project.status === 'completed' && existing?.status !== 'completed') project.completedAt = now();
    else if (project.status !== 'completed') project.completedAt = undefined;
    changes.push({ type: existing ? 'mission.updated' : 'mission.created', payload: project, projectId: project.projectId, missionId:project.id });
    this.commit(changes);
    return { projectId: input.mission ? root.id : project.id, missionId:project.id, rootProjectId:root.id, taskIds };
  }
  updateTasks(input: UpdateTasksInput): UpdateTasksResult {
    const project = this.resolveMission(input);
    const agent = agentName(input?.agent || 'external');
    if (!project || !Array.isArray(input.updates) || !input.updates.length || input.updates.length > 100) throw new Error('Invalid project or updates');
    const changes: Change[] = [];
    const reporterSessionId = this.touchSession(input, project.workspaceId, project, changes);
    const priorTasks = Object.values(this.state.tasks).filter(t => t.missionId === project.id);
    const updatedKeys = new Set<string>();
    for (const update of input.updates) {
      if (updatedKeys.has(update.taskKey)) throw new Error(`Duplicate task update: ${update.taskKey}`);
      updatedKeys.add(update.taskKey);
      const old = priorTasks.find(t => t.key === update.taskKey);
      if (!old) throw new Error(`Unknown task: ${update.taskKey}`);
      if (!taskStatuses.has(update.status)) throw new Error(`Invalid status: ${update.status}`);
      const note = shortText(update.note, 500, 'Status note');
      const progress = taskProgress(update.progress, update.status, old.progress, old.status);
      const blocker = blockerDetails(update.blocker, update.status, old.blocker);
      const relatedTaskKeys = relatedKeys(update.relatedTaskKeys, old.key, new Set(priorTasks.map(t => t.key)), old.relatedTaskKeys);
      if (old.status === update.status && old.note === note && old.progress === progress && JSON.stringify(old.blocker) === JSON.stringify(blocker) && JSON.stringify(old.relatedTaskKeys) === JSON.stringify(relatedTaskKeys) && old.updatedBy === agent && old.updatedBySessionId === reporterSessionId) continue;
      const task: Task = { ...old, status: update.status, note, progress, blocker, relatedTaskKeys, updatedBy: agent, updatedBySessionId: reporterSessionId, updatedAt: now(),
        startedAt: old.startedAt || (update.status === 'in_progress' ? now() : undefined),
        completedAt: update.status === 'completed' ? (old.completedAt || now()) : undefined };
      changes.push({ type: old.status === task.status ? 'task.updated' : 'task.status_changed', payload: task, projectId: project.projectId, missionId:project.id, taskId: task.id });
    }
    if (changes.length) {
      const tasks = priorTasks.map(t => (changes.find(c => c.taskId === t.id)?.payload as Task | undefined) || t);
      const status = deriveStatus(tasks);
      const nextProject: Mission = { ...project, status, updatedAt: now(), completedAt: status === 'completed' ? (project.completedAt || now()) : undefined };
      changes.push({ type: status === 'completed' && project.status !== 'completed' ? 'mission.completed' : 'mission.updated', payload: nextProject, projectId: project.projectId, missionId:project.id });
      this.commit(changes);
    }
    return { projectId:!input.missionId && input.projectId === project.id ? project.id : project.projectId, missionId: project.id, updated: changes.filter(c => c.type.startsWith('task.')).length };
  }
  resolveMission(input:UpdateTasksInput): Mission | undefined {
    if(input?.missionId) {
      const mission = this.state.missions[input.missionId];
      if(mission && input.projectId && ![mission.id,mission.projectId].includes(input.projectId)) throw new Error('Mission does not belong to this project');
      return mission;
    }
    if(input?.projectId && this.state.missions[input.projectId]) return this.state.missions[input.projectId];
    if(!input?.projectId || !Array.isArray(input.updates)) return undefined;
    const candidates = Object.values(this.state.missions).filter(m => m.projectId === input.projectId && input.updates.every(u => Object.values(this.state.tasks).some(t => t.missionId === m.id && t.key === u.taskKey)));
    if(candidates.length > 1) throw new Error('Task keys exist in multiple missions; provide missionId');
    return candidates[0];
  }
  archiveProject(projectId: string, archived: boolean): Project | Mission {
    const mission = this.state.missions[projectId];
    const project = mission || this.state.projects[projectId];
    if (!project || typeof archived !== 'boolean') throw new Error('Invalid project or archive state');
    const next = { ...project, archivedAt: archived ? (project.archivedAt || now()) : undefined };
    this.commit([{ type: mission ? 'mission.updated' : 'project.updated', projectId: mission?.projectId || projectId, ...(mission ? {missionId:mission.id} : {}), payload: next }]);
    return next;
  }
  saveProfile(input: Partial<AgentProfile>): AgentProfile {
    const old = input.id ? this.state.profiles[input.id] : undefined;
    if (input.id && !old) throw new Error('Profile not found');
    const agent = agentName(input.agent || old?.agent || 'external');
    const key = shortText(input.key || old?.key, 160, 'Profile key', true);
    if (Object.values(this.state.profiles).some(p => p.key === key && p.id !== old?.id)) throw new Error('Profile key already exists');
    if (old && (old.agent !== agent || old.key !== key)) throw new Error('Agent type and profile key are stable; create another profile to change them');
    const ownerEmail = shortText(input.ownerEmail, 160, 'Owner email');
    if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error('Invalid owner email');
    if (input.isDefault !== undefined && typeof input.isDefault !== 'boolean') throw new Error('Invalid default profile flag');
    const profile: AgentProfile = { id: old?.id || id('profile'), key, agent, name: shortText(input.name, 160, 'Profile name', true),
      context: shortText(input.context, 80, 'Profile context', true), isDefault: input.isDefault ?? old?.isDefault ?? false,
      ownerName: shortText(input.ownerName, 160, 'Owner name'), ownerEmail,
      accountLabel: shortText(input.accountLabel, 160, 'Account label'), description: shortText(input.description, 500, 'Profile description') };
    const changes: Change[] = [];
    if (profile.isDefault) for (const other of Object.values(this.state.profiles)) {
      if (other.agent === agent && other.id !== profile.id && other.isDefault) changes.push({ type: 'profile.updated', payload: { ...other, isDefault: false } });
    }
    changes.push({ type: 'profile.updated', payload: profile }); this.commit(changes); return profile;
  }
  editTaskDetails(taskId: string, input: { blocker?: Blocker | null; relatedTaskKeys?: string[] }): Task {
    const task = this.state.tasks[taskId];
    if (!task) throw new Error('Task not found');
    const available = new Set(Object.values(this.state.tasks).filter(t => t.missionId === task.missionId).map(t => t.key));
    const next = { ...task, blocker: blockerDetails(input.blocker, task.status, task.blocker), relatedTaskKeys: relatedKeys(input.relatedTaskKeys, task.key, available, task.relatedTaskKeys) };
    this.commit([{ type: 'task.updated', payload: next, projectId: task.projectId, missionId:task.missionId, taskId }]);
    return next;
  }
  view(): State { return clone(this.state); }
  missionEvents(missionId:string): Event[] {
    const mission = this.state.missions[missionId];
    if(!mission) return [];
    return this.projectEvents(mission.projectId).filter(e => e.missionId === missionId || !e.missionId && e.projectId === missionId);
  }
  projectEvents(projectId: string): Event[] {
    if(this.state.missions[projectId]) return this.missionEvents(projectId);
    const events: Event[] = [];
    for (const file of fs.readdirSync(eventsDir()).filter(f => /^\d{4}-\d{2}\.ndjson$/.test(f)).sort()) {
      for (const line of fs.readFileSync(path.join(eventsDir(), file), 'utf8').split('\n')) {
        if (line) { const event = JSON.parse(line) as Event; if (event.projectId === projectId || event.missionId && this.state.missions[event.missionId]?.projectId === projectId || event.projectId && this.state.missions[event.projectId]?.projectId === projectId) events.push(event); }
      }
    }
    return events;
  }
}
