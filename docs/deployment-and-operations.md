# Deployment And Operations

## Summary

This document covers local development, Cloudflare deployment, OAuth, persistence operations, and the checked in maintenance workflows that support production runtime data.

## Local Development

Primary files:

- [package.json](../package.json)
- [vite.config.ts](../vite.config.ts)
- [wrangler.jsonc](../wrangler.jsonc)

Core requirements:

- Node `24.x`

Core local commands:

```bash
npm install
npm run dev
npm run build
npm test
npm run lint
```

Cloudflare local development:

```bash
npm run dev:cloudflare
```

## Production Deployment

Primary files:

- [src/cloudflare/worker.ts](../src/cloudflare/worker.ts)
- [wrangler.jsonc](../wrangler.jsonc)
- [public/_headers](../public/_headers)

Production uses:

- static assets from `dist`
- Cloudflare asset serving with SPA fallback
- a small worker front door for OAuth related `/api/*` endpoints

The worker route surface is intentionally narrow:

- `/api/exchange-code`
- `/api/refresh-token`

Everything else falls back to static asset serving.

## Environment Variables

Important variables visible in the repo:

- `VITE_GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

These matter in two different places:

- `VITE_*` values for browser side configuration
- server side values for OAuth exchange and refresh handling

## Google Drive Sync

Primary roots:

- [src/infra/googleDrive](../src/infra/googleDrive)
- [src/infra/googleDrive/server](../src/infra/googleDrive/server)

Drive sync behavior depends on:

- browser side auth setup
- token exchange and refresh endpoints
- persistence snapshot serialization
- restore and backup actions in settings

Operationally, Drive sync is a backup and restore path over the same persistence domains the local app already uses.

## Persistence Operations

Primary roots:

- [src/infra/persistence](../src/infra/persistence)
- [src/domain/state/schema.ts](../src/domain/state/schema.ts)

Operational persistence concerns include:

- schema versioning
- legacy backup handling
- recovery keys
- per domain slice reads and writes
- hydration and repair behavior after bad local data

If deployment or browser behavior changes persistence assumptions, this layer is high risk and should be checked carefully.

## Checked In Maintenance Scripts

Primary roots:

- [scripts/ingest](../scripts/ingest)
- [scripts/assets](../scripts/assets)

Important checked in workflows:

- fetch resonator data
- build resonator runtime outputs
- build resonator indexes
- fetch and build weapon data
- fetch and build echo data
- apply resonator authored overrides
- sync resonator images

These scripts are not all part of the browser runtime, but they are part of the production maintenance path because they shape the checked in artifacts the app actually loads.

## Operational Boundaries

The repository does not expose every private upstream source file used during data authoring. That is acceptable as long as:

- the checked in outputs remain documented
- the build and ingest contracts remain documented
- maintainers know which outputs are source of truth for the app at runtime

## Related Docs

- [architecture.md](./architecture.md)
- [game-data-and-content-pipeline.md](./game-data-and-content-pipeline.md)
- [state-and-persistence.md](./state-and-persistence.md)
