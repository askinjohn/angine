import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkGraph} from '../dist/src/graph.js';
const filters={project:'all',agent:'all',status:'all',query:''};
const state={projects:{p:{id:'p',name:'Product',color:'#123456'},hidden:{id:'hidden',name:'Archived',archivedAt:'date'}},missions:{m:{id:'m',projectId:'p',name:'Checkout',color:'#654321'},empty:{id:'empty',projectId:'p',name:'Docs'},hidden:{id:'hidden',projectId:'p',name:'Old',archivedAt:'date'}},tasks:{t:{id:'t',missionId:'m',projectId:'p',title:'Verify payment',updatedBy:'codex',status:'in_progress',progress:45,createdAt:'1'},other:{id:'other',missionId:'m',projectId:'p',title:'Implementation',updatedBy:'claude',status:'completed',createdAt:'2'}},sessions:{},workspaces:{},profiles:{},seq:0,schemaVersion:2};
test('graph connects canonical hierarchy, excludes archives and uses inherited colors',()=>{
 const graph=buildWorkGraph(state,filters);
 assert.deepEqual(new Set(graph.nodes.map(n=>n.id)),new Set(['p','m','empty','t','other']));
 assert.deepEqual(graph.edges.map(e=>[e.source,e.target]),[['m','t'],['m','other'],['p','m'],['p','empty']]);
 assert.equal(graph.nodes.find(n=>n.id==='t').data.color,'#654321');assert.equal(graph.nodes.find(n=>n.id==='empty').data.color,'#123456');
 const positions=Object.fromEntries(graph.nodes.map(n=>[n.id,n.position]));
 const updated=structuredClone(state);updated.tasks.new={...state.tasks.t,id:'new',title:'New task',createdAt:'3'};
 const next=buildWorkGraph(updated,filters,positions);
 for(const n of graph.nodes)assert.deepEqual(next.nodes.find(x=>x.id===n.id).position,n.position);
 const added=next.nodes.find(n=>n.id==='new');assert.ok(added);assert.ok(!Object.values(positions).some(p=>Math.abs(p.x-added.position.x)<320&&Math.abs(p.y-added.position.y)<145));
});
test('graph search and task filters keep parent context and do not show unrelated branches',()=>{
 assert.deepEqual(new Set(buildWorkGraph(state,{...filters,query:'payment'}).nodes.map(n=>n.id)),new Set(['p','m','t']));
 assert.deepEqual(new Set(buildWorkGraph(state,{...filters,agent:'claude',status:'completed'}).nodes.map(n=>n.id)),new Set(['p','m','other']));
 assert.equal(buildWorkGraph(state,{...filters,project:'missing'}).nodes.length,0);
 assert.equal(buildWorkGraph(state,{...filters,query:'unmatched'}).edges.length,0);
 const moved={t:{x:123,y:456}};assert.deepEqual(buildWorkGraph(state,filters,moved).nodes.find(n=>n.id==='t').position,moved.t);
});

 test('top-down layout puts missions below projects and tasks below missions without overlap',()=>{
 const graph=buildWorkGraph(state,filters);
 for(const edge of graph.edges){const parent=graph.nodes.find(n=>n.id===edge.source),child=graph.nodes.find(n=>n.id===edge.target);assert.ok(child.position.y>=parent.position.y+170);}
 for(let i=0;i<graph.nodes.length;i++)for(let j=i+1;j<graph.nodes.length;j++){const a=graph.nodes[i].position,b=graph.nodes[j].position;assert.ok(Math.abs(a.x-b.x)>=280||Math.abs(a.y-b.y)>=126);}
 });

 test('overview shows every project and expands branches without hiding siblings',()=>{
 const multiple=structuredClone(state);multiple.projects.second={...state.projects.p,id:'second',name:'Second'};
 const overview=buildWorkGraph(multiple,filters,{}, {projects:[],missions:[]});
 assert.deepEqual(new Set(overview.nodes.map(n=>n.id)),new Set(['p','second']));
 assert.ok(overview.nodes.every(n=>n.position.y===0));assert.equal(overview.edges.length,0);
 const missions=buildWorkGraph(multiple,filters,{}, {projects:['p'],missions:[]});
 assert.deepEqual(new Set(missions.nodes.map(n=>n.id)),new Set(['p','second','m','empty']));
 const tasks=buildWorkGraph(multiple,filters,{}, {projects:['p'],missions:['m']});
 assert.ok(tasks.nodes.some(n=>n.id==='second'));assert.ok(tasks.nodes.some(n=>n.id==='t'));
 });
