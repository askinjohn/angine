import { useEffect, useRef, useState } from 'preact/hooks';
import type { AgentProfile, AgentSession, Project, Mission, State, Task, ReportingHealth } from '../../src/types';
import { isArchivedTask } from '../../src/hierarchy';
import { Connections } from './reporting';
import { isStale, notificationChanges } from '../../src/workflow';

export type Filters = { agent: string; status: string; project: string; mission: string; profile: string; query: string; staleOnly: boolean };
export type Preferences = { staleMinutes: number; notifications: boolean };
export type Mutate = (operation: string, input: unknown) => Promise<boolean>;
const defaults: Filters = { agent: 'all', status: 'all', project: 'all', mission: 'all', profile: 'all', query: '', staleOnly: false };
export const agentLabel = (name?: string) => ({ codex: 'Codex', claude: 'Claude', grok: 'Grok', external: 'External' }[(name || 'external').trim()] || name || 'External');
const href = (kind: string, id?: string) => `#/${kind}${id ? `/${encodeURIComponent(id)}` : ''}`;
function readLocal<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
function writeLocal(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ } }
export function useSavedFilters(section: string) {
  const [sets, setSets] = useState<Record<string, Filters>>(() => readLocal('angine-filters-v1', {}));
  useEffect(() => writeLocal('angine-filters-v1', sets), [sets]);
  const filters = { ...defaults, ...sets[section] };
  const set = (patch: Partial<Filters>) => setSets(previous => ({ ...previous, [section]: { ...defaults, ...previous[section], ...patch } }));
  return { filters, set, reset: () => set({ ...defaults }), resetAll: () => setSets({}) };
}
export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    const value = readLocal<Preferences>('angine-preferences-v1', { staleMinutes: 60, notifications: false });
    return { staleMinutes: [0,15,60,240,1440].includes(value.staleMinutes) ? value.staleMinutes : 60, notifications: value.notifications === true };
  });
  useEffect(() => writeLocal('angine-preferences-v1', preferences), [preferences]);
  return { preferences, setPreferences };
}
export function useNotifications(state: State | null, enabled: boolean) {
  const previous = useRef<State | null>(null);
  useEffect(() => {
    if (!state) return;
    const changes = notificationChanges(previous.current, state);
    previous.current = state;
    if (!enabled || !changes.length || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const completed = changes.filter(t => t.status === 'completed').length;
    const blocked = changes.length - completed;
    const title = changes.length === 1 ? `Angine · Task ${changes[0].status}` : 'Angine · Work updated';
    const body = changes.length === 1 ? changes[0].title : [completed ? `${completed} completed` : '', blocked ? `${blocked} blocked` : ''].filter(Boolean).join(' · ');
    try {
      const notification = new Notification(title, { body, tag: 'angine-work-update' });
      notification.onclick = () => { window.focus(); location.hash = href('tasks', changes[0].id).slice(1); notification.close(); };
    } catch { /* notifications may be disabled by the operating system */ }
  }, [state, enabled]);
}
export async function dashboardMutation(operation: string, input: unknown): Promise<State> {
  const session = await fetch('/api/dashboard/session');
  if (!session.ok) throw new Error('Run angine restart in your terminal to load the new dashboard controls, then refresh this page and save again.');
  const response = await fetch(`/api/dashboard/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Angine-UI': '1' }, body: JSON.stringify(input) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not save the change.');
  return result.state;
}
export function profileForSession(state: State, session?: AgentSession): AgentProfile | undefined {
  if (!session) return undefined;
  return session?.profileId ? state.profiles?.[session.profileId] : Object.values(state.profiles || {}).find(p => p.isDefault && p.agent === (session?.agent || 'external'));
}
export function profileForTask(state: State, task: Task): AgentProfile | undefined {
  return profileForSession(state, state.sessions[task.updatedBySessionId || '']) || Object.values(state.profiles || {}).find(p => p.isDefault && p.agent === (task.updatedBy || 'external'));
}
export function StaleTag({ item, minutes }: { item: Pick<Task | Mission, 'status' | 'updatedAt'>; minutes: number }) {
  return minutes > 0 && isStale(item, minutes) ? <span class="stale-tag" title={`No reported update since ${new Date(item.updatedAt).toLocaleString()}`}>Stale</span> : null;
}
function ProfileEditor({ profile, mutate, close }: { profile?: AgentProfile; mutate: Mutate; close: () => void }) {
  const [draft, setDraft] = useState<Partial<AgentProfile>>(() => profile || { agent: 'external', context: 'Personal', isDefault: true });
  const [saving, setSaving] = useState(false);
  const descriptions: Partial<Record<keyof AgentProfile, string>> = {
    name: 'A name you recognise in Angine, such as Team Agent or Development Agent.',
    agent: 'The agent reporting the work: claude, codex, grok, or another agent name. Use external for a generic reporter. This must match the reporter’s agent type.',
    key: 'A unique ID for this profile, such as team-agent. Use this key in the reporter’s --profile setting to link its reports here. It cannot be changed after saving.',
    context: 'What you use this agent for, such as Work or Personal. This label helps you identify and filter its work.',
    ownerName: 'Optional. The person using this agent. Enter the name yourself; Angine does not read it from the agent account.',
    ownerEmail: 'Optional. The owner’s email for identifying whose work this is. It is not used to sign in or send email.',
    accountLabel: 'Optional. A nickname for the account, such as Company account or Personal account. Enter a label, never a password or API key.',
    description: 'Optional. A short note explaining what this profile is used for, such as development and code reviews.',
  };
  const field = (key: keyof AgentProfile, label: string, required = false, max = 160) => <label>{label}<input type={key === 'ownerEmail' ? 'email' : 'text'} required={required} readOnly={Boolean(profile && (key === 'agent' || key === 'key'))} maxLength={max} value={String(draft[key] ?? '')} aria-describedby={`profile-help-${key}`} onInput={e => setDraft({ ...draft, [key]: e.currentTarget.value })} /><span class="field-help" id={`profile-help-${key}`}>{descriptions[key]}</span></label>;
  return <form class="panel profile-form" onSubmit={async e => { e.preventDefault(); setSaving(true); const okay = await mutate('profiles', draft); setSaving(false); if (okay) close(); }}><div class="panel-heading"><h2>{profile ? 'Edit profile' : 'New agent profile'}</h2><button type="button" class="text-button" onClick={close}>Close</button></div><div class="form-grid">{field('name','Profile name',true)}{field('agent','Agent type',true,80)}{field('key','Stable profile key',true)}{field('context','Context (Work, Personal…)',true,80)}{field('ownerName','Owner name')}{field('ownerEmail','Owner email')}{field('accountLabel','Account label')}{field('description','Description',false,500)}</div><label class="check-label"><input type="checkbox" aria-describedby="profile-help-default" checked={draft.isDefault === true} onChange={e => setDraft({ ...draft, isDefault: e.currentTarget.checked })} />Default profile for this agent type</label><p class="field-help" id="profile-help-default">Reports from this agent type use this profile when no profile key is specified. For example, making this the Claude default labels Claude reports with this profile. Only one profile can be the default for each agent type.</p><p class="muted">Saving creates the profile. To link reports, make it the default or configure the agent’s Angine reporter with this profile key. Saving does not start or configure an agent.</p><button class="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button></form>;
}
export function AgentsView({ state, profileId, mutate, taskRow, health, compatibility }: { health:ReportingHealth|null; compatibility:string; state: State; profileId?: string; mutate: Mutate; taskRow: (task: Task) => import('preact').ComponentChildren }) {
  const [editing, setEditing] = useState<AgentProfile | 'new' | null>(null);
  const profiles = Object.values(state.profiles || {}).sort((a,b) => a.name.localeCompare(b.name));
  const selected = profileId ? state.profiles?.[profileId] : undefined;
  const sessionsFor = (profile: AgentProfile) => Object.values(state.sessions).filter(s => profileForSession(state, s)?.id === profile.id);
  const tasksFor = (profile: AgentProfile) => Object.values(state.tasks).filter(t => profileForTask(state,t)?.id === profile.id && !isArchivedTask(state,t));
  const projectsFor = (profile: AgentProfile) => {
    const ids = new Set([...tasksFor(profile).map(t => t.projectId), ...sessionsFor(profile).flatMap(s => s.projectIds || [s.projectId])]);
    return Object.values(state.projects).filter(p => ids.has(p.id) && !p.archivedAt);
  };
  const missionsFor = (profile:AgentProfile) => {
    const ids = new Set([...tasksFor(profile).map(t=>t.missionId),...sessionsFor(profile).flatMap(s=>s.missionIds || [s.missionId])]);
    return Object.values(state.missions).filter(m=>ids.has(m.id) && !m.archivedAt && !state.projects[m.projectId]?.archivedAt);
  };
  const sessionTree = (profile: AgentProfile) => {
    const items = sessionsFor(profile).sort((a,b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    const parent = (item: AgentSession) => items.find(s => s.id !== item.id && item.parentAgentId === s.agentId && item.sourceSessionId && s.sourceSessionId === item.sourceSessionId && s.workspaceId === item.workspaceId);
    const result: { session: AgentSession; depth: number }[] = [], visited = new Set<string>();
    const visit = (item: AgentSession, depth: number) => { if (visited.has(item.id)) return; visited.add(item.id); result.push({ session:item, depth }); items.filter(s => parent(s)?.id === item.id).forEach(s => visit(s,depth+1)); };
    items.filter(s => !parent(s)).forEach(s => visit(s,0)); items.forEach(s => visit(s,0)); return result;
  };
  if (profileId && !selected) return <div class="empty"><h2>Profile not found</h2><a href={href('agents')}>All agents</a></div>;
  return <><div class="view-heading"><div><h1>{selected?.name || 'Agents & sessions'}</h1><p>{selected ? `${selected.context} · ${agentLabel(selected.agent)}` : 'Profiles, collaboration, and reported agent sessions.'}</p></div><button class="primary-button" onClick={() => setEditing(selected || 'new')}>{selected ? 'Edit profile' : 'Add profile'}</button></div>{editing && <ProfileEditor key={editing === 'new' ? 'new' : editing.id} profile={editing === 'new' ? undefined : editing} mutate={mutate} close={() => setEditing(null)} />}
    <Connections profiles={state.profiles} health={health} compatibility={compatibility} profile={selected} />{selected ? <><nav class="breadcrumbs"><a href={href('agents')}>Agents</a><span>/</span><span>{selected.name}</span></nav><div class="profile-summary panel"><span>{projectsFor(selected).length} projects</span><span>{missionsFor(selected).length} missions</span><span>{tasksFor(selected).length} tasks</span><span>{sessionsFor(selected).length} sessions</span>{selected.ownerName && <span>Owner: {selected.ownerName}</span>}{selected.ownerEmail && <span>{selected.ownerEmail}</span>}{selected.accountLabel && <span>Account: {selected.accountLabel}</span>}</div><section class="panel"><h2>Projects</h2><div class="linked-projects">{projectsFor(selected).map(p => <a href={href('projects',p.id)}>{p.name}<span>{p.status}</span></a>)}{!projectsFor(selected).length && <p class="muted">No projects reported for this profile yet.</p>}</div></section><section class="panel"><h2>Missions</h2><div class="linked-projects">{missionsFor(selected).map(m=><a key={m.id} href={href('missions',m.id)}>{m.name}<span>{state.projects[m.projectId]?.name} · {m.status}</span></a>)}{!missionsFor(selected).length && <p class="muted">No missions reported for this profile yet.</p>}</div></section><section class="panel"><h2>Tasks</h2><div class="task-table">{tasksFor(selected).map(taskRow)}</div></section><section class="panel"><h2>Sessions & child agents</h2><div class="sessions-view">{sessionTree(selected).map(({session:s,depth}) => <div key={s.id} class="session-card" style={{ marginLeft: `${Math.min(depth,4)*20}px` }}><strong>{s.agentId || agentLabel(s.agent)}</strong><span>{s.parentAgentId ? `Child of ${s.parentAgentId}` : 'Reporter session'} · Last report {new Date(s.lastSeenAt).toLocaleString()}</span><dl><dt>Angine session</dt><dd>{s.id}</dd>{s.sourceSessionId && <><dt>Agent session</dt><dd>{s.sourceSessionId}</dd></>}<dt>Projects</dt><dd>{(s.projectIds || [s.projectId]).map(id => <a class="session-project" href={href('projects',id)}>{state.projects[id]?.name || id}</a>)}</dd><dt>Missions</dt><dd>{(s.missionIds || [s.missionId]).map(id => <a class="session-project" href={href('missions',id)}>{state.missions[id]?.name || id}</a>)}</dd><dt>Latest task reports</dt><dd>{Object.values(state.tasks).filter(t => t.updatedBySessionId === s.id).map(t => <a class="session-project" href={href('tasks',t.id)}>{t.title}</a>)}</dd></dl></div>)}{!sessionsFor(selected).length && <p class="muted">Sessions appear when this agent reports work. Child links require reported parent IDs.</p>}</div></section></> : <div class="profile-grid">{profiles.map(p => <article class="panel profile-card" key={p.id}><div class="panel-heading"><a href={href('agents',p.id)}><h2>{p.name}</h2></a><button class="text-button" onClick={() => setEditing(p)}>Edit</button></div><div class="profile-labels"><span>{agentLabel(p.agent)}</span><span>{p.context}</span>{p.isDefault && <span>Default</span>}</div>{p.description && <p class="muted">{p.description}</p>}{p.ownerName && <p class="muted">{p.ownerName}{p.ownerEmail ? ` · ${p.ownerEmail}` : ''}</p>}<a class="profile-counts" href={href('agents',p.id)}><span>{projectsFor(p).length} projects</span><span>{missionsFor(p).length} missions</span><span>{tasksFor(p).length} tasks</span><span>{sessionsFor(p).length} sessions ↗</span></a></article>)}</div>}
  </>;
}
export function TaskWorkflow({ task, state, mutate }: { task: Task; state: State; mutate: Mutate }) {
  const [reason, setReason] = useState(task.blocker?.reason || '');
  const [nextStep, setNextStep] = useState(task.blocker?.nextStep || '');
  const [owner, setOwner] = useState(task.blocker?.owner || '');
  const [related, setRelated] = useState(task.relatedTaskKeys || []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const peers = Object.values(state.tasks).filter(t => t.missionId === task.missionId && t.id !== task.id);
  const links = peers.filter(t => related.includes(t.key) || t.relatedTaskKeys?.includes(task.key));
  return <section class="panel"><h2>{task.status === 'blocked' ? 'Blocker & related work' : 'Related work'}</h2>{links.length ? <div class="related-links">{links.map(t => <a href={href('tasks',t.id)}>{t.title}<span>{agentLabel(t.updatedBy)} · {t.status.replaceAll('_',' ')}</span></a>)}</div> : <p class="muted">Link related tasks from any agent working in this mission.</p>}<form class="workflow-form" onSubmit={async e => { e.preventDefault(); setSaving(true); const okay = await mutate('task-details', {taskId:task.id, relatedTaskKeys:related, ...(task.status === 'blocked' ? {blocker:reason.trim() ? {reason,nextStep,owner} : null} : {})}); setSaving(false); setSaved(okay); }}>{task.status === 'blocked' && <><label>What is blocking this task?<textarea maxLength={500} value={reason} onInput={e => { setReason(e.currentTarget.value); setSaved(false); }} placeholder={task.note || 'Describe the blocker…'} /></label><label>What needs to happen next?<textarea maxLength={500} value={nextStep} onInput={e => { setNextStep(e.currentTarget.value); setSaved(false); }} /></label><label>Who can unblock it?<input maxLength={160} value={owner} onInput={e => { setOwner(e.currentTarget.value); setSaved(false); }} /></label></>}<label>Related tasks<select multiple onChange={e => { setRelated(Array.from(e.currentTarget.selectedOptions).map(o => o.value)); setSaved(false); }} size={Math.min(5,Math.max(2,peers.length))}>{peers.map(t => <option value={t.key} selected={related.includes(t.key)}>{t.title} · {agentLabel(t.updatedBy)}</option>)}</select></label><p class="muted">Select related tasks; use ⌘ or Ctrl to select more than one. Shared project and mission keys link work across agents automatically.</p><button class="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button>{saved && <span class="saved-message">Saved</span>}</form></section>;
}
export function ArchiveView({ state, mutate }: { state: State; mutate: Mutate }) {
  const items = [...Object.values(state.projects).filter(p=>p.archivedAt).map(p=>({...p,kind:'projects'})),...Object.values(state.missions).filter(m=>m.archivedAt).map(m=>({...m,kind:'missions'}))].sort((a,b)=>b.archivedAt!.localeCompare(a.archivedAt!));
  return <><div class="view-heading"><div><h1>Archive <span class="section-count">{items.length}</span></h1><p>Projects and missions hidden from the main views. Tasks and history are preserved.</p></div></div><div class="panel archive-list">{items.map(p=><div key={p.id}><a href={href(p.kind,p.id)}><strong>{p.name}</strong><span>{p.kind==='missions' ? `Mission · ${state.projects[(p as Mission).projectId]?.name || ''}` : 'Project'} · Archived {new Date(p.archivedAt!).toLocaleString()}</span>{p.kind==='missions' && state.projects[(p as Mission).projectId]?.archivedAt && <span>Restore the parent project to make this mission visible.</span>}</a><button class="secondary-button" onClick={()=>mutate('archive',{projectId:p.id,archived:false})}>Restore</button></div>)}{!items.length && <p class="muted">No archived projects or missions.</p>}</div></>;
}
export function SettingsView({ preferences, setPreferences, resetFilters }: { preferences: Preferences; setPreferences: (value: Preferences) => void; resetFilters: () => void }) {
  const [message, setMessage] = useState('');
  return <><div class="view-heading"><div><h1>Preferences</h1><p>Activity indicators, saved filters, and optional alerts.</p></div></div><section class="panel settings-panel"><h2>Stale activity</h2><label>Flag active work after no reported update for<select value={preferences.staleMinutes} onChange={e => setPreferences({...preferences,staleMinutes:Number(e.currentTarget.value)})}><option value={0}>Off</option><option value={15}>15 minutes</option><option value={60}>1 hour</option><option value={240}>4 hours</option><option value={1440}>1 day</option></select></label><p class="muted">Stale describes reporting activity. It does not change a task's status.</p></section><section class="panel settings-panel"><h2>Saved filters</h2><p class="muted">Project, mission, agent, profile, status, and search selections are remembered separately for each view on this device.</p><button class="secondary-button" onClick={() => { resetFilters(); setMessage('Saved filters reset.'); }}>Reset saved filters</button></section><section class="panel settings-panel"><h2>Desktop notifications</h2><p class="muted">Optional alerts for tasks that finish or become blocked. The dashboard must remain open.</p><button class="secondary-button" onClick={async () => { if (preferences.notifications) { setPreferences({...preferences,notifications:false}); setMessage('Notifications disabled.'); return; } if (typeof Notification === 'undefined') {setMessage('This browser does not support desktop notifications.');return;} try { const permission = await Notification.requestPermission(); if(permission === 'granted') {setPreferences({...preferences,notifications:true});setMessage('Notifications enabled.');} else setMessage('Notification permission was not granted.'); } catch {setMessage('Notifications are unavailable in this browser.');} }}>{preferences.notifications ? 'Disable notifications' : 'Enable notifications'}</button><p class="muted" role="status">{message}</p></section></>;
}
