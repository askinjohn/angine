import type { ReportingHealth, ReporterConnection, State, Task } from './types.js';
import { isStale } from './workflow.js';

export const serverVersion = '0.1.0';
export const protocolVersion = 3;
export const heartbeatTimeout = 75000;
export function connectionStatus(connection: ReporterConnection, timestamp = Date.now()): 'connected' | 'disconnected' {
  return !connection.closedAt && timestamp - Date.parse(connection.lastSeenAt) < heartbeatTimeout ? 'connected' : 'disconnected';
}
export function connectionForSession(health: ReportingHealth | null, reporterId?: string): ReporterConnection | undefined {
  return reporterId ? health?.reporters.find(r => r.id === reporterId) : undefined;
}
export function groupConnections(reporters:ReporterConnection[], timestamp=Date.now()) {
  const groups = new Map<string,{id:string;agent:string;profileId?:string;profileKey?:string;reporters:ReporterConnection[];connected:number;sentUpdates:number;connectedOnly:number;issues:number}>();
  for(const reporter of reporters) {
    const id=JSON.stringify([reporter.agent,reporter.profileId || reporter.profileKey || 'default']);
    let group=groups.get(id);
    if(!group) {group={id,agent:reporter.agent,profileId:reporter.profileId,profileKey:reporter.profileKey,reporters:[],connected:0,sentUpdates:0,connectedOnly:0,issues:0};groups.set(id,group);}
    group.reporters.push(reporter);
    const connected=connectionStatus(reporter,timestamp)==='connected';
    if(connected) group.connected++;
    if(reporter.successfulReports>0) group.sentUpdates++;
    else if(connected) group.connectedOnly++;
    if(reporter.issue) group.issues++;
  }
  return [...groups.values()].map(group=>({...group,reporters:group.reporters.sort((a,b)=>Number(Boolean(b.issue))-Number(Boolean(a.issue)) || Number(b.successfulReports>0)-Number(a.successfulReports>0) || (b.lastReportAt || '').localeCompare(a.lastReportAt || '') || b.startedAt.localeCompare(a.startedAt))})).sort((a,b)=>b.issues-a.issues || a.agent.localeCompare(b.agent));
}
export function attentionTasks(state: State, tasks: Task[], health: ReportingHealth | null, staleMinutes: number, timestamp = Date.now()): Array<{task:Task;reason:string}> {
  return tasks.filter(t => !state.projects[t.projectId]?.archivedAt && !state.missions?.[t.missionId]?.archivedAt).flatMap(task => {
    if(task.status === 'blocked') return [{task,reason:task.blocker?.nextStep || task.blocker?.reason || 'Blocked — open for details'}];
    if(task.status === 'failed') return [{task,reason:'Agent reported failure'}];
    if(task.status !== 'in_progress') return [];
    const reporter = connectionForSession(health,state.sessions[task.updatedBySessionId || '']?.reporterId);
    if(reporter?.issue) return [{task,reason:'Reporter needs attention'}];
    if(reporter && connectionStatus(reporter,timestamp) === 'disconnected') return [{task,reason:'Reporter disconnected — task status unconfirmed'}];
    if(isStale(task,staleMinutes,timestamp)) return [{task,reason:'No recent task update'}];
    return [];
  });
}
