import type { State } from './types.js';
import { effectiveColor } from './colors.js';
export type GraphPosition = {x:number;y:number};
export type GraphNodeData = {label:string;kind:'Project'|'Mission'|'Task';status:string;color:string;href:string;summary:string};
export type GraphFilters = {project:string;agent:string;status:string;query:string};
export function buildWorkGraph(state:State, filters:GraphFilters, positions:Record<string,GraphPosition>={}) {
 const nodes:Array<{id:string;type:'work';position:GraphPosition;data:GraphNodeData}>=[];
 const edges:Array<{id:string;source:string;target:string;type:'smoothstep';style:{stroke:string;strokeWidth:number}}>=[];
 const used=[...Object.values(positions)];let row=0;
 const query=filters.query.trim().toLowerCase();
 const matches=(...values:(string|undefined)[])=>values.join(' ').toLowerCase().includes(query);
 const add=(id:string,x:number,y:number,data:GraphNodeData)=>{
  let position=positions[id];
  if(!position){position={x,y};while(used.some(p=>Math.abs(p.x-position.x)<320 && Math.abs(p.y-position.y)<145))position={x,y:position.y+170};used.push(position);}
  nodes.push({id,type:'work',position,data});
 };
 const edge=(source:string,target:string,color:string)=>edges.push({id:`${source}:${target}`,source,target,type:'smoothstep',style:{stroke:color,strokeWidth:1.5}});
 for(const p of Object.values(state.projects).filter(p=>!p.archivedAt && (filters.project==='all'||p.id===filters.project)).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id))) {
  const start=row;const children=[];
  for(const m of Object.values(state.missions).filter(m=>m.projectId===p.id&&!m.archivedAt).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id))) {
   const allTasks=Object.values(state.tasks).filter(t=>t.missionId===m.id);
   const tasks=allTasks.filter(t=>(filters.agent==='all'||t.updatedBy===filters.agent)&&(filters.status==='all'||t.status===filters.status)&&matches(p.name,m.name,t.title,t.note)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
   const sessionMatch=filters.agent==='all'||Object.values(state.sessions).some(s=>s.agent===filters.agent&&(s.missionId===m.id||s.missionIds?.includes(m.id)));
   if(!tasks.length && !(allTasks.length===0 && filters.status==='all' && sessionMatch && matches(p.name,m.name)))continue;
   const missionStart=row;const color=effectiveColor(state,p.id,m.id);
   for(const t of tasks){add(t.id,800,row*170,{label:t.title,kind:'Task',status:t.status,color,href:`#/tasks/${encodeURIComponent(t.id)}`,summary:`${t.updatedBy} · ${t.status==='completed'?'100%':t.status==='todo'?'0%':t.progress!==undefined?`${t.progress}%`:'Progress not reported'}`});edge(m.id,t.id,color);row++;}
   if(!tasks.length)row++;
   const y=(missionStart+row-1)*85;
   add(m.id,400,y,{label:m.name,kind:'Mission',status:m.status,color,href:`#/missions/${encodeURIComponent(m.id)}`,summary:`${tasks.length} ${filters.status==='all'&&filters.agent==='all'&&!query?'':'matching '}tasks`});
   children.push(m.id);edge(p.id,m.id,color);row+=.35;
  }
  if(!children.length && !(filters.agent==='all'&&filters.status==='all'&&matches(p.name)&&!Object.values(state.missions).some(m=>m.projectId===p.id&&!m.archivedAt)))continue;
  if(!children.length)row++;
  add(p.id,0,(start+row-1)*85,{label:p.name,kind:'Project',status:'active',color:effectiveColor(state,p.id),href:`#/projects/${encodeURIComponent(p.id)}`,summary:`${children.length} missions`});row++;
 }
 return {nodes,edges};
}
