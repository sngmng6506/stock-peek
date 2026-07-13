# Website deployment

The landing page in `website/` is deployed to Cloudflare Pages by `.github/workflows/deploy-website.yml` whenever relevant files are pushed to `main`.

## One-time GitHub Secrets setup

In the GitHub repository, open **Settings → Secrets and variables → Actions** and add:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with `Account / Cloudflare Pages / Edit` permission
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID that owns the Pages project

The workflow deploys to the Pages project named `stock-peek`. If the actual Cloudflare Pages project uses a different name, update `--project-name` in `.github/workflows/deploy-website.yml`.

## Production settings

- Branch: `main`
- Source directory: `website`
- Build command: none
- Output directory: `website`

The workflow also runs `npm run sync:version` before deployment so the visible version and JSON-LD metadata match `package.json`.

## Manual deployment

Open **Actions → Deploy Website → Run workflow**.
