# Contributing

Thanks for helping improve Stock Peek.

## Development setup

```bash
npm install
npm run dev
```

Before submitting a pull request:

```bash
npm run lint
npm run build
```

## Pull requests

- Keep changes focused and describe the user-facing effect.
- Include reproduction steps for bug fixes.
- Test both Korean and English UI when changing copy or layout.
- Check hover behavior on left and right docking positions.
- Mention the Windows version and monitor setup used for testing.
- Do not commit API tokens, account IDs, certificates, or private keys.

## Website changes

The landing page lives in `website/`. Changes pushed to `main` are deployed through the `Deploy Website` GitHub Actions workflow after Cloudflare secrets are configured as described in `DEPLOYMENT.md`.

## Version changes

Update the version in `package.json`, then run:

```bash
npm run sync:version
```

Commit the generated HTML changes with the version bump.

## Automatic desktop releases

App changes merged into `main` automatically run the Windows release workflow. It selects the next unused patch version, runs lint, builds the installer, verifies the updater files, and publishes a GitHub Release with SHA-256 checksums. Website-only, server-only and documentation-only changes do not release the desktop app.

The workflow commits `package.json` and `package-lock.json` version changes to `main` and creates the matching tag only after the build succeeds. Its `GITHUB_TOKEN` pushes do not recursively start another workflow. No personal access token is needed; repository rules must permit the workflow to push version commits and tags.

For a minor or major release, set a version above all existing stable tags before merging. Otherwise the patch version increments automatically. Do not create release tags manually. To retry a failed release, rerun the failed job or use **Actions → Release → Run workflow**. A published release at the current commit is skipped; a failed draft publication can resume with the same version.

Desktop release version commits do not trigger the website deployment workflow. Website version markers are synchronized from `package.json` on the next website deployment (or by running its workflow manually).
