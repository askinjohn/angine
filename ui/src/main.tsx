import { render, type ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { State, Task, Project, Mission, AgentSession, ReportingHealth } from '../../src/types';
import { isArchivedTask, normalizeHierarchy } from '../../src/hierarchy';
import { attentionTasks } from '../../src/reporting';
import { isStale } from '../../src/workflow';
import { AgentsView, ArchiveView, SettingsView, TaskWorkflow, StaleTag, dashboardMutation, profileForTask, profileForSession, useSavedFilters, usePreferences, useNotifications } from './workflow';
import { AttentionSummary, ReportingDetails, VersionNotice, useReportingHealth } from './reporting';
import './style.css';

type Activity = { seq: number; type: string; taskId?: string; sessionId?: string; timestamp: string; payload: Record<string, unknown> };
const labels: Record<string, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', planned: 'Planned', running: 'Running', active: 'Active' };
const agentKey = (name: string | undefined) => name?.trim() || 'external';
const agentName = (name: string | undefined) => ({ codex: 'Codex', claude: 'Claude', grok: 'Grok', external: 'External' }[agentKey(name)] || agentKey(name));
const ago = (iso: string) => { const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000)); return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`; };
const taskPercent = (task: Task) => task.status === 'completed' ? 100 : task.status === 'todo' ? 0 : task.progress;
const href = (kind: string, id?: string) => `#/${kind}${id ? `/${encodeURIComponent(id)}` : ''}`;
function Badge({ status }: { status: string }) { return <span class={`badge ${status}`}><span class="status-dot" />{labels[status] || status}</span>; }
function Progress({ value, caption = 'Progress' }: { value?: number; caption?: string }) {
  return <div class="progress"><div class="progress-label"><span>{caption}</span><strong>{value == null ? 'Not reported' : `${Math.round(value)}%`}</strong></div><div class={`track ${value == null ? 'unknown' : ''}`} role={value == null ? undefined : 'progressbar'} aria-label={caption} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>{value != null && <span style={{ width: `${value}%` }} />}</div></div>;
}
function Reporter({ session, state, health }: { session: AgentSession; state: State; health: ReportingHealth | null }) {
  const profile = profileForSession(state, session);
  return <div class="reporter"><div class="reporter-title"><span class="avatar">{agentName(session.agent).slice(0, 1)}</span><div><strong>{profile?.name || agentName(session.agent)}</strong><span>{session.agentId || 'Reporter'} · {ago(session.lastSeenAt)}</span></div></div><dl>{profile && <><dt>Profile</dt><dd><a href={href('agents',profile.id)}>{profile.name}</a></dd></>}{profile?.ownerName && <><dt>Owner</dt><dd>{profile.ownerName}{profile.ownerEmail ? ` · ${profile.ownerEmail}` : ''}</dd></>}<dt>Angine session</dt><dd>{session.id}</dd>{session.sourceSessionId && <><dt>Agent session</dt><dd>{session.sourceSessionId}</dd></>}{session.parentAgentId && <><dt>Parent agent</dt><dd>{session.parentAgentId}</dd></>}{session.accountLabel && <><dt>Account</dt><dd>{session.accountLabel}</dd></>}</dl><ReportingDetails health={health} session={session} /></div>;
}
function StatusSection<T extends { id: string }>({ status, items, kind, limit, row }: { status: string; items: T[]; kind: 'projects' | 'missions' | 'tasks'; limit: number; row: (item: T) => ComponentChildren }) {
  const list = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const overflowing = items.length > limit;
  useLayoutEffect(() => {
    const element = list.current;
    if (!element || !overflowing) { setHeight(undefined); return; }
    const rows = Array.from(element.children).slice(0, limit);
    const measure = () => setHeight(Math.ceil(rows.reduce((total, item) => total + item.getBoundingClientRect().height, 0)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    rows.forEach(item => observer.observe(item));
    return () => observer.disconnect();
  }, [items, limit, overflowing]);
  return <section class="project-status-section" aria-labelledby={`${kind}-${status}`}><div class="status-section-heading"><h2 id={`${kind}-${status}`}><span class={`section-status-dot ${status}`} />{labels[status]}<span class="section-count">{items.length}</span></h2><span>{overflowing ? `Latest ${limit} shown · Scroll for ${items.length - limit} more` : 'Newest updates first'}</span></div><div class="project-list panel"><div class={kind === 'tasks' ? 'task-list-head' : 'project-list-head'} aria-hidden="true"><span>{kind === 'tasks' ? 'Task' : kind === 'missions' ? 'Mission' : 'Project'}</span><span>Status</span><span>Progress</span>{kind !== 'tasks' && <span>Agent</span>}<span>Updated</span><span /></div><div class={`project-scroll ${overflowing ? 'has-overflow' : ''}`} ref={list} style={overflowing && height ? { maxHeight: `${height}px` } : undefined} tabIndex={overflowing ? 0 : undefined} role={overflowing ? 'region' : undefined} aria-label={overflowing ? `${labels[status]} ${kind}, scroll to see all ${items.length}` : undefined}>{items.length ? items.map(row) : <div class="status-section-empty">No {labels[status].toLowerCase()} {kind} in this view.</div>}</div></div></section>;
}
function App() {
  const [state, setState] = useState<State | null>(null);
  const [route, setRoute] = useState(location.hash.slice(1) || '/projects');
  const [section = 'projects', encodedId] = route.split('/').filter(Boolean);
  let routeId = ''; try { routeId = decodeURIComponent(encodedId || ''); } catch { /* malformed link */ }
  const { filters, set: setFilters, reset: resetFilters, resetAll: resetAllFilters } = useSavedFilters(section);
  const { agent, status, project: projectFilter, mission: missionFilter, profile: profileFilter, query, staleOnly } = filters;
  const { preferences, setPreferences } = usePreferences();
  const { health, compatibility } = useReportingHealth();
  useNotifications(state, preferences.notifications);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<Activity[]>([]);
  const [connected, setConnected] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const [boardHeight, setBoardHeight] = useState<number>();
  const [, tick] = useState(0);
  const acceptState = (value: State) => setState(previous => previous && previous.seq > value.seq ? previous : normalizeHierarchy(value));
  const mutate = async (operation: string, input: unknown) => {
    setError('');
    try { acceptState(await dashboardMutation(operation,input)); return true; }
    catch (failure) { setError((failure as Error).message); return false; }
  };
  useEffect(() => {
    const change = () => { setRoute(location.hash.slice(1) || '/projects'); window.scrollTo(0,0); };
    window.addEventListener('hashchange',change); return () => window.removeEventListener('hashchange',change);
  },[]);
  useEffect(() => {
    fetch('/api/state').then(r => {if(!r.ok) throw new Error(); return r.json();}).then(acceptState).catch(()=>setConnected(false));
    const stream = new EventSource('/api/events');
    stream.addEventListener('state',message => {acceptState(JSON.parse((message as MessageEvent).data));setConnected(true);});
    stream.onerror = () => setConnected(false);
    const interval = setInterval(()=>tick(n=>n+1),30000);
    return () => {stream.close();clearInterval(interval);};
  },[]);
  useLayoutEffect(() => {
    const element = board.current; if(section !== 'board' || !element) return;
    const measure = () => setBoardHeight(Math.max(260,window.innerHeight-element.getBoundingClientRect().top-24));
    measure();const observer = new ResizeObserver(measure);
    if(element.parentElement) observer.observe(element.parentElement);
    window.addEventListener('resize',measure);
    return () => {observer.disconnect();window.removeEventListener('resize',measure);};
  },[section,Boolean(state)]);

  const task = section === 'tasks' && routeId ? state?.tasks[routeId] : undefined;
  // Legacy project URLs identify the old plan, which is now a mission.
  const mission = task ? state?.missions[task.missionId] : (section === 'missions' || section === 'projects') && routeId ? state?.missions[routeId] : undefined;
  const project = mission ? state?.projects[mission.projectId] : section === 'projects' && routeId ? state?.projects[routeId] : undefined;
  const activityScope = mission ? `missions/${encodeURIComponent(mission.id)}` : project ? `projects/${encodeURIComponent(project.id)}` : '';
  useEffect(() => {
    setEvents([]);if(!activityScope) return;
    let active = true;
    fetch(`/api/${activityScope}/events`).then(r=>{if(!r.ok) throw new Error();return r.json();}).then(value=>{if(active) setEvents(value);}).catch(()=>{});
    return () => {active=false;};
  },[activityScope,state?.seq]);
  const sorted = <T extends {updatedAt:string}>(items:T[]) => items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const allTasks = sorted(Object.values(state?.tasks || {}));
  const allMissions = sorted(Object.values(state?.missions || {}));
  const projects = sorted(Object.values(state?.projects || {})).filter(p=>!p.archivedAt);
  const missions = allMissions.filter(m=>!m.archivedAt && !state?.projects[m.projectId]?.archivedAt);
  const tasks = allTasks.filter(t=>state?.missions[t.missionId] && !isArchivedTask(state,t));
  const sessions = Object.values(state?.sessions || {});
  const agents = [...new Set([...sessions.map(s=>agentKey(s.agent)),...tasks.map(t=>agentKey(t.updatedBy))])].sort();
  const missionTasks = (id:string) => allTasks.filter(t=>t.missionId===id);
  const projectMissions = (id:string) => missions.filter(m=>m.projectId===id);
  const projectTasks = (id:string) => tasks.filter(t=>t.projectId===id);
  const missionAgents = (id:string) => [...new Set([...missionTasks(id).map(t=>agentKey(t.updatedBy)),...sessions.filter(s=>s.missionId===id || s.missionIds?.includes(id)).map(s=>agentKey(s.agent))])];
  const projectAgents = (id:string) => [...new Set([...allTasks.filter(t=>t.projectId===id).map(t=>agentKey(t.updatedBy)),...sessions.filter(s=>s.projectId===id || s.projectIds?.includes(id)).map(s=>agentKey(s.agent))])];
  const profilesFor = (items:Task[], reporters:AgentSession[]) => [...new Set([...items.map(t=>state ? profileForTask(state,t)?.id : undefined),...reporters.map(s=>state ? profileForSession(state,s)?.id : undefined)])];
  const projectProfiles = (id:string) => profilesFor(allTasks.filter(t=>t.projectId===id),sessions.filter(s=>s.projectId===id || s.projectIds?.includes(id)));
  const missionProfiles = (id:string) => profilesFor(missionTasks(id),sessions.filter(s=>s.missionId===id || s.missionIds?.includes(id)));
  const projectOptions = projects.filter(p=>(agent==='all' || projectAgents(p.id).includes(agent)) && (profileFilter==='all' || projectProfiles(p.id).includes(profileFilter)));
  const missionOptions = missions.filter(m=>(projectFilter==='all' || m.projectId===projectFilter) && (agent==='all' || missionAgents(m.id).includes(agent)) && (profileFilter==='all' || missionProfiles(m.id).includes(profileFilter)));
  useEffect(() => {
    if(!state) return;
    if(state.missions[projectFilter]) {setFilters({project:state.missions[projectFilter].projectId,mission:projectFilter});return;}
    if(projectFilter!=='all' && !projectOptions.some(p=>p.id===projectFilter)) {setFilters({project:'all',mission:'all'});return;}
    if(missionFilter!=='all' && !missionOptions.some(m=>m.id===missionFilter)) setFilters({mission:'all'});
    if(section==='projects' && !['all','active'].includes(status)) setFilters({status:'all'});
  },[state,section,agent,profileFilter,projectFilter,missionFilter,status]);
  const match = (...values:(string|undefined)[]) => values.join(' ').toLowerCase().includes(query.toLowerCase().trim());
  const visibleMissions = missions.filter(m=>(projectFilter==='all' || m.projectId===projectFilter) && (missionFilter==='all' || m.id===missionFilter) && (agent==='all' || missionAgents(m.id).includes(agent)) && (profileFilter==='all' || missionProfiles(m.id).includes(profileFilter)) && (!staleOnly || isStale(m,preferences.staleMinutes)) && (section!=='missions' || status==='all' || m.status===status) && match(m.name,m.description,state?.projects[m.projectId]?.name));
  const visibleProjects = projectOptions.filter(p=>(projectFilter==='all' || p.id===projectFilter) && (!staleOnly || projectMissions(p.id).some(m=>isStale(m,preferences.staleMinutes))) && (match(p.name,p.description,state?.workspaces[p.workspaceId]?.path) || projectMissions(p.id).some(m=>match(m.name,m.description))));
  const visibleTasks = tasks.filter(t=>(projectFilter==='all' || t.projectId===projectFilter) && (missionFilter==='all' || t.missionId===missionFilter) && (agent==='all' || agentKey(t.updatedBy)===agent) && (profileFilter==='all' || state && profileForTask(state,t)?.id===profileFilter) && (!staleOnly || isStale(t,preferences.staleMinutes)) && (status==='all' || t.status===status) && match(t.title,t.note,state?.missions[t.missionId]?.name,state?.projects[t.projectId]?.name));
  const attentionItems = section==='projects' ? tasks.filter(t=>visibleProjects.some(p=>p.id===t.projectId)) : section==='missions' ? tasks.filter(t=>visibleMissions.some(m=>m.id===t.missionId)) : visibleTasks;
  const percent = (items:Task[]) => {const included=items.filter(t=>t.status!=='cancelled');return included.length ? Math.round(included.filter(t=>t.status==='completed').length/included.length*100) : 0;};
  const setAgent = (value:string) => setFilters({agent:value,...(value!=='all' && profileFilter!=='all' && state?.profiles[profileFilter]?.agent!==value ? {profile:'all'} : {})});
  const taskRow = (t:Task) => <a class="task-row" href={href('tasks',t.id)} key={t.id}><div class="task-row-main"><span class={`task-status ${t.status}`} /><div><strong>{t.title}</strong><span>{state?.projects[t.projectId]?.name} / {state?.missions[t.missionId]?.name} · {agentName(t.updatedBy)} <StaleTag item={t} minutes={preferences.staleMinutes} /></span></div></div><Badge status={t.status} /><Progress value={taskPercent(t)} /><span class="row-time">{ago(t.updatedAt)}</span><span class="row-arrow">↗</span></a>;
  const missionRow = (m:Mission) => <a class="project-row" key={m.id} href={href('missions',m.id)}><div class="project-row-main"><strong>{m.name} <StaleTag item={m} minutes={preferences.staleMinutes} /></strong><span>{state?.projects[m.projectId]?.name}</span>{m.description && <p>{m.description}</p>}</div><Badge status={m.status} /><Progress value={percent(missionTasks(m.id))} caption={`${missionTasks(m.id).filter(t=>t.status==='completed').length} / ${missionTasks(m.id).filter(t=>t.status!=='cancelled').length} tasks`} /><span class="project-row-agents">{missionAgents(m.id).map(agentName).join(' · ') || 'External'}</span><span class="row-time">{ago(m.updatedAt)}</span><span class="row-arrow">↗</span></a>;
  const projectRow = (p:Project) => {
    const items=projectMissions(p.id),running=items.filter(m=>m.status==='running').length;
    const attention=state ? attentionTasks(state,projectTasks(p.id),health,preferences.staleMinutes).length : 0;
    return <a class="project-row" key={p.id} href={href('projects',p.id)}><div class="project-row-main"><strong>{p.name}</strong><span>{items.length} missions · {projectTasks(p.id).length} tasks{attention ? ` · ${attention} need attention` : ''}</span>{p.description && <p>{p.description}</p>}</div><Badge status="active" /><div class="project-mission-count"><strong>{running} running</strong><span>{items.filter(m=>m.status==='completed').length} completed missions</span></div><span class="project-row-agents">{projectAgents(p.id).map(agentName).join(' · ') || 'External'}</span><span class="row-time">{ago(p.updatedAt)}</span><span class="row-arrow">↗</span></a>;
  };
  const missionSections = (items:Mission[], filteredStatus='all') => <div class="project-sections">{['running','planned','blocked','completed','failed','cancelled'].filter(s=>(filteredStatus==='all' || filteredStatus===s) && (!['planned','blocked'].includes(s) || items.some(m=>m.status===s) || filteredStatus===s)).map(s=><StatusSection key={s} status={s} kind="missions" items={items.filter(m=>m.status===s)} limit={s==='running' ? 10 : 5} row={missionRow} />)}</div>;
  const activity = (items:Activity[]) => <div class="activity">{items.length ? items.slice(-40).reverse().map(e=><div key={e.seq}><span class="activity-dot" /><div><strong>{e.type.startsWith('task.') ? e.type==='task.removed' ? 'Task removed' : `${e.type==='task.created' ? 'Created · ' : ''}${labels[String(e.payload.status)] || 'Updated'}` : e.type.replace(e.type.startsWith('project.') && e.payload.status!=='active' ? 'project.' : 'never.','mission.').replaceAll('.',' ')}</strong>{e.payload.note && <p>{String(e.payload.note)}</p>}<span>{new Date(e.timestamp).toLocaleString()}</span></div></div>) : <p class="muted">No recorded activity yet.</p>}</div>;
  const detail=Boolean(routeId);
  const current=task || mission || project;
  const detailValid=project && current && (section!=='tasks' || task) && (section!=='missions' || mission);
  const relevantSessions = task ? sessions.filter(s=>s.id===task.updatedBySessionId) : mission ? sessions.filter(s=>s.missionId===mission.id || s.missionIds?.includes(mission.id)) : project ? sessions.filter(s=>s.projectId===project.id || s.projectIds?.includes(project.id)) : [];
  const navSection = section==='projects' && mission ? 'missions' : section;
  const picker=(title:string,value:string,options:Array<{id:string;name:string}>,onChange:(value:string)=>void) => <label class="filter-label project-picker"><span>{title}</span><select aria-label={`Filter by ${title.toLowerCase()}`} value={value} onChange={e=>onChange(e.currentTarget.value)}><option value="all">All {title.toLowerCase()}s</option>{[...options].sort((a,b)=>a.name.localeCompare(b.name)).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>;
  const statusOptions=section==='projects' ? ['active'] : section==='missions' ? ['running','planned','blocked','completed','failed','cancelled'] : ['todo','in_progress','blocked','completed','failed','cancelled'];

  return <div class="shell"><header class="topbar"><a class="brand" href={href('projects')}><span class="brand-mark" />Angine</a><nav aria-label="Main navigation">{['projects','missions','tasks','board','agents','archive','settings'].map(name=><a key={name} href={href(name)} class={navSection===name ? 'active' : ''} aria-current={navSection===name ? 'page' : undefined}>{name==='settings' ? 'Preferences' : name[0].toUpperCase()+name.slice(1)}</a>)}</nav><div class="connection"><span class={connected ? 'live-dot' : 'offline-dot'} />{connected ? 'Dashboard live' : 'Dashboard reconnecting'}</div></header><main class={detail ? 'detail-page' : 'overview-page'}>
    <VersionNotice compatibility={compatibility} />
    {error && <div class="error-banner" role="alert">{error}<button class="text-button" onClick={()=>setError('')}>Dismiss</button></div>}
    {!state ? <div class="empty"><h2>Loading your work…</h2></div> : section==='agents' ? <AgentsView health={health} compatibility={compatibility} state={state} profileId={routeId || undefined} mutate={mutate} taskRow={taskRow} /> : section==='archive' ? <ArchiveView state={state} mutate={mutate} /> : section==='settings' ? <SettingsView preferences={preferences} setPreferences={setPreferences} resetFilters={resetAllFilters} /> : detail ? detailValid && project && current ? <>
      <nav class="breadcrumbs" aria-label="Breadcrumb"><a href={href('projects')}>Projects</a><span>/</span>{mission ? <><a href={href('projects',project.id)}>{project.name}</a><span>/</span>{task ? <><a href={href('missions',mission.id)}>{mission.name}</a><span>/</span><span>Task</span></> : <span>{mission.name}</span>}</> : <span>{project.name}</span>}</nav>
      <div class="page-heading detail-heading"><div><div class="overline">{task ? 'TASK' : mission ? 'MISSION' : 'PROJECT'} <span>{current.key}</span></div><h1>{task?.title || mission?.name || project.name}</h1><div class="heading-meta"><Badge status={current.status} /><span>Updated {ago(current.updatedAt)}</span>{mission && <StaleTag item={task || mission} minutes={preferences.staleMinutes} />}{!task && <button class="secondary-button" onClick={()=>mutate('archive',{projectId:current.id,archived:!('archivedAt' in current && current.archivedAt)})}>{'archivedAt' in current && current.archivedAt ? 'Restore' : 'Archive'} {mission ? 'mission' : 'project'}</button>}{(project.archivedAt || mission?.archivedAt) && <span>Archived</span>}</div></div>{mission ? <div class="heading-progress"><Progress value={task ? taskPercent(task) : percent(missionTasks(mission.id))} caption={task ? 'Task progress' : 'Tasks completed'} /></div> : <div class="project-overview-counts"><strong>{projectMissions(project.id).length}</strong><span>missions</span><strong>{projectTasks(project.id).length}</strong><span>tasks</span></div>}</div>
      <div class="detail-grid"><div class="detail-main"><section class="panel"><h2>Overview</h2>{task && <p class="report-provenance">Status reported by {agentName(task.updatedBy)} · {new Date(task.updatedAt).toLocaleString()}<span>Completion is agent reported; test results are not independently verified.</span></p>}<p class="description">{current.description || (mission ? 'No description provided.' : 'Missions collect the goals and tasks for this project. Completing a mission does not close the project.')}</p>{task?.note && <div class="latest-update"><div class="overline">LATEST UPDATE</div><p>{task.note}</p></div>}</section>
      {!mission && <section><div class="panel-heading"><h2>Missions</h2><span>{projectMissions(project.id).length}</span></div>{missionSections(project.archivedAt ? allMissions.filter(m=>m.projectId===project.id) : projectMissions(project.id))}</section>}
      {task && <TaskWorkflow key={task.id} task={task} state={state} mutate={mutate} />}
      {mission && (!task || missionTasks(mission.id).some(t=>t.parentKey===task.key)) && <section class="panel"><div class="panel-heading"><h2>{task ? 'Subtasks' : 'Tasks'}</h2><span>{(task ? missionTasks(mission.id).filter(t=>t.parentKey===task.key) : missionTasks(mission.id)).length}</span></div><div class="task-table">{(task ? missionTasks(mission.id).filter(t=>t.parentKey===task.key) : missionTasks(mission.id)).map(taskRow)}</div></section>}
      <section class="panel"><h2>Activity</h2>{activity(events.filter(e=>task ? e.taskId===task.id : !e.type.startsWith('session.')))}</section></div><div class="detail-info"><section class="panel"><h2>Details</h2><dl><dt>Project</dt><dd><a href={href('projects',project.id)}>{project.name}</a></dd>{mission && <><dt>Mission</dt><dd><a href={href('missions',mission.id)}>{mission.name}</a></dd></>}<dt>Workspace</dt><dd>{state.workspaces[project.workspaceId]?.path}</dd><dt>Created</dt><dd>{new Date(current.createdAt).toLocaleString()}</dd>{task?.parentKey && <><dt>Parent task</dt><dd>{missionTasks(task.missionId).find(t=>t.key===task.parentKey) ? <a href={href('tasks',missionTasks(task.missionId).find(t=>t.key===task.parentKey)!.id)}>{task.parentKey}</a> : task.parentKey}</dd></>}</dl></section><section class="panel"><h2>{task ? 'Reporting agent' : 'Reporter sessions'}</h2>{relevantSessions.map(s=><Reporter key={s.id} session={s} state={state} health={health} />)}{!relevantSessions.length && <p class="muted">No reporter session available for this item.</p>}</section></div></div>
    </> : <div class="empty"><h2>This page is unavailable</h2><a href={href('projects')}>Return to projects</a></div> : <>
      <div class="overview-toolbar"><div class="stats">{section==='projects' ? <><div><strong>{visibleProjects.length}</strong><span>Projects</span></div><div><strong>{missions.filter(m=>visibleProjects.some(p=>p.id===m.projectId) && m.status==='running').length}</strong><span>Running missions</span></div><div><strong>{missions.filter(m=>visibleProjects.some(p=>p.id===m.projectId) && m.status==='completed').length}</strong><span>Completed missions</span></div></> : ['all',section==='missions' ? 'running' : 'in_progress','blocked','completed','failed','cancelled'].map(key=><div key={key}><strong>{section==='missions' ? key==='all' ? visibleMissions.length : visibleMissions.filter(m=>m.status===key).length : key==='all' ? visibleTasks.length : visibleTasks.filter(t=>t.status===key).length}</strong><span>{key==='all' ? 'Total' : labels[key]}</span></div>)}</div>
      <div class="toolbar"><label class="search"><span aria-hidden="true">⌕</span><input aria-label="Search work" placeholder="Search projects, missions, tasks…" value={query} onInput={e=>setFilters({query:e.currentTarget.value})} /></label><label class="filter-label"><span>Agent</span><select aria-label="Filter by agent" value={agent} onChange={e=>setAgent(e.currentTarget.value)}><option value="all">All agents</option>{agents.map(a=><option key={a} value={a}>{agentName(a)}</option>)}</select></label>{section!=='projects' && picker('Project',projectFilter,projectOptions,value=>setFilters({project:value,mission:'all'}))}{['tasks','board'].includes(section) && picker('Mission',missionFilter,missionOptions,value=>setFilters({mission:value}))}{section!=='projects' && <label class="filter-label"><span>Status</span><select aria-label="Filter by status" value={status} onChange={e=>setFilters({status:e.currentTarget.value})}><option value="all">All statuses</option>{statusOptions.map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label>}<details class="more-filters"><summary>More filters{profileFilter!=='all' || staleOnly ? ' · On' : ''}</summary><div class="extra-filters"><label class="filter-label"><span>Profile</span><select aria-label="Filter by profile" value={profileFilter} onChange={e=>setFilters({profile:e.currentTarget.value})}><option value="all">All profiles</option>{Object.values(state.profiles).filter(p=>agent==='all' || p.agent===agent).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label class="filter-label"><span>Activity</span><select aria-label="Filter stale activity" value={staleOnly ? 'stale' : 'all'} onChange={e=>setFilters({staleOnly:e.currentTarget.value==='stale'})}><option value="all">All activity</option><option value="stale">Stale only</option></select></label></div></details>{(query || agent!=='all' || status!=='all' || profileFilter!=='all' || staleOnly || projectFilter!=='all' || missionFilter!=='all') && <button class="clear-filters" onClick={resetFilters}>Reset</button>}</div></div>
      <AttentionSummary state={state} tasks={attentionItems} health={health} staleMinutes={preferences.staleMinutes} />
      {section==='board' ? <div class="board" ref={board} style={boardHeight ? {height:`${boardHeight}px`} : undefined}>{['todo','in_progress','blocked','completed','failed','cancelled'].map(s=><section class="board-column" key={s}><div class="column-heading"><span class={`task-status ${s}`} /><h2>{labels[s]}</h2><span>{visibleTasks.filter(t=>t.status===s).length}</span></div><div class="board-stack" tabIndex={0} role="region" aria-label={`${labels[s]} tasks, scroll this column`}>{visibleTasks.filter(t=>t.status===s).map(t=><a class="board-card" key={t.id} href={href('tasks',t.id)}><span class="board-project">{state.projects[t.projectId]?.name} / {state.missions[t.missionId]?.name}</span><strong>{t.title} <StaleTag item={t} minutes={preferences.staleMinutes} /></strong>{t.blocker?.nextStep && <p class="blocker-next">Next: {t.blocker.nextStep}</p>}{t.note && <p>{t.note}</p>}<Progress value={taskPercent(t)} /><div class="board-footer"><span>{agentName(t.updatedBy)}</span><span>{ago(t.updatedAt)}</span></div></a>)}{!visibleTasks.some(t=>t.status===s) && <div class="column-empty">No tasks</div>}</div></section>)}</div> : section==='tasks' ? <div class="project-sections">{['in_progress','todo','blocked','completed','failed','cancelled'].filter(s=>(status==='all' || status===s) && (!['todo','blocked'].includes(s) || visibleTasks.some(t=>t.status===s) || status===s)).map(s=><StatusSection key={s} status={s} kind="tasks" items={visibleTasks.filter(t=>t.status===s)} limit={s==='in_progress' ? 10 : 5} row={taskRow} />)}</div> : section==='missions' ? missionSections(visibleMissions,status) : <div class="project-list panel"><div class="project-list-head" aria-hidden="true"><span>Project</span><span>Status</span><span>Missions</span><span>Agents</span><span>Updated</span><span /></div>{visibleProjects.map(projectRow)}{!visibleProjects.length && <div class="status-section-empty">No projects match these filters.</div>}</div>}
    </>}
    <footer class="footer"><span>Angine</span><span>Stored locally on this device</span></footer>
  </main></div>;
}
render(<App />,document.getElementById('app')!);
