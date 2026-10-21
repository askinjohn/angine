import assert from 'node:assert/strict';
import test from 'node:test';
import { codexApprovalContent, parseAntigravityConfig } from '../dist/src/setup.js';

const approvals = `# angine:approvals:start
[mcp_servers.angine.tools.sync_project]
approval_mode = "approve"

[mcp_servers.angine.tools.update_tasks]
approval_mode = "approve"
# angine:approvals:end`;

test('Codex approval block preserves unrelated configuration and uninstalls cleanly', () => {
  const original = '[mcp_servers.other]\ncommand = "other"\n';
  const installed = codexApprovalContent(original, approvals);
  assert.match(installed, /mcp_servers\.other/);
  assert.equal(codexApprovalContent(installed, approvals), installed);
  assert.equal(codexApprovalContent(installed, '').trim(), original.trim());
});

test('Codex approval block refuses conflicting unmanaged tool policy', () => {
  const config = '[mcp_servers.angine.tools.sync_project]\napproval_mode = "prompt"\n';
  assert.throws(() => codexApprovalContent(config, approvals), /not managed/);
});

test('Codex setup repairs a single orphaned Angine approval end marker', () => {
  const config = '[mcp_servers.angine]\ncommand = "node"\n# angine:approvals:end\n';
  const repaired = codexApprovalContent(config, approvals);
  assert.equal(repaired.split('# angine:approvals:start').length - 1, 1);
  assert.equal(repaired.split('# angine:approvals:end').length - 1, 1);
  assert.match(repaired, /command = "node"/);
});

test('Antigravity setup treats an empty config file as an empty configuration', () => {
  assert.deepEqual(parseAntigravityConfig('', '/tmp/mcp_config.json'), { mcpServers: {} });
  assert.deepEqual(parseAntigravityConfig('{"theme":"dark"}', '/tmp/mcp_config.json'), { theme: 'dark', mcpServers: {} });
});

test('Antigravity setup identifies invalid config files', () => {
  assert.throws(() => parseAntigravityConfig('{', '/tmp/mcp_config.json'), /Invalid Antigravity MCP config: \/tmp\/mcp_config\.json/);
});
