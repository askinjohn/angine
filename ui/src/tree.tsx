import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, applyNodeChanges, type Node, type NodeProps, type NodeChange, type ReactFlowInstance } from '@xyflow/react';
import type { State } from '../../src/types';
import { buildWorkGraph, type GraphNodeData, type GraphPosition } from '../../src/graph';
import type { Filters } from './workflow';
import '@xyflow/react/dist/style.css';
import './tree.css';

type WorkNode = Node<GraphNodeData & {toggle?:()=>void},'work'>;
const labels:Record<string,string>={active:'Active',planned:'Planned',running:'Running',todo:'To do',in_progress:'In progress',blocked:'Blocked',completed:'Completed',failed:'Failed',cancelled:'Cancelled'};
const positionKey='angine-graph-manual-positions-compact-v5';
function savedPositions():Record<string,GraphPosition>{try{const data=JSON.parse(localStorage.getItem(positionKey)||'{}');return Object.fromEntries(Object.entries(data).filter(([,p]:[string,any])=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y))) as Record<string,GraphPosition>;}catch{return {};}}
function WorkCard({data}:NodeProps<WorkNode>){return <div class="graph-card" style={{borderInlineStart:`4px solid ${data.color}`}}><Handle type="target" position={Position.Top} isConnectable={false}/><div class="graph-card-top"><span>{data.kind}</span><span class={`badge ${data.status}`}>{labels[data.status]||data.status}</span></div><a class="nodrag" href={data.href} title={data.label}>{data.label}<span aria-hidden="true"> ↗</span></a><p>{data.summary}</p>{Boolean(data.childCount) && data.toggle && <button class="nodrag graph-expand" aria-expanded={data.expanded} onClick={data.toggle}>{data.expanded?'− Hide':'+ Show'} {data.kind==='Project'?'missions':'tasks'}</button>}<Handle type="source" position={Position.Bottom} isConnectable={false}/></div>;}
const nodeTypes={work:WorkCard};
export function TreeView({state,filters,setFilters,reset}:{state:State;filters:Filters;setFilters:(patch:Partial<Filters>)=>void;reset:()=>void}){
 const dragged=useRef(savedPositions());const positions=useRef({...dragged.current});const [nodes,setNodes]=useState<WorkNode[]>([]);const [flow,setFlow]=useState<ReactFlowInstance<WorkNode>|null>(null);
 const [layout,setLayout]=useState(0);
 const focusProject=useRef('');
 const [expandedProjects,setExpandedProjects]=useState<string[]>([]);
 const [expandedMissions,setExpandedMissions]=useState<string[]>([]);
 const filtering=Boolean(filters.query||filters.project!=='all'||filters.agent!=='all'||filters.status!=='all');
 const toggle=(id:string,kind:string)=>{
  focusProject.current=kind==='Project'?id:state.missions[id]?.projectId||'';
  const setter=kind==='Project'?setExpandedProjects:setExpandedMissions;
  setter(previous=>previous.includes(id)?previous.filter(value=>value!==id):[...previous,id]);
  positions.current={...dragged.current};setNodes([]);setLayout(n=>n+1);
 };
 const overview=()=>{focusProject.current='';dragged.current={};setExpandedProjects([]);setExpandedMissions([]);positions.current={};setNodes([]);setLayout(n=>n+1);reset();};
 const focused=useRef('');
 const focusStart=()=>{
  const first=nodes.find(n=>n.id===focusProject.current)||nodes.find(n=>n.data.kind==='Project')||nodes[0];
  const width=document.querySelector('.graph-canvas')?.clientWidth||1000;
  if(!expandedProjects.length&&!filtering){void flow?.fitView({padding:.15,minZoom:.65,maxZoom:.9,duration:250});return;}
  if(first)void flow?.setViewport({x:width/2-(first.position.x+110)*.9,y:45-first.position.y*.9,zoom:.9},{duration:250});
 };
 const readableFit=()=>void flow?.fitView({padding:.2,minZoom:.65,maxZoom:1,duration:250});
 useEffect(()=>{
  const signature=JSON.stringify([filters.project,filters.agent,filters.status,filters.query,layout,expandedProjects,expandedMissions]);
  if(flow&&nodes.length&&focused.current!==signature){focused.current=signature;requestAnimationFrame(focusStart);}
  if(!nodes.length)focused.current='';
 },[flow,nodes.length,filters.project,filters.agent,filters.status,filters.query,layout,expandedProjects,expandedMissions]);
 const graph=useMemo(()=>buildWorkGraph(state,filters,positions.current,{projects:filtering?Object.keys(state.projects):expandedProjects,missions:filtering?Object.keys(state.missions):expandedMissions}),[state,filters.project,filters.agent,filters.status,filters.query,layout,expandedProjects,expandedMissions]);
 const persist=()=>{try{localStorage.setItem(positionKey,JSON.stringify(dragged.current));}catch{}};
 useEffect(()=>{
  setNodes(previous=>{const old=new Map(previous.map(n=>[n.id,n]));return graph.nodes.map(n=>{const position=old.get(n.id)?.position||n.position;positions.current[n.id]=position;return {...old.get(n.id),...n,position,data:{...n.data,toggle:filtering?undefined:()=>toggle(n.id,n.data.kind)}};});});
 },[graph]);
 useEffect(()=>{for(const node of nodes)positions.current[node.id]=node.position;persist();},[nodes]);
 const projects=Object.values(state.projects).filter(p=>!p.archivedAt).sort((a,b)=>a.name.localeCompare(b.name));
 const agents=[...new Set([...Object.values(state.sessions).map(s=>s.agent),...Object.values(state.tasks).map(t=>t.updatedBy)])].sort();
 const hasFilters=Boolean(filters.query||filters.project!=='all'||filters.agent!=='all'||filters.status!=='all');
 const arrange=()=>{dragged.current={};positions.current={};try{localStorage.removeItem(positionKey);}catch{}setNodes([]);setLayout(n=>n+1);};
 return <section class="graph-view"><div class="graph-heading"><div><h1>Work graph</h1><p>Projects → Missions → Tasks · Live from agent reports</p></div><div class="graph-actions"><button class="secondary-button" onClick={readableFit}>Fit view</button><button class="secondary-button" onClick={overview}>All projects</button><button class="secondary-button" onClick={()=>{positions.current={...dragged.current};setNodes([]);setExpandedProjects(Object.keys(state.projects));setExpandedMissions(Object.keys(state.missions));setLayout(n=>n+1);}}>Expand all</button><button class="secondary-button" onClick={arrange}>Auto arrange</button></div></div><div class="toolbar graph-toolbar"><label class="search"><span aria-hidden="true">⌕</span><input aria-label="Search graph" placeholder="Search projects, missions, tasks…" value={filters.query} onInput={e=>setFilters({query:e.currentTarget.value})}/></label><label class="filter-label"><span>Project</span><select aria-label="Graph project" value={filters.project} onChange={e=>setFilters({project:e.currentTarget.value})}><option value="all">All projects</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label class="filter-label"><span>Agent</span><select aria-label="Graph agent" value={filters.agent} onChange={e=>setFilters({agent:e.currentTarget.value})}><option value="all">All agents</option>{agents.map(a=><option key={a} value={a}>{a}</option>)}</select></label><label class="filter-label"><span>Task status</span><select aria-label="Graph task status" value={filters.status} onChange={e=>setFilters({status:e.currentTarget.value})}><option value="all">All statuses</option>{['todo','in_progress','blocked','completed','failed','cancelled'].map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label>{hasFilters&&<button class="clear-filters" onClick={reset}>Reset</button>}</div><div class="graph-meta"><span>{graph.counts.projects} projects · {graph.counts.missions} missions · {graph.counts.tasks} tasks · {graph.nodes.length} nodes shown</span><span>Show missions and tasks to explore · Drag to arrange · Scroll to zoom</span></div><div class="graph-canvas" role="region" aria-label="Interactive project mission and task graph">{graph.nodes.length?<ReactFlow<WorkNode> nodes={nodes} edges={graph.edges} nodeTypes={nodeTypes} onNodesChange={(changes:NodeChange<WorkNode>[])=>setNodes(current=>applyNodeChanges(changes,current))} onNodeDragStop={(_event:unknown,node:WorkNode)=>{positions.current[node.id]=node.position;dragged.current[node.id]=node.position;persist();}} onInit={setFlow} defaultViewport={{x:40,y:40,zoom:.9}} minZoom={.3} maxZoom={2} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}><Background gap={22} size={1}/><Controls showInteractive={false} showFitView={false}/><MiniMap pannable zoomable nodeColor={n=>String(n.data.color||'#94a3b8')}/></ReactFlow>:<div class="empty"><h2>{hasFilters?'No work matches these filters':'Your graph will grow here'}</h2><p>{hasFilters?'Try another project, agent, or task status.':'Ask a connected agent to report a mission. Its project and tasks will appear automatically.'}</p>{hasFilters?<button class="secondary-button" onClick={reset}>Clear filters</button>:<a href="#/agents">Check agent connections</a>}</div>}</div></section>;
}
