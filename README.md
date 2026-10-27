# GiftStar

Our family's Christmas wish lists.

- `web/` — the site (Vite + React), published to GitHub Pages.
- `api/` — the backend (Cloudflare Worker + D1 database + R2 photos).

## Local development

```bash
cd api && npx wrangler d1 migrations apply giftstar --local && npm run dev
cd web && npm run dev
```

Local passcodes live in `api/.dev.vars` (not committed).

## Deploying

Every push to `main` runs `.github/workflows/deploy.yml`: it creates/migrates the D1 database,
deploys the Worker, sets its secrets, then builds the site against the Worker URL and publishes it.

Repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FAMILY_PASSCODE`,
`ADMIN_PASSCODE`, `ANTHROPIC_API_KEY`, and `ROSTER` (the family roster SQL, loaded on first deploy).

The admin page is at `#/admin` on the site.
