import type { State } from './types.js';
import { effectiveColor } from './colors.js';
export type GraphPosition = {x:number;y:number};
export type GraphNodeData = {label:string;kind:'Project'|'Mission'|'Task';status:string;color:string;href:string;summary:string};
export type GraphFilters = {project:string;agent:string;status:string;query:string};
export function buildWorkGraph(state:State, filters:GraphFilters, positions:Record<string,GraphPosition>={}) {
 const nodes:Array<{id:string;type:'work';position:GraphPosition;data:GraphNodeData}>=[];
 const edges:Array<{id:string;source:string;target:string;type:'smoothstep';style:{stroke:string;strokeWidth:number}}>=[];
 let row=0;
 const query=filters.query.trim().toLowerCase();
 const matches=(...values:(string|undefined)[])=>values.join(' ').toLowerCase().includes(query);
 const add=(id:string,x:number,y:number,data:GraphNodeData)=>nodes.push({id,type:'work',position:{x,y},data});
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
 // Compact top-down project bands: two mission columns, two task columns per mission.
 let top=0;
 const byId=new Map(nodes.map(n=>[n.id,n]));
 const children=(id:string)=>edges.filter(e=>e.source===id).map(e=>byId.get(e.target)!);
 for(const project of nodes.filter(n=>n.data.kind==='Project')) {
  const missions=children(project.id);
  const columns=Math.min(2,Math.max(1,missions.length));
  project.position={x:(columns*660-320)/2,y:top};
  let missionTop=top+230;
  for(let index=0;index<missions.length;index+=2) {
   const band=missions.slice(index,index+2);let maxRows=0;
   for(const [column,mission] of band.entries()) {
    const tasks=children(mission.id);const taskColumns=Math.min(2,Math.max(1,tasks.length));
    const left=column*660;
    mission.position={x:left+(taskColumns-1)*160,y:missionTop};
    for(const [i,task] of tasks.entries())task.position={x:left+(i%2)*320,y:missionTop+220+Math.floor(i/2)*170};
    maxRows=Math.max(maxRows,Math.ceil(tasks.length/2));
   }
   missionTop+=maxRows ? 220+maxRows*170+90 : 230;
  }
  top=Math.max(top+400,missionTop+140);
 }
 const occupied=[...Object.values(positions)];
 for(const node of nodes) {
  if(positions[node.id])node.position=positions[node.id];
  else {
   while(occupied.some(p=>Math.abs(p.x-node.position.x)<300&&Math.abs(p.y-node.position.y)<145))node.position={x:node.position.x,y:node.position.y+170};
   occupied.push(node.position);
  }
 }
 return {nodes,edges};
}
