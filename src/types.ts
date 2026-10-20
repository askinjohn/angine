export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type MissionStatus = 'planned' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type MissionUpdatePhase = 'request' | 'implementation' | 'deployment' | 'monitoring' | 'blocker';
export type MissionUpdateStatus = 'in_progress' | 'completed' | 'blocked' | 'failed';

export interface WorkUpdate {
  id: string; projectId: string; missionId?: string;
  phase: MissionUpdatePhase; status: MissionUpdateStatus; summary: string;
  nextStep?: string; environment?: 'development' | 'staging' | 'production';
  updatedBy: string; updatedBySessionId?: string; sourceSessionId?: string; reporterId?: string; reportedAt: string;
}

export interface Workspace { id: string; path: string; repositoryId?: string; repositoryPath?: string; branch?: string }
export interface Project {
  color?: string;
  id: string; key: string; workspaceId: string; name: string; description?: string;
  status: 'active'; createdAt: string; updatedAt: string; archivedAt?: string;
  latestUpdate?: WorkUpdate; latestMonitoring?: WorkUpdate;
}
export interface Mission {
  color?: string;
  id: string; key: string; workspaceId: string; name: string; description?: string;
  projectId: string;
  status: MissionStatus; createdAt: string; updatedAt: string; completedAt?: string;
  archivedAt?: string;
  workspaceIds?: string[];
  latestUpdate?: WorkUpdate; latestMonitoring?: WorkUpdate;
}
export interface Blocker { reason: string; nextStep?: string; owner?: string }
export interface AgentProfile {
  id: string; key: string; name: string; agent: string; context: string; isDefault: boolean;
  ownerName?: string; ownerEmail?: string; accountLabel?: string; description?: string;
}
export interface Task {
  id: string; projectId: string; missionId: string; key: string; title: string; description?: string;
  parentKey?: string; status: TaskStatus; note?: string; updatedBy: string;
  updatedBySessionId?: string;
  progress?: number;
  blocker?: Blocker; relatedTaskKeys?: string[];
  createdAt: string; updatedAt: string; startedAt?: string; completedAt?: string;
}
export interface AgentSession {
  id: string; key: string; workspaceId: string; projectId: string; agent: string;
  missionId: string; missionIds?: string[];
  agentVersion?: string; startedAt: string; lastSeenAt: string; endedAt?: string;
  sourceSessionId?: string; agentId?: string; parentAgentId?: string; accountLabel?: string;
  profileId?: string; projectIds?: string[];
  reporterId?: string;
}
export interface ReporterConnection {
  id: string; agent: string; version?: string; profileId?: string; profileKey?: string;
  sourceSessionId?: string; startedAt: string; lastSeenAt: string; closedAt?: string;
  lastReportAt?: string; successfulReports: number; failedReports: number;
  issue?: 'profile_missing' | 'report_rejected' | 'reporter_outdated';
}
export interface ReportingHealth {
  serverVersion: string; protocolVersion: number; checkedAt: string;
  reporters: ReporterConnection[];
}
export interface State {
  schemaVersion: 2;
  projectAliases?: Record<string,string>;
  seq: number; workspaces: Record<string, Workspace>; projects: Record<string, Project>;
  missions: Record<string, Mission>;
  tasks: Record<string, Task>; sessions: Record<string, AgentSession>;
  profiles: Record<string, AgentProfile>;
}
export type EventType = 'workspace.upserted' | 'project.created' | 'project.updated' | 'project.completed' | 'project.color_changed'
  | 'mission.created' | 'mission.updated' | 'mission.completed' | 'mission.color_changed' | 'work.update_reported'
  | 'task.created' | 'task.updated' | 'task.status_changed' | 'task.removed'
  | 'session.started' | 'session.updated' | 'session.ended' | 'profile.updated';
export type EventPayload = Workspace | Project | Mission | WorkUpdate | Task | AgentSession | AgentProfile;
export interface Event {
  seq: number; type: EventType; projectId?: string; missionId?: string; taskId?: string; sessionId?: string;
  timestamp: string; payload: EventPayload;
}
export type Change = Omit<Event, 'seq' | 'timestamp'>;
export interface SyncProjectInput {
  reporterId?: string;
  agent?: string; agentVersion?: string; sessionKey?: string;
  sourceSessionId?: string; agentId?: string; parentAgentId?: string; accountLabel?: string;
  profileKey?: string;
  project: { key?: string; name: string; description?: string; workspacePath: string };
  mission?: { key?: string; name: string; description?: string };
  tasks: Array<{ key: string; title: string; description?: string; status: TaskStatus; parentKey?: string; progress?: number; blocker?: Blocker | null; relatedTaskKeys?: string[] }>;
  removedTaskKeys?: string[];
}
export interface UpdateTasksInput {
  reporterId?: string;
  agent?: string; agentVersion?: string; sessionKey?: string; projectId?: string; missionId?: string;
  sourceSessionId?: string; agentId?: string; parentAgentId?: string; accountLabel?: string;
  profileKey?: string;
  updates: Array<{ taskKey: string; status: TaskStatus; note?: string; progress?: number; blocker?: Blocker | null; relatedTaskKeys?: string[] }>;
}
export interface ReportWorkUpdateInput {
  reporterId?: string;
  agent?: string; agentVersion?: string; sessionKey?: string; projectId?: string; missionId?: string;
  sourceSessionId?: string; agentId?: string; parentAgentId?: string; accountLabel?: string; profileKey?: string;
  phase: MissionUpdatePhase; status: MissionUpdateStatus; summary: string;
  nextStep?: string; environment?: 'development' | 'staging' | 'production';
}
export interface ReportWorkUpdateResult { projectId: string; missionId?: string; updateId: string }
export interface SyncProjectResult { projectId: string; missionId: string; rootProjectId: string; taskIds: Record<string, string> }
export interface UpdateTasksResult { projectId: string; missionId: string; updated: number }
export interface DaemonStatus { daemon: 'running'; url: string; projects: number; missions?:number; running: number; pid?: number }
