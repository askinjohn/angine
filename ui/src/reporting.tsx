import { useEffect, useState } from 'preact/hooks';
import type { AgentProfile, AgentSession, ReportingHealth, ReporterConnection, State, Task } from '../../src/types';
import { attentionTasks, connectionForSession, connectionStatus, groupConnections, protocolVersion } from '../../src/reporting';

const label = (agent: string) => agent[0].toUpperCase() + agent.slice(1);
const time = (value?: string) => value ? new Date(value).toLocaleString() : 'No reports yet';
export function useReportingHealth() {
  const [health,setHealth] = useState<ReportingHealth|null>(null);
  const [compatibility,setCompatibility] = useState<'checking'|'ready'|'outdated'|'unavailable'>('checking');
  useEffect(() => {
    let cancelled = false, pending = false;
    const controller = new AbortController();
    const check = async () => {
      if(pending) return;
      pending = true;
      try {
        const response = await fetch('/api/health',{signal:controller.signal});
        if(cancelled) return;
        if(response.status === 404) {setCompatibility('outdated');setHealth(null);return;}
        if(!response.ok) throw new Error();
        const next = await response.json() as ReportingHealth;
        if(cancelled) return;
        setHealth(next);setCompatibility(next.protocolVersion === protocolVersion ? 'ready' : 'outdated');
      } catch {if(!cancelled) {setCompatibility('unavailable');setHealth(null);}}
      finally {pending = false;}
    };
    void check();const timer = setInterval(() => {void check();},15000);
    return () => {cancelled=true;controller.abort();clearInterval(timer);};
  },[]);
  return {health,compatibility};
}
export function VersionNotice({compatibility}:{compatibility:string}) {
  if(compatibility !== 'outdated') return null;
  return <div class="server-notice" role="status"><strong>Update the running server</strong><span>Run <code>angine restart</code>, refresh this page, then restart your agent sessions. New controls need the updated server.</span></div>;
}
export function ReporterStatus({reporter}:{reporter?:ReporterConnection}) {
  const status = reporter ? connectionStatus(reporter) : 'unknown';
  return <span class={`reporter-health ${status}`} title="This describes the Angine reporter connection, not whether the agent is currently working."><span />{status === 'connected' ? 'Reporter connected' : status === 'disconnected' ? 'Reporter disconnected' : 'Connection not tracked'}</span>;
}
export function ReportingDetails({health,session}:{health:ReportingHealth|null;session:AgentSession}) {
  const reporter = connectionForSession(health,session.reporterId);
  return <div class="reporting-details"><ReporterStatus reporter={reporter} /><p>Last task report: {time(session.lastSeenAt)}</p>{reporter && <p>{reporter.successfulReports} accepted · {reporter.failedReports} rejected reports since server start</p>}<p>Task status is agent reported. A connection heartbeat does not confirm task progress.</p></div>;
}
const issueText = (reporter:ReporterConnection) => reporter.issue === 'profile_missing' ? 'Profile not found. Check the configured profile key.' : reporter.issue === 'reporter_outdated' ? 'Restart this agent session to load the updated reporter.' : reporter.issue === 'report_rejected' ? 'A report was rejected. Check its profile and task keys; the next accepted report clears this warning.' : '';
export function Connections({health,compatibility,profile,profiles={}}:{health:ReportingHealth|null;compatibility:string;profile?:AgentProfile;profiles?:State['profiles']}) {
  const [copied,setCopied] = useState(false);
  const reporters = (health?.reporters || []).filter(r => !profile || r.profileId === profile.id || r.profileKey === profile.key && r.agent === profile.agent).sort((a,b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  const groups = groupConnections(reporters);
  const online = reporters.filter(r => connectionStatus(r)==='connected').length;
  const args = profile ? ['mcp','--agent',profile.agent,'--profile',profile.key] : undefined;
  const config = profile ? JSON.stringify({command:'angine',args},null,2) : 'angine setup';
  return <section class="panel connection-panel"><div class="panel-heading"><h2>Connections</h2><span>{compatibility === 'ready' ? `${online} connected` : compatibility === 'outdated' ? 'Server update needed' : compatibility === 'checking' ? 'Checking…' : 'Unable to check'}</span></div><p class="muted">Connected means the integration is reachable. “Sent updates” counts reporters that submitted work since the server started; “connected only” means no work updates in that time. Neither confirms the agent is currently working.</p>{groups.map(group=><details class="connection-group" key={group.id}><summary><span><strong>{profiles[group.profileId || '']?.name || label(group.agent)}{!group.profileId && group.profileKey ? ` · ${group.profileKey}` : ''}</strong><span>{group.connected} connected · {group.sentUpdates} sent updates · {group.connectedOnly} connected only</span></span><span class={group.issues ? 'connection-issue' : 'connection-group-expand'}>{group.issues ? `${group.issues} need attention` : `${group.reporters.length} reporters`}</span></summary><div class="connection-group-rows">{group.reporters.map(r=><div class="connection-row" key={r.id}><div><strong>{label(r.agent)} · {r.id.slice(0,8)}</strong><ReporterStatus reporter={r} /><span>{r.lastReportAt ? `Last known report: ${time(r.lastReportAt)}` : 'No task updates received in this server session'}</span>{r.issue && <p class="connection-issue">{issueText(r)}</p>}</div><details><summary>Details</summary><dl><dt>Profile</dt><dd>{profiles[r.profileId || '']?.name || r.profileKey || 'Agent default'}</dd><dt>Reporter version</dt><dd>{r.version || 'Unknown'}</dd><dt>Last heartbeat</dt><dd>{time(r.lastSeenAt)}</dd><dt>Accepted since server start</dt><dd>{r.successfulReports}</dd><dt>Rejected since server start</dt><dd>{r.failedReports}</dd><dt>Reporter ID</dt><dd>{r.id}</dd>{r.sourceSessionId && <><dt>Agent session</dt><dd>{r.sourceSessionId}</dd></>}</dl></details></div>)}</div></details>)}{!reporters.length && <p class="muted">No tracked connections {profile ? 'for this profile ' : ''}yet. Restart your configured agent session to load the updated reporter.</p>}<details class="connect-instructions"><summary>{profile ? 'Connect this profile' : 'Connect an agent'}</summary><p>{profile ? 'Use this configuration for the agent’s Angine MCP connection. The profile key assigns its reports here.' : 'Run setup once, then restart Claude or Codex sessions. Setup registers their local MCP reporter.'}</p><pre>{config}</pre><button class="secondary-button" onClick={async()=>{try {await navigator.clipboard.writeText(config);setCopied(true);}catch {setCopied(false);}}}>{copied ? 'Copied' : 'Copy setup'}</button><p class="muted">After reconnecting, ask the agent to use Angine’s check_connection tool. A successful check confirms the reporter and profile; reports will appear when the agent sends work updates.</p>{profile?.isDefault && <p class="muted">This is the default profile for {label(profile.agent)}. Existing connections without an explicit profile key use it automatically.</p>}</details></section>;
}
export function AttentionSummary({state,tasks,health,staleMinutes}:{state:State;tasks:Task[];health:ReportingHealth|null;staleMinutes:number}) {
  const attention = attentionTasks(state,tasks,health,staleMinutes);
  const working = tasks.filter(t=>t.status==='in_progress').length;
  return <details class={`attention-summary ${attention.length ? 'has-attention' : ''}`}><summary><span><strong>{attention.length ? `${attention.length} need attention` : 'No tasks need attention'}</strong><span>{working} in progress · Based on the current filters</span></span><span class="attention-expand">View details</span></summary><div class="attention-items">{attention.slice(0,10).map(({task,reason})=><a key={task.id} href={`#/tasks/${encodeURIComponent(task.id)}`}><strong>{task.title}</strong><span class="attention-context"><b>Project:</b> {state.projects[task.projectId]?.name || 'Unknown project'} <span aria-hidden="true"> / </span><b>Mission:</b> {state.missions[task.missionId]?.name || 'Unknown mission'}</span><span class="attention-reason">{reason}</span></a>)}{!attention.length && <p class="muted">No blocked, failed, stale, or tracked disconnected tasks in this view. This is based on reports received, not independent verification of the work.</p>}{attention.length > 10 && <p class="muted">Showing the first 10. Use the task filters to review the remaining work.</p>}</div></details>;
}
