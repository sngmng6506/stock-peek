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
