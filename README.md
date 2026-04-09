# The Wuwa Calculator

Fan-made tools for planning, simulating, and optimizing builds in *Wuthering Waves*.

This repo is the current app codebase for the calculator, including the main workspace, rotation editor, suggestions flows, inventory tools, and optimizer.

## What it includes

- damage calculator workspace for resonators, weapons, echoes, teams, enemies, and manual buffs
- rotation editor and live simulation views
- suggestions flows for main stats, sonata sets, and randomized echo rolls
- inventory and saved-build management
- optimizer mode for brute-force echo searches
- overview and guide/content pages
- tracked app source, tests, and static assets used by the calculator

## Local development

Requirements:

- Node `24.x`

Install and run:

```bash
npm install
npm run dev
```

Google Drive sync in local development also expects server-side OAuth vars in `.env.local` or your shell:

```bash
VITE_GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:5174
```

Useful commands:

```bash
npm run build
npm test
npm run lint
npm run dev:cloudflare
npm run deploy:cloudflare
```

## Cloudflare deployment

The app now deploys as a Cloudflare Worker with static assets from `dist` and worker-handled Google OAuth endpoints under `/api/*`.

Basic deploy flow:

```bash
npm install
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
npm run deploy:cloudflare
```

Set `GOOGLE_REDIRECT_URI` as a Worker variable or secret if your OAuth callback must differ from the site origin. Cross-origin isolation headers are served from [public/_headers](/Users/runorewhro/projects/thewuwacalculator/public/_headers), and SPA routing is handled in [wrangler.jsonc](/Users/runorewhro/projects/thewuwacalculator/wrangler.jsonc).

Some package scripts are intended for local maintenance workflows and depend on ignored files that are not included in this repository. The public repo is focused on the app itself.

## License

This project is source-available, not open source. See [LICENSE.md](/Users/runorewhro/projects/thewuwacalculator/LICENSE.md) for the full terms.

In short, the code is provided for reference and educational use only. You may view and study it, but you may not copy, modify, redistribute, sublicense, or reuse substantial portions of it without prior written permission from the author.

## Project notes

- unofficial fan project, not affiliated with Kuro Games
- designed, coded, and maintained by `ssjrunor`
- gameplay values are based on in-game inspection plus community-maintained sources and testing

## Contact

Discord:

- https://discord.gg/wNaauhE4uH
