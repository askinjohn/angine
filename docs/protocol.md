# Reporting protocol

Angine uses **Project → Missions → Tasks**. A project identifies the product or local workspace. A mission identifies a goal within that project; its tasks describe the steps. Connected agents send short metadata through MCP, CLI, or local HTTP.

## `sync_project`

Create or reconcile a mission. The project is grouped by its canonical local `workspacePath`, which must be an existing directory. Use stable mission and task keys. Omitted tasks remain; only `removedTaskKeys` explicitly removes them.

```json
{
  "agent": "opencode",
  "sessionKey": "session-example",
  "project": {
    "key": "payments",
    "name": "Payments",
    "workspacePath": "/absolute/path/to/payments"
  },
  "mission": {
    "key": "refund-support",
    "name": "Add refund support",
    "description": "Implement and verify refunds"
  },
  "tasks": [
    { "key": "api", "title": "Implement refund API", "status": "in_progress" },
    { "key": "ui", "title": "Build refund UI", "status": "todo" }
  ]
}
```

Response for a mission-aware report:

```json
{
  "projectId": "prj_...",
  "rootProjectId": "prj_...",
  "missionId": "mis_...",
  "taskIds": { "api": "task_...", "ui": "task_..." }
}
```

Tasks belong to a mission. Their keys only need to be unique within that mission, so different missions can each have a `verify` task. Mission status is derived from its tasks. Projects stay active until archived; completing a mission does not complete the product.

## `update_tasks`

Batch meaningful status changes with the returned `missionId`. Include `projectId` when available; Angine validates that the mission belongs to it.

```json
{
  "agent": "opencode",
  "sessionKey": "session-example",
  "projectId": "prj_...",
  "missionId": "mis_...",
  "updates": [
    { "taskKey": "api", "status": "completed" },
    { "taskKey": "ui", "status": "in_progress", "progress": 25 }
  ]
}
```

Task statuses: `todo`, `in_progress`, `blocked`, `completed`, `failed`, `cancelled`. Mission statuses: `planned`, `running`, `blocked`, `completed`, `failed`, `cancelled`.

## `report_update`

Post a short checkpoint for a specific mission or the project as a whole. Use `missionId` for a scoped change; the checkpoint appears on that mission and its parent project. Use `projectId` alone for project-wide deployment or monitoring. Checkpoints do not change task or mission status.

```json
{
  "agent": "claude",
  "sessionKey": "session-example",
  "missionId": "mis_...",
  "phase": "deployment",
  "status": "completed",
  "environment": "production",
  "summary": "Deploy completed; the production health endpoint returned HTTP 200.",
  "nextStep": "Monitor the error rate for 30 minutes."
}
```

For project-wide monitoring, omit `missionId` and provide `projectId`. Phases are `request`, `implementation`, `deployment`, `monitoring`, and `blocker`; statuses are `in_progress`, `completed`, `blocked`, and `failed`. Environments are optional: `development`, `staging`, or `production`. Keep summaries factual. Angine displays what the agent reports and does not independently verify deployments or production health.

Both task creation and updates accept optional `progress` from 0 to 100. Omitted progress is preserved, except when reopening a completed task. Completed tasks display 100%, to-do tasks 0%, and unknown active progress “Not reported.” Mission progress is the share of non-cancelled tasks completed, not a measure of effort.

Notes are optional, at most 500 characters. A blocked task may include:

```json
{
  "reason": "Waiting for API contract",
  "nextStep": "Approve the contract",
  "owner": "API team"
}
```

Send this as `blocker`. Reason and next step allow 500 characters, owner 160. Omission preserves details while blocked; `null` clears them, and moving out of blocked clears them automatically.

`parentKey` creates task hierarchy within a mission. `relatedTaskKeys` links up to 20 other existing task keys in the same mission. Agents can collaborate by reporting the same workspace and mission key. Dashboard edits preserve the original reporting timestamp and session attribution.

## Reporter identity and profiles

Agent names use letters, digits, dots, dashes, and underscores (1–80 characters); omitted names become `external`. `sessionKey` groups a reporter's calls. Optional fields are:

