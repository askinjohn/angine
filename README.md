# Angine

**One local dashboard for work reported by your coding agents.**

[![npm version](https://img.shields.io/npm/v/angine)](https://www.npmjs.com/package/angine)
[![CI](https://github.com/askinjohn/angine/actions/workflows/ci.yml/badge.svg)](https://github.com/askinjohn/angine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Working with Claude Code and Codex across several projects? Angine brings their reported goals, tasks, progress, and blockers into one place. Agents send updates through MCP while they work, and you follow them in your browser.

**Local storage · Open source · Claude Code and Codex setup · Shared missions across agents**

**v0.1.0 is an early local MVP.** Angine relies on reports from connected agents; it does not independently observe their tool calls, file changes, or transcripts.

## Quick start

Requires Node.js 20 or later and a supported agent CLI installed locally. Git must be available for automatic repository/worktree grouping.

```bash
npm install -g angine
angine setup
```

`angine setup` configures detected Codex and Claude Code CLIs, starts the Angine server, and opens the dashboard. Restart your agent sessions after setup so they load the integration. You can configure just one with `angine setup codex` or `angine setup claude`.

Installing the package alone does not start Angine or configure an agent. After setup, agent reports start the server automatically when needed. Run `angine` anytime to reopen the dashboard.

## What you can see

| View | What it answers |
| --- | --- |
| Projects and missions | Which goals are running across my repositories? |
| Tasks and board | What is complete, in progress, or blocked? |
| Needs attention | Which work has failed or stopped reporting recently? |
| Agents and sessions | Which reporter is connected, and which work belongs to it? |

### Project → Missions → Tasks

```text
My app
├── Improve checkout
│   ├── Validate payment amount — Claude Code
│   └── Verify checkout flow — Codex
└── Update documentation
    └── Write the setup guide — Claude Code
```

A project is a repository (or a folder outside Git); a mission is a goal; a task is a step toward that goal. Multiple agents can contribute to the same mission when they report the same workspace and mission key.

## How it works

1. Setup registers a local MCP reporter and adds instructions telling the agent when to report.
2. The agent registers a mission with `sync_project`, using stable project, mission, and task keys.
3. It sends meaningful status changes with `update_tasks`.
4. The dashboard receives updates and shows the reported work live.

Angine collects short metadata: titles, statuses, progress, notes, timestamps, and optional reporter identity. Reports must not contain prompts, reasoning, source code, diffs, commands, terminal output, credentials, or environment variables. Angine does not read those sources itself. Reporting quality depends on the agent following the reporting instructions.

## Included in the MVP

- **Projects:** one container per local workspace, showing mission counts, running work, agents, and attention needed.
- **Missions:** project colors carry through to missions and tasks, with optional mission overrides in each detail page’s color control; goals within a project, grouped by status, with task completion percentages and separately scrolling sections.
- **Tasks:** status groups, reported progress, project and mission filters, and dedicated detail pages.
- **Board:** status columns with independent vertical scrolling.
- **Filters:** search, agent, profile, project, mission, status, and stale activity; saved separately for each view in your browser.
- **Connection health:** automatic MCP reporter heartbeats, accepted/rejected report counts, a connection check tool, and explicit server update notices.
- **Needs attention:** a compact summary of blocked, failed, stale, and tracked disconnected work; detailed diagnostics stay expandable.
- **Agents and sessions:** editable profiles, reporter sessions, supplied native session IDs, and parent/child links when IDs are reported.
- **Related work:** agents can share a project and mission, and link related tasks within that mission.
- **Blockers:** reason, next action, and optional owner.
- **Archive:** hide projects or individual missions and restore them without deleting their tasks or history.
- **Stale indicators:** flag active work with no recent report; threshold is configurable and does not change task status.
- **Notifications:** optional desktop alerts for existing tasks that finish or become blocked. An Angine browser tab must remain open, and browser/OS permission must be allowed.

Task progress is reported explicitly. Unknown active progress displays “Not reported”; completed tasks show 100% and to-do tasks show 0%. Mission progress is the share of non-cancelled tasks completed, not an estimate of effort. Projects stay active as long-lived containers; completing their current missions does not close them.

## Connecting a profile

A profile labels a reporter's work and can hold a context, owner name/email, and account nickname. Those details are user supplied; Angine does not retrieve or verify the agent's login account. Initial profiles use a neutral Other context.

Create or edit profiles in **Agents**. A profile connects in either of two ways:

- Set it as the default for its agent type. Reports without a profile key use it.
- Configure that agent's Angine MCP connection with the profile's stable key:

```text
command: angine
args: mcp --agent claude --profile claude-default
```

Replace the agent name and profile key with your own. Creating a profile does not install, connect, or start the agent. Additional agents can report through MCP, CLI, or HTTP. Adding a profile for another agent does not create an integration for it.

Git worktrees group under one project using their shared local Git repository. Worktree paths and observed branches remain visible in mission and reporter details. Separate clones stay separate, even when their names or remotes match. Non-Git folders group by canonical workspace path. Two agents share a mission by reporting workspaces in that repository and the same stable mission key. Existing duplicate missions remain separate during migration, even if they share a key. Use distinct task keys within each mission; the same task key may appear in other missions. Parent/child agent relationships require supplied identifiers; Angine does not invent them. Codex native session IDs are populated when its runtime makes them available to the reporter; other identity fields are optional.

<details>
<summary>Reporter connections and heartbeat details</summary>

In Agents, expand **Connect this profile** to copy its MCP configuration. The connections panel shows whether the reporter is reachable and when work was last reported. Heartbeats run every 25 seconds; after 75 seconds without one, the connection is marked disconnected. They do not refresh task timestamps or change task statuses. Connection diagnostics are in memory and counters reset when the Angine server restarts. Last known report times are restored when an exact reporter ID matches saved session history. Older reporters and CLI/HTTP-only reports have unknown connection status until an updated MCP reporter connects.

</details>

See the [reporting protocol](docs/protocol.md) for payloads and integration examples.

## Commands

| Command | Purpose |
| --- | --- |
| `angine` or `angine open` | Start the server if needed and open the dashboard |
| `angine setup [codex\|claude]` | Configure detected supported agents and open Angine |
| `angine status` | Show server status, dashboard URL, and project counts |
| `angine restart` | Restart the server to load updated code; preserve history |
| `angine doctor` | Check agent integrations |
| `angine uninstall` | Remove managed integrations; preserve local history |
| `angine mcp --agent <name> [--profile <key>]` | Run an MCP reporter |
| `angine report <operation> --agent <name>` | Read a report as JSON from standard input |
| `angine token` | Show the local HTTP reporting token; keep it private |

For Codex, setup installs a removable approval policy for Angine's two reporting tools. Uninstall removes the managed instruction blocks, integrations, and policy.

## Local storage and access

The hierarchy is **Project → Missions → Tasks**. For example, a product contains a mission to improve reporting, which contains tasks to add connection checks and verify updates.

Angine stores history and configuration in `~/.angine`. The dashboard binds to `127.0.0.1`, starting at port 4317; use `angine status` for the active URL. MCP and CLI updates use a local Unix socket or Windows named pipe. HTTP reporting requires a local write token; dashboard edits require a same-origin browser session.

Angine makes no outbound network requests during normal operation. Saved filters and notification preferences live in browser storage. Agent reports and optional owner details are visible in the local dashboard; avoid putting sensitive content in metadata.

This MVP is for one computer. Mobile access over Wi-Fi, a shared company server, team authentication, independent agent observation, and notifications with all browser tabs closed are not implemented.

## Upgrading and troubleshooting

On startup, existing worktree projects are merged under their repository, preserving mission, task, and session IDs. Old project links remain usable, and a `snapshot.json.before-worktrees` backup is saved before migration. Previously removed worktrees with no saved Git identity cannot be matched automatically.

Existing plans automatically become missions grouped under their workspace project. IDs and history are preserved; old plan links still open their mission. Legacy snapshots are backed up before conversion.

After installing an update:

```bash
angine restart
```

Refresh the dashboard and restart agent sessions to load changed reporter tools. A new UI can load while an older server is still running; if saving a profile shows a restart message, restart Angine, refresh, and save again. On Windows, upgrading from a server without process identity support may require closing that old server manually first.

If work does not appear, inspect **Agents → Connections**, ask the agent to use `check_connection`, run `angine doctor`, confirm the agent loaded its MCP connection, and check agent/project/profile filters. A stale label means no recent report, not confirmed failure.

## Development and release

For contributors:

```bash
git clone https://github.com/askinjohn/angine.git
cd angine
npm ci
npm test
npx tsc --noEmit -p ui/tsconfig.json
npm run build
node dist/bin/angine.js open
```

The UI build uses Vite 7; development requires a compatible Node release (20.19+ or 22.12+). Published packages include compiled server code and dashboard assets; users do not need TypeScript or Vite.

Use `ANGINE_HOME` for isolated storage, `ANGINE_PORT` for a dashboard port, and `CODEX_HOME` for isolated Codex configuration tests.

See the [contribution guide](CONTRIBUTING.md), [release notes](CHANGELOG.md), and [release checklist](docs/releasing.md).

## Feedback

Angine is an early MVP. If setup fails or the dashboard is unclear, [open an issue](https://github.com/askinjohn/angine/issues) with your OS, Node.js version, agent type, and a description of what happened. Remove private information from any screenshots or logs you share.

Useful feedback: did your first mission appear, were the statuses accurate, and what did you need to understand at a glance?

## License

MIT — see [LICENSE](LICENSE).
