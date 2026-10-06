import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ensureDaemon, request } from './ipc.js';
import { agentName } from './model.js';
import { nativeReporterIdentity } from './identity.js';
import { protocolVersion, serverVersion } from './health.js';
import type { SyncProjectInput, UpdateTasksInput } from './types.js';

const blocker = z.object({ reason: z.string().max(500), nextStep: z.string().max(500).optional(), owner: z.string().max(160).optional() }).nullable().optional();
const relatedTaskKeys = z.array(z.string().max(160)).max(20).optional();
const taskStatus = z.enum(['todo', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled']);
const sessionKey = crypto.randomUUID();
const profileFlag = process.argv.indexOf('--profile');
const agentFlag = process.argv.indexOf('--agent');
const agent = agentName(agentFlag >= 0 ? process.argv[agentFlag + 1] : (process.env.BEACON_AGENT || 'external'));
const server = new McpServer({ name: 'angine', version: serverVersion });
const connectionInput = () => ({ ...nativeReporterIdentity(agent), reporterId:sessionKey, agent, version:serverVersion, protocolVersion, ...(profileFlag >= 0 ? {profileKey:process.argv[profileFlag + 1]} : {}) });
let heartbeat: ReturnType<typeof setInterval> | undefined;
let closing = false;
const ping = async () => { try { await request('reporter_ping',connectionInput()); } catch { /* Connection diagnostics must not interrupt the agent. */ } };
server.server.oninitialized = () => {
  void (async () => { try { await ensureDaemon(); if(!closing) await ping(); } catch { /* Report calls can try starting the server later. */ } })();
  heartbeat = setInterval(() => { void ping(); },25000);
  heartbeat.unref();
};
server.server.onclose = () => { closing = true; clearInterval(heartbeat); void request('reporter_close',{reporterId:sessionKey},500).catch(() => {}); };
const reporterIdentity = {
  profileKey: z.string().max(160).optional(),
  sourceSessionId: z.string().max(160).optional(),
  agentId: z.string().max(160).optional(),
  parentAgentId: z.string().max(160).optional(),
  accountLabel: z.string().max(160).optional()
};
async function report(method: 'sync_project' | 'update_tasks', input: SyncProjectInput | UpdateTasksInput) {
  try { await ensureDaemon(); await ping(); return { content: [{ type: 'text' as const, text: JSON.stringify(await request(method, { ...nativeReporterIdentity(agent), ...(profileFlag >= 0 ? { profileKey: process.argv[profileFlag + 1] } : {}), ...input, agent, sessionKey, reporterId:sessionKey })) }] }; }
  catch (error) { return { isError: true, content: [{ type: 'text' as const, text: `Angine reporting unavailable: ${(error as Error).message}. Continue implementation; do not repeatedly retry.` }] }; }
}
server.registerTool('check_connection', {
  description:'Check this Angine reporter’s connection, configured profile, and reporting health. Does not create projects or change task statuses.', inputSchema:{}
}, async () => {
  try { await ensureDaemon(); const reporter = await request('reporter_ping',connectionInput()); const health = await request<{serverVersion:string;protocolVersion:number}>('reporter_health'); return {content:[{type:'text' as const,text:JSON.stringify({serverVersion:health.serverVersion,protocolVersion:health.protocolVersion,reporter})}]}; }
  catch { return {isError:true,content:[{type:'text' as const,text:'Angine connection unavailable. Run angine restart and restart this agent session to load updated reporter tools.'}]}; }
});
server.registerTool('sync_project', {
  description: 'Register a mission within a project or reconcile its plan. Project names identify the product; mission names identify the goal. Legacy inputs without a mission remain supported. Send only short project/task metadata. Use stable project and task keys. Do not send prompts, code, commands, secrets, or tool output.',
  inputSchema: {
    ...reporterIdentity,
    mission: z.object({key:z.string().max(160).optional(),name:z.string().max(160),description:z.string().max(2048).optional()}).optional(),
    project: z.object({ key: z.string().max(160).optional(), name: z.string().max(160), description: z.string().max(2048).optional(), workspacePath: z.string() }),
    tasks: z.array(z.object({ key: z.string().max(160), title: z.string().max(240), description: z.string().max(2048).optional(), status: taskStatus, parentKey: z.string().max(160).optional(), progress: z.number().min(0).max(100).optional(), blocker, relatedTaskKeys })).max(100),
    removedTaskKeys: z.array(z.string().max(160)).optional()
  }
}, input => report('sync_project', input));
server.registerTool('update_tasks', {
  description: 'Batch meaningful task status transitions. Send only status and short metadata notes. Do not send prompts, code, commands, secrets, or tool output.',
  inputSchema: {
    ...reporterIdentity,
    projectId: z.string().optional(),
    missionId: z.string().optional(),
    updates: z.array(z.object({ taskKey: z.string(), status: taskStatus, note: z.string().max(500).optional(), progress: z.number().min(0).max(100).optional(), blocker, relatedTaskKeys })).min(1).max(100)
  }
}, input => report('update_tasks', input));
await server.connect(new StdioServerTransport());
