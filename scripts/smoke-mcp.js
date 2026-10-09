import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'angine-smoke', version: '0.1.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('../dist/bin/angine.js', import.meta.url).pathname, 'mcp', '--agent', process.argv[2] || 'codex'] });
await client.connect(transport);
try {
  const tools = await client.listTools();
  if (tools.tools.map(t => t.name).sort().join(',') !== 'check_connection,sync_project,update_tasks') throw new Error('Unexpected MCP tools');
  const connection = await client.callTool({name:'check_connection',arguments:{}});
  if(connection.isError) throw new Error('Reporter connection check failed');
  const result = await client.callTool({ name: 'sync_project', arguments: {
    project: { key: 'mcp-smoke', name: 'MCP smoke test', workspacePath: process.cwd() },
    tasks: [{ key: 'check', title: 'Verify reporter', status: 'in_progress' }]
  } });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  console.log(JSON.stringify(result.content));
} finally { await client.close(); }
