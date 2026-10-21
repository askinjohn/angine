# Release notes

## 0.2.0 — Monitoring and Antigravity

- Add `report_update` checkpoints for requests, implementation, deployment, monitoring, and blockers. Mission checkpoints also appear on the parent project.
- Add a highlighted Monitoring view with environment, latest check, status, and next-step details.
- Add Antigravity setup, automatic detection in `angine setup`, diagnostics, and clean uninstall while preserving unrelated MCP configuration and guidance.
- Add `angine stop` and consistent local history backups with `angine backup`.
- Expand CI to Ubuntu, macOS, and Windows on Node 20 and 22; include a fresh npm archive smoke check.

## 0.1.1 — Worktrees, colors, and graph

- Add a live React Flow graph tab with pan/zoom, draggable nodes, minimap, filtering, inherited colors, and saved node positions.

- Group Git worktrees under their shared repository while retaining workspace paths and observed branches.
- Merge existing worktree projects with a backup; preserve mission/task/session IDs, archived work, project links, and event history.
- Add a default color per project, inherited by missions and tasks, with editable project colors and optional mission overrides.

## 0.1.0 — Initial local MVP

- Project → Missions → Tasks, with workspace grouping, mission pages and filters, and automatic migration preserving IDs/history.
- Agent-reported mission plans and task updates over MCP, CLI, and local HTTP.
- Setup integration for Codex and Claude Code, with automatic server startup on reporting.
- Project and task pages, status lists, progress, and independently scrolling board columns.
- Agent/profile/project filtering, saved filters, stale indicators, and configurable browser alerts.
- Profiles, reported sessions and child-agent IDs, shared projects, related tasks, and blocker details.
- Archive/restore controls that preserve local history.
- Metadata persistence, input validation, token-protected HTTP reporting, and same-origin dashboard edits.
- A restart command for loading server updates, with proactive UI/server compatibility notices.
- MCP reporter heartbeat, connection check, accepted/rejected report diagnostics, and a compact needs-attention summary.
- Expandable connection instructions and secondary filters to keep the main views concise.

This version depends on agents reporting their work. Shared team hosting, Wi-Fi/mobile access, independent observation, and alerts with no open dashboard tab are future work.
