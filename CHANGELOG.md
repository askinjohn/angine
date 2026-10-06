# Release notes

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
