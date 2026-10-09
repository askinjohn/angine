# Publishing Angine

Initial MVP package: `angine@0.1.0`.

## Prepare

1. Confirm the MIT license is included in the package.
2. Confirm the npm package name is available or owned by your publishing account. An npm login alone does not establish ownership of an existing package.
3. Run the checks and inspect the archive:

```bash
npm test
npx tsc --noEmit -p ui/tsconfig.json
npm pack --dry-run
npm pack
npm run test:release -- ./angine-0.1.0.tgz
```

`prepack` builds the server and UI. The archive should contain compiled code, UI assets, README, release notes, and protocol documentation. It should not contain local Angine history, agent configuration, credentials, or dependencies copied from node_modules.

The release smoke check installs the archive into temporary storage, tests the real MCP protocol, profiles, shared missions, restart, and uninstall. Claude and Codex command line integrations are simulated; this does not verify how actual AI sessions follow reporting instructions. The check requires npm access and permission to start a local server. Temporary history and integration configuration are isolated from your existing installation.

## GitHub checks

Push the prepared checkout and confirm its CI passes before publishing:

```bash
git push origin main
gh run list --limit 5
```

Use `gh run watch RUN_ID --exit-status` for the run belonging to the pushed commit. CI runs the unit tests, type check, build, and isolated package smoke check.

## Publish

From a terminal with npm registry access:

```bash
npm login
npm whoami
npm view angine versions
npm publish ./angine-0.1.0.tgz --access public --tag latest
npm view angine@0.1.0 version
```

After npm publication is verified, create the matching GitHub release:

```bash
gh release create v0.1.0 ./angine-0.1.0.tgz --target main --title "Angine v0.1.0" --notes-file docs/releases/v0.1.0.md
```

A not-found response from `npm view` can mean the package has not been published yet. If the name belongs to someone else, choose an available name or a scope you own, update the README/install instructions, and regenerate the archive. Do not overwrite or guess an unrelated package's ownership.

The publication command may require npm's browser or two-factor authentication. Verify the final published version before announcing it. Package publication does not publish this repository or host the dashboard on the internet.

## Subsequent versions

Update package.json and package-lock.json versions together, add release notes, rerun the checks, and pack/publish the new version. Existing users run `angine restart` after upgrading so the running server loads new code.
