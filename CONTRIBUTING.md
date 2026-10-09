# Contributing to Angine

Angine is an MIT-licensed local dashboard for agent-reported work.

## Development

Use Node.js 22.12 or later. Install dependencies with `npm ci`, then run:

```bash
npm test
npx tsc --noEmit -p ui/tsconfig.json
npm run build
```

For isolated runtime work, set `ANGINE_HOME` to a temporary directory. Avoid changing your normal agent configuration during tests. Run `npm run dev` for the frontend development server.

## Changes

- Describe the problem and the intended behavior in an issue or pull request.
- Keep the Projects → Missions → Tasks hierarchy and reporter compatibility intact.
- Add meaningful tests for persistence, migration, reporting, or validation changes.
- Keep source code, prompts, command output, credentials, and private transcripts out of reported metadata.
- Use neutral examples in documentation and screenshots; omit personal or company information.

Include the checks you ran and any limitations in the pull request description. See the [reporting protocol](docs/protocol.md) and [release guide](docs/releasing.md).