- `sourceSessionId`: native conversation/session ID, only when known.
- `agentId` and `parentAgentId`: supplied agent and child-agent identity. A parent ID requires an agent ID.
- `accountLabel`: a user supplied nickname, not a credential.
- `profileKey`: an existing profile for that agent type; omission uses its default.

Identity labels are limited to 160 characters. Angine also creates its own internal reporter session IDs. Owner names/emails are entered in the dashboard, not extracted from agent accounts. Sessions retain their project and mission membership across reports.

Never send prompts, reasoning, source code, diffs, commands, command output, secrets, environment variables, or credentials.

## MCP

Register a stdio server:

```text
command: angine
args: mcp --agent opencode
```

For a specific profile, add `--profile <key>`. Angine exposes `sync_project`, `update_tasks`, `report_update`, and read-only `check_connection`. MCP supplies the configured agent name and reporter session key, so those are omitted from tool inputs.

Codex reporters use CODEX_THREAD_ID or CODEX_SESSION_ID when its runtime supplies them. Unknown identity is omitted. `angine setup antigravity` merges a stdio server entry into `~/.gemini/config/mcp_config.json` and adds reporting guidance to `~/.gemini/AGENTS.md`; existing MCP entries and unmanaged rule text are preserved. In Antigravity, refresh the MCP server list and start a new agent session after setup or tool changes. `angine uninstall` removes the managed entry and guidance.

Antigravity's global MCP config uses this shape; setup writes the current Angine executable and installation path for you:

```json
{
  "mcpServers": {
    "angine": {
      "command": "/path/to/node",
      "args": ["/path/to/angine/dist/bin/angine.js", "mcp", "--agent", "antigravity"]
    }
  }
}
```

## CLI

```bash
angine report sync_project --agent opencode < plan.json
angine report update_tasks --agent opencode < update.json
angine report report_update --agent opencode < checkpoint.json
```

Add `--profile <key>` for a specific profile. Reports start the daemon if needed. Use a consistent `sessionKey` within a session.

## HTTP

```text
POST /api/ingest/sync_project
POST /api/ingest/update_tasks
POST /api/ingest/report_update
Content-Type: application/json
Authorization: Bearer <local token>
```

The active address comes from `angine status`; get the local token with `angine token`. Keep tokens out of agent prompts and repositories. HTTP binds to loopback, requires a write token, and rejects cross-origin requests. Errors return JSON with an `error` field.

## Existing data and older reporters

Older plans become missions grouped by their workspace project. Existing mission (formerly project), task, and session IDs are preserved, as are status, archives, links, and event logs. A legacy snapshot is backed up beside itself as `snapshot.json.before-missions` before conversion. Replaying older logs also converts them without rewriting their history.

Legacy `sync_project` calls without a `mission` field still work: the old `project` fields identify the mission, and the workspace folder supplies the parent project's name. Their response keeps `projectId` as a compatibility alias for the mission ID, and also returns `missionId` and `rootProjectId`.

Legacy `update_tasks` calls can continue sending that old plan ID as `projectId`. A root project ID alone works only if the task keys uniquely identify one mission; ambiguous updates are rejected rather than applied to the wrong work. New integrations should always send `missionId`.

Old `#/projects/<plan-id>` links open the corresponding mission. New project and mission pages use `#/projects/<root-id>` and `#/missions/<mission-id>` respectively.

Projects and individual missions can be archived without deleting history. New reports do not restore an archive. A project archive hides all of its missions and tasks until the parent project is restored.

## Connection health

MCP reporters register on client initialization and heartbeat every 25 seconds. A connection expires after 75 seconds without a heartbeat, or when its transport closes. This confirms reporter reachability, not tool activity or progress. Heartbeats do not update task timestamps or create task activity events.

The dashboard reads `/api/health` for server protocol compatibility, connections, configured profiles, last heartbeat, and accepted/rejected report counts. Diagnostics are bounded and held in memory for the server lifetime; call counters reset on restart and are not project history. The last known report time is recovered from persisted sessions only when the exact reporter ID matches. Older sessions and CLI/HTTP-only reporters show unknown connection status.

Use `check_connection` from the agent to confirm its reporter and profile. Rejected reports do not change task status. Angine cannot independently count updates that an agent never attempted to report.
