import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { antigravityDir, claudeDir, codexDir, dataDir } from './paths.js';

const start = '<!-- angine:start -->';
const end = '<!-- angine:end -->';
const approvalStart = '# angine:approvals:start';
const approvalEnd = '# angine:approvals:end';
const approvalBlock = `${approvalStart}
[mcp_servers.angine.tools.sync_project]
approval_mode = "approve"

[mcp_servers.angine.tools.update_tasks]
approval_mode = "approve"

[mcp_servers.angine.tools.report_update]
approval_mode = "approve"
${approvalEnd}`;
const guidance = `${start}
When you begin implementing an agreed change, use Angine's sync_project MCP tool to publish a short mission plan with stable project, mission, and task keys. The project identifies the product or repository; the mission identifies this specific goal. Older tools without a mission field accept the goal in the project field and group it by workspace. After obtaining the missionId, use report_update to record the accepted request and intended result. Add concise report_update checkpoints when implementation changes meaningfully, when a deployment is confirmed, and after production monitoring. Use missionId for a specific fix; use projectId for monitoring that spans the whole project. Mission updates also appear on their parent project. Use only observed facts; do not claim a deploy succeeded or production is healthy unless tool results confirm it. Include the environment and a next step when useful. As work changes, batch meaningful task status transitions with update_tasks; use sync_project when the plan materially changes. If reliably available in your session context, include sourceSessionId, agentId, parentAgentId, and accountLabel to link agent work. Include task progress only when reliably measured. Never send prompts, reasoning, source code, diffs, commands, logs, command output, secrets, or environment variables. Reporting failure must not stop implementation; do not repeatedly retry an unavailable reporter.
${end}`;
const bin = fileURLToPath(new URL('../bin/angine.js', import.meta.url));
const manifestPath = () => path.join(dataDir(), 'integration.json');
const codexConfigPath = () => path.join(codexDir(), 'config.toml');
const antigravityConfigPath = () => path.join(antigravityDir(), 'config', 'mcp_config.json');
type AgentId = 'codex' | 'claude' | 'antigravity';
interface Integration { command: string; instructionFile: () => string; addArgs: string[]; removeArgs: string[] }
interface ManagedIntegration { instructionsFile: string; mcpInstalled: boolean; bin: string; mcpConfigFile?: string }
interface Manifest { integrations: Partial<Record<AgentId, ManagedIntegration>> }
const integrations: Record<AgentId, Integration> = {
  codex: {
    command: 'codex',
    instructionFile: () => {
      const override = path.join(codexDir(), 'AGENTS.override.md');
      return fs.existsSync(override) && fs.readFileSync(override, 'utf8').trim()
        ? override : path.join(codexDir(), 'AGENTS.md');
    },
    addArgs: ['mcp', 'add', 'angine', '--', process.execPath, bin, 'mcp', '--agent', 'codex'],
    removeArgs: ['mcp', 'remove', 'angine']
  },
  claude: {
    command: 'claude',
    instructionFile: () => path.join(claudeDir(), 'CLAUDE.md'),
    addArgs: ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'angine', '--', process.execPath, bin, 'mcp', '--agent', 'claude'],
    removeArgs: ['mcp', 'remove', '--scope', 'user', 'angine']
  },
  antigravity: {
    command: '',
    instructionFile: () => path.join(antigravityDir(), 'AGENTS.md'),
    addArgs: [], removeArgs: []
  }
};
function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content, { mode: 0o600 });
  fs.renameSync(temp, file);
}
function managedContent(content: string, replacement: string): string {
  const a = content.indexOf(start), b = content.indexOf(end);
  if ((a < 0) !== (b < 0) || (a >= 0 && (b < a || content.indexOf(start, a + start.length) >= 0 || content.indexOf(end, b + end.length) >= 0)))
    throw new Error('Ambiguous Angine instruction markers');
  if (a >= 0) return content.slice(0, a) + replacement + content.slice(b + end.length);
  return replacement ? `${content.trimEnd()}${content.trim() ? '\n\n' : ''}${replacement}\n` : content;
}
function run(command: string, args: string[]) {
  const env = command === 'claude' ? { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } : process.env;
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10000, env, shell: process.platform === 'win32' });
  return result.error ? { ...result, status: -1, stderr: result.error.message } : result;
}
function available(agent: AgentId): boolean { return run(integrations[agent].command, ['--version']).status === 0; }
function readManifest(): Manifest {
  try {
    const value = JSON.parse(fs.readFileSync(manifestPath(), 'utf8')) as Manifest & Partial<ManagedIntegration>;
    if (value.integrations) return value;
    return { integrations: value.mcpInstalled && value.instructionsFile && value.bin
      ? { codex: { instructionsFile: value.instructionsFile, mcpInstalled: true, bin: value.bin } } : {} };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { integrations: {} }; throw error; }
}
function saveManifest(record: Manifest): void { atomicWrite(manifestPath(), JSON.stringify(record)); }
function antigravityConfig(): { [key: string]: any; mcpServers: Record<string, any> } {
  const file = antigravityConfigPath();
  if (!fs.existsSync(file)) return { mcpServers: {} };
  return parseAntigravityConfig(fs.readFileSync(file, 'utf8'), file);
}
export function parseAntigravityConfig(contents: string, file: string): { [key: string]: any; mcpServers: Record<string, any> } {
  if (!contents.trim()) return { mcpServers: {} };
  let value: unknown;
  try { value = JSON.parse(contents); }
  catch (error) { throw new Error(`Invalid Antigravity MCP config: ${file} (${(error as Error).message})`); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).mcpServers !== undefined && (!(value as Record<string, unknown>).mcpServers || typeof (value as Record<string, unknown>).mcpServers !== 'object' || Array.isArray((value as Record<string, unknown>).mcpServers)))
    throw new Error(`Invalid Antigravity MCP config: ${file}`);
  return { ...(value as Record<string, any>), mcpServers: (value as Record<string, any>).mcpServers || {} };
}
function isAngineAntigravityServer(server: any, expectedBin: string): boolean {
  return Boolean(server && Array.isArray(server.args) && server.args.includes(expectedBin) && server.args.includes('mcp') && server.args.includes('--agent') && server.args.includes('antigravity'));
}
function installAntigravity(record: Manifest): void {
  const configFile = antigravityConfigPath();
  fs.mkdirSync(path.dirname(configFile), { recursive: true, mode: 0o700 });
  const config = antigravityConfig();
  const prior = record.integrations.antigravity;
  const existing = config.mcpServers.angine;
  if (existing && !isAngineAntigravityServer(existing, bin) && !(prior?.mcpInstalled && isAngineAntigravityServer(existing, prior.bin)))
    throw new Error('Antigravity already has an MCP server named angine; refusing to replace it');
  if (!isAngineAntigravityServer(existing, bin)) {
    config.mcpServers.angine = { ...(existing || {}), command: process.execPath, args: [bin, 'mcp', '--agent', 'antigravity'] };
    if (fs.existsSync(configFile)) fs.copyFileSync(configFile, `${configFile}.angine-backup-${Date.now()}`);
    atomicWrite(configFile, `${JSON.stringify(config, null, 2)}\n`);
  }
  const file = integrations.antigravity.instructionFile();
  installInstructions(file, prior?.instructionsFile);
  record.integrations.antigravity = { instructionsFile: file, mcpInstalled: true, bin, mcpConfigFile: configFile };
  saveManifest(record);
}
function uninstallAntigravity(info: ManagedIntegration): void {
  const file = info.instructionsFile;
  if (file && fs.existsSync(file)) removeInstructions(file);
  const configFile = info.mcpConfigFile || antigravityConfigPath();
  if (!info.mcpInstalled || !fs.existsSync(configFile)) return;
  const config = antigravityConfig();
  if (isAngineAntigravityServer(config.mcpServers.angine, info.bin)) {
    fs.copyFileSync(configFile, `${configFile}.angine-backup-${Date.now()}`);
    delete config.mcpServers.angine;
    atomicWrite(configFile, `${JSON.stringify(config, null, 2)}\n`);
  }
}
function installInstructions(file: string, previousFile?: string): void {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const changed = managedContent(current, guidance);
  if (changed !== current) {
    if (fs.existsSync(file) && !current.includes(start)) fs.copyFileSync(file, `${file}.angine-backup-${Date.now()}`);
    atomicWrite(file, changed);
  }
  if (previousFile && previousFile !== file && fs.existsSync(previousFile)) removeInstructions(previousFile);
}
function removeInstructions(file: string): void {
  const current = fs.readFileSync(file, 'utf8');
  const changed = managedContent(current, '');
  if (changed !== current) atomicWrite(file, changed);
}
export function codexApprovalContent(content: string, replacement: string): string {
  const a = content.indexOf(approvalStart), b = content.indexOf(approvalEnd);
  if (a < 0 && b >= 0 && content.indexOf(approvalEnd, b + approvalEnd.length) < 0) {
    const withoutOrphan = content.slice(0, b) + content.slice(b + approvalEnd.length);
    return replacement ? `${withoutOrphan.trimEnd()}\n\n${replacement}\n` : withoutOrphan;
  }
  if ((a < 0) !== (b < 0) || (a >= 0 && (b < a || content.indexOf(approvalStart, a + approvalStart.length) >= 0 || content.indexOf(approvalEnd, b + approvalEnd.length) >= 0)))
    throw new Error('Ambiguous Angine approval markers');
  const unmanaged = a >= 0 ? content.slice(0, a) + content.slice(b + approvalEnd.length) : content;
  if (replacement && /^\s*\[mcp_servers\.angine\.tools\.(sync_project|update_tasks|report_update)\]\s*$/m.test(unmanaged))
    throw new Error('Existing Angine tool approval policy is not managed by this installation');
  return a >= 0 ? content.slice(0, a) + replacement + content.slice(b + approvalEnd.length)
    : replacement ? `${content.trimEnd()}\n\n${replacement}\n` : content;
}
function installCodexApprovals(): void {
  const file = codexConfigPath();
  const current = fs.readFileSync(file, 'utf8');
  const changed = codexApprovalContent(current, approvalBlock);
  if (changed !== current) {
    if (!current.includes(approvalStart)) fs.copyFileSync(file, `${file}.angine-backup-${Date.now()}`);
    atomicWrite(file, changed);
  }
}
function removeCodexApprovals(): void {
  const file = codexConfigPath();
  if (!fs.existsSync(file)) return;
  const current = fs.readFileSync(file, 'utf8');
  const changed = codexApprovalContent(current, '');
  if (changed !== current) atomicWrite(file, changed);
}
export function setup(requested = 'all'): { installed: AgentId[]; skipped: AgentId[] } {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or later is required');
  if (requested !== 'all' && requested !== 'codex' && requested !== 'claude' && requested !== 'antigravity') throw new Error('Choose codex, claude, antigravity, or all');
  const record = readManifest();
  const selected: AgentId[] = requested === 'all' ? ['codex', 'claude', ...(fs.existsSync(antigravityDir()) ? ['antigravity' as const] : [])] : [requested];
  const installed: AgentId[] = [], skipped: AgentId[] = [];
  for (const agent of selected) {
    const integration = integrations[agent];
    if (agent === 'antigravity') {
      installAntigravity(record);
      installed.push(agent);
      continue;
    }
    fs.mkdirSync(agent === 'codex' ? codexDir() : claudeDir(), { recursive: true, mode: 0o700 });
    if (!available(agent)) {
      if (requested !== 'all') throw new Error(`${agent} CLI was not found`);
      skipped.push(agent);
      continue;
    }
    const prior = record.integrations[agent];
    const get = run(integration.command, ['mcp', 'get', 'angine']);
    if (get.status === 0 && !prior?.mcpInstalled) throw new Error(`${agent} already has an MCP server named angine; refusing to replace it`);
    if (get.status === 0 && !get.stdout?.includes(prior!.bin)) throw new Error(`${agent} Angine MCP no longer points to this installation`);
    if (get.status === 0 && prior!.bin !== bin) {
      const removed = run(integration.command,integration.removeArgs);
      if(removed.status !== 0) throw new Error(removed.stderr || `Could not update ${agent} MCP`);
      const added = run(integration.command,integration.addArgs);
      if(added.status !== 0) {
        const restored = run(integration.command,integration.addArgs.map(arg=>arg===bin ? prior!.bin : arg));
        throw new Error(restored.status === 0 ? `Could not update ${agent} MCP; the previous connection was restored` : `Could not update ${agent} MCP; run angine setup again to restore the connection`);
      }
    }
    if (get.status !== 0) {
      if (agent === 'codex' && fs.existsSync(codexConfigPath())) fs.copyFileSync(codexConfigPath(), `${codexConfigPath()}.angine-backup-${Date.now()}`);
      const add = run(integration.command, integration.addArgs);
      if (add.status !== 0) throw new Error(add.stderr || `Could not configure ${agent} MCP`);
    }
    if (agent === 'codex') installCodexApprovals();
    const file = integration.instructionFile();
    installInstructions(file, prior?.instructionsFile);
    record.integrations[agent] = { instructionsFile: file, mcpInstalled: true, bin };
    saveManifest(record);
    installed.push(agent);
  }
  if (!installed.length) throw new Error('No supported agent integration was found');
  return { installed, skipped };
}
export function uninstall(): { removed: AgentId[] } {
  const record = readManifest();
  const installed = Object.keys(record.integrations) as AgentId[];
  for (const agent of installed) {
    const integration = integrations[agent];
    const info = record.integrations[agent]!;
    if (agent === 'antigravity') {
      uninstallAntigravity(info);
      delete record.integrations[agent];
      saveManifest(record);
      continue;
    }
    if (info.instructionsFile && fs.existsSync(info.instructionsFile)) removeInstructions(info.instructionsFile);
    if (agent === 'codex') removeCodexApprovals();
    if (info.mcpInstalled && available(agent)) {
      const get = run(integration.command, ['mcp', 'get', 'angine']);
      if (get.status === 0 && get.stdout?.includes(info.bin)) {
        const remove = run(integration.command, integration.removeArgs);
        if (remove.status !== 0) throw new Error(remove.stderr || `Could not remove ${agent} MCP`);
      }
    }
    delete record.integrations[agent];
    saveManifest(record);
  }
  if (fs.existsSync(manifestPath())) fs.unlinkSync(manifestPath());
  return { removed: installed };
}
export function doctor(): Array<{ name: string; ok: boolean; detail: string }> {
  const checks = [{ name: 'Node.js', ok: Number(process.versions.node.split('.')[0]) >= 20, detail: Number(process.versions.node.split('.')[0]) >= 20 ? `${process.version} · supported` : `${process.version} · install Node.js 20 or later` }];
  const record = readManifest();
  for (const agent of ['codex', 'claude', 'antigravity'] as AgentId[]) {
    const integration = integrations[agent];
    if (agent === 'antigravity') {
      const configured = Boolean(record.integrations.antigravity);
      const ruleFile = integration.instructionFile();
      const hasGuidance = fs.existsSync(ruleFile) && fs.readFileSync(ruleFile, 'utf8').includes(start);
      checks.push({ name: 'antigravity guidance', ok: hasGuidance || !configured, detail: hasGuidance ? `${ruleFile} · installed` : configured ? `missing from ${ruleFile}; run angine setup antigravity` : 'not configured (run angine setup antigravity to connect this agent)' });
      const configFile = record.integrations.antigravity?.mcpConfigFile || antigravityConfigPath();
      let pointsToAngine = false;
      try { pointsToAngine = isAngineAntigravityServer(antigravityConfig().mcpServers.angine, record.integrations.antigravity?.bin || ''); } catch { /* Report invalid config below. */ }
      checks.push({ name: 'antigravity MCP', ok: pointsToAngine || !configured, detail: pointsToAngine ? `${configFile} · configured` : configured ? `missing or points to another install; run angine setup antigravity` : 'not configured (run angine setup antigravity to connect this agent)' });
      continue;
    }
    const cli = available(agent);
    const configured = Boolean(record.integrations[agent]);
    checks.push({ name: `${agent} CLI`, ok: cli || !configured, detail: cli ? 'available' : configured ? 'configured Angine integration cannot be checked; install the CLI or run angine uninstall' : 'not installed (optional)' });
    if (!cli) {
      if (configured) checks.push({ name: `${agent} MCP`, ok: false, detail: 'CLI unavailable; install it, then run angine setup' });
      continue;
    }
    const file = integration.instructionFile();
    const hasGuidance = fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(start);
    checks.push({ name: `${agent} guidance`, ok: hasGuidance || !configured, detail: hasGuidance ? `${file} · installed` : configured ? `missing from ${file}; run angine setup ${agent}` : 'not configured (run angine setup to connect this agent)' });
    const get = run(integration.command, ['mcp', 'get', 'angine']);
    const expectedBin = record.integrations[agent]?.bin;
    const pointsToAngine = get.status === 0 && Boolean(expectedBin && get.stdout?.includes(expectedBin));
    const mcpOkay = configured && pointsToAngine;
    checks.push({ name: `${agent} MCP`, ok: mcpOkay || !configured, detail: mcpOkay ? 'configured and points to this Angine install' : configured ? 'missing or points to another install; run angine setup ' + agent : 'not configured (run angine setup to connect this agent)' });
    if (agent === 'codex' && record.integrations.codex) {
      const config = fs.existsSync(codexConfigPath()) ? fs.readFileSync(codexConfigPath(), 'utf8') : '';
      const approved = config.includes(approvalBlock);
      checks.push({ name: 'codex automatic reporting', ok: approved, detail: approved ? 'Angine reporting tools approved' : 'approval policy missing; run angine setup codex' });
    }
  }
  let storageOkay = false;
  let storageDetail = dataDir();
  try {
    fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    const probe = path.join(dataDir(), `.doctor-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, '', { flag: 'wx', mode: 0o600 });
    fs.unlinkSync(probe);
    storageOkay = true;
    storageDetail += ' · writable';
  } catch (error) {
    storageDetail += ` · not writable: ${(error as Error).message}; check folder permissions`;
  }
  checks.push({ name: 'Local storage', ok: storageOkay, detail: storageDetail });
  return checks;
}
