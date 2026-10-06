import assert from 'node:assert/strict';
import test from 'node:test';
import { codexApprovalContent } from '../dist/src/setup.js';

const approvals = `# beacon:approvals:start
[mcp_servers.beacon.tools.sync_project]
approval_mode = "approve"

[mcp_servers.beacon.tools.update_tasks]
approval_mode = "approve"
# beacon:approvals:end`;

test('Codex approval block preserves unrelated configuration and uninstalls cleanly', () => {
  const original = '[mcp_servers.other]\ncommand = "other"\n';
  const installed = codexApprovalContent(original, approvals);
  assert.match(installed, /mcp_servers\.other/);
  assert.equal(codexApprovalContent(installed, approvals), installed);
  assert.equal(codexApprovalContent(installed, '').trim(), original.trim());
});

test('Codex approval block refuses conflicting unmanaged tool policy', () => {
  const config = '[mcp_servers.beacon.tools.sync_project]\napproval_mode = "prompt"\n';
  assert.throws(() => codexApprovalContent(config, approvals), /not managed/);
});
