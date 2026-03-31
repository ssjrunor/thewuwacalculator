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
- data ingest scripts for resonators, weapons, and echoes

## Local development

Requirements:

- Node `^25.8.0`

Install and run:

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run build
npm test
npm run lint
```

## Data and ingest

The repo includes ingest/build scripts for game data generation:

```bash
npm run ingest:resonators
npm run ingest:resonators:index
npm run ingest:resonators:module
npm run ingest:echoes:module
npm run ingest:weapons
npm run ingest:weapons:module
```

Runtime catalog-style data is emitted as JSON under `public/data`.

## Project notes

- unofficial fan project, not affiliated with Kuro Games
- designed, coded, and maintained by `ssjrunor`
- gameplay values are based on in-game inspection plus community-maintained sources and testing

## Contact

Discord:

- https://discord.gg/wNaauhE4uH