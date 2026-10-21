# Angine TODO

This list separates work that makes the single-computer MVP dependable from
larger product directions. Items are not promises about a release date.

## Make local Angine solid

- [x] **First-run clarity:** make it obvious whether no work exists, no agent is
  connected, an agent has not reported yet, or the current filters hide results.
- [x] **Setup diagnostics:** make `angine doctor` explain which integration check
  failed and give a direct next step; an agent CLI that is not installed is
  reported as optional rather than an error.
- [x] **Data backup:** `angine backup <new-folder-path>` saves a consistent
  snapshot and event history without copying the local write token or agent
  configuration.
- [ ] **Guided restore:** provide a restore command or guided flow so recovery
  does not require manually replacing data folders.
- [x] **Cross-platform CI baseline:** run the unit suite and build on macOS,
  Windows, and Linux with Node 20 and 22.
- [ ] **Cross-platform package confidence:** verify fresh-package install,
  setup, reporting, restart, and uninstall on each supported operating system.
- [ ] **Reporter reliability:** make disconnected, stale, and never-reported
  states easy to distinguish, with actionable diagnostics when updates stop.
- [ ] **Release confidence:** keep the fresh-package install smoke check and CI
  green for each published version; document known limitations clearly.

## Future: shared office Angine

- [ ] **Shared server mode:** allow one Angine instance on an office machine or
  server to accept reports from other computers on the network.
- [ ] **Device connection:** let each computer connect to that server with an
  explicit pairing flow and a revocable credential.
- [ ] **Shared access controls:** define who can view or report work, and protect
  network traffic and stored team data.
- [ ] **Multi-device reporting:** identify the computer and reporter on each
  update, handle temporary disconnections, and avoid duplicate work on reconnect.
- [ ] **Deployment and operations guide:** explain network binding, backups,
  upgrades, and recovery for a self-hosted office server.

Shared mode would collect only the project, mission, task, progress, and reporter
metadata that connected apps and agents choose to report. It would not capture
computer screens or independently observe agent activity.
