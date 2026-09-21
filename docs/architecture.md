# Architecture

## Summary

This repository is the current production codebase for The Wuwa Calculator. It is a browser first React and TypeScript application for build planning, damage simulation, rotation analysis, suggestions, OCR assisted echo import, inventory management, and optimizer execution for *Wuthering Waves*.

The app is built around one central idea:

1. checked in game data is loaded before React mounts
2. that data becomes catalogs plus a richer executable registry
3. one global Zustand store holds persistent app state, derived runtime state, and transient run state
4. runtime adapters materialize the active resonator, team, enemy, and control state into engine friendly structures
5. the engine resolves effects, final stats, formulas, and rotations
6. heavier flows such as suggestions and optimizer reuse the same runtime foundations, but move expensive work into workers and optional WebGPU paths

This document is the top level system map. Use it first, then move into the focused docs in this folder for subsystem detail.

## Runtime Boot Flow

Primary entrypoints:

- [src/main.tsx](../src/main.tsx)
- [src/data/gameData/index.ts](../src/data/gameData/index.ts)
- [src/app/AppRoot.tsx](../src/app/AppRoot.tsx)
- [src/app/providers/AppProviders.tsx](../src/app/providers/AppProviders.tsx)

Startup order:

1. `initializeGameData()` fetches checked in runtime JSON from `public/data`.
2. Catalog initializers load resonators, weapons, echoes, sets, and details into memory.
3. Source packages are combined into the shared game data registry.
4. React mounts only after the registry is ready.
5. `AppProviders` installs persistence flushing, theme sync, wallpaper sync, font sync, Google OAuth, tooltips, context menus, and floating selection actions.
6. `AppRoot` renders the router; `AppLayout` owns route tracking, cookie bootstrap, global hosts, the header, and the routed outlet.

The important constraint is that game data is not treated as optional late loaded feature content. Large parts of the app assume the registry already exists.

## Top Level Layers

### `src/app`

Thin application orchestration:

- router setup
- shell composition
- global providers

This layer should wire systems together, not own combat rules.

### `src/application`

Application-wide state and use cases:

- Zustand store composition and selectors
- persistence coordination and imports
- navigation and context-menu contracts
- theme, media, and integration-facing hooks

This layer may coordinate domain, data, engine, and infrastructure code, but it does not render route-owned feature surfaces.

### `src/data`

Checked in runtime data and authored content:

- game data bootstrap
- catalog loaders
- set effect bootstrapping
- guides and changelog content
- scoring tables

This layer is the bridge between checked in JSON and the domain plus engine layers. It does not import the engine.

### `src/domain`

Durable concepts and contracts:

- app state entities
- runtime entities
- game data contracts and registry types
- game-data contracts
- pure entities and value types
- domain-only services

This layer defines what the app means by profile, runtime, inventory entry, optimizer settings, enemy profile, and related concepts. It has no dependency on application state, catalogs, or engine execution.

### `src/engine`

Calculation heavy and rule heavy logic:

- formulas
- effect evaluation
- pipeline simulation
- rotation inspection
- suggestions
- echo parser
- optimizer compiler, search, encoding, workers, CPU, GPU, and result materialization

This layer is mostly framework agnostic. UI modules call into it through selectors, helpers, and store actions.

### `src/infra`

External integration and environment specific code:

- browser blob storage
- Google Drive sync
- OAuth token exchange and refresh
- analytics
- cookies

This layer should not own simulation rules. It owns persistence and platform behavior.

### `src/modules`

Route-facing feature surfaces:

- `home`
- `read`
- `simulation`
- `settings`
- `system`

This is where domain state and engine outputs become interactive UI.

### `src/shared`

Reusable UI primitives and low level helpers:

- modals
- toasts
- context menus
- tooltip system
- small utility stores and helpers

`shared` is the leaf layer and cannot import application or feature ownership.

The import direction is enforced by `npm run check:architecture`. App-to-module and cross-module imports must use an explicit `api/` or route `pages/` entry.

## Route And Shell Model

Primary files:

- [src/app/router/routeTable.tsx](../src/app/router/routeTable.tsx)
- [src/app/shell/AppLayout.tsx](../src/app/shell/AppLayout.tsx)
- [src/app/shell/ChromeHeader.tsx](../src/app/shell/ChromeHeader.tsx)
- [src/modules/simulation/shell/SimulationPage.tsx](../src/modules/simulation/shell/SimulationPage.tsx)

The public route hierarchy is `Home > Read / Simulation`, expressed with flat URLs. Home is `/`. Simulation tools are `/modulation`, `/rotation`, `/showcase`, `/optimizer`, and `/suggestions`; Read owns Guides, Docs, Changelog, Privacy, and Terms; What's New is an act on Home. Simulation tools stay directly on the header, while reference pages and Calibration are in its Read dropdown.

Pages mount under `AppLayout`. `ChromeHeader` owns header interaction only; `AppLayout` owns global shell behavior and `GlobalHosts` owns application-wide portals and notices.

Modulation, Showcase, and Optimizer share one persistent parameterized route and mounted workspace. Rotation has its own editor surface under the same Simulation provider. Temporary direct legacy pages live below `src/modules/simulation/surfaces/legacy` and are omitted from navigation and SEO.

See [app-shell-and-routing.md](./app-shell-and-routing.md) for detail.

## Game Data And Registry Model

Primary files:

- [src/data/gameData/index.ts](../src/data/gameData/index.ts)
- [src/domain/gameData/contracts.ts](../src/domain/gameData/contracts.ts)
- [src/data/gameData/registry.ts](../src/data/gameData/registry.ts)

The runtime data model has two main layers.

Catalog layer:

- resonator catalog and details
- weapon data
- echo catalog
- echo stat tables
- sonata sets
- enemies

Registry layer:

- source packages
- owners
- states
- conditions
- effects
- features
- rotations
- skills

The catalogs provide direct lookup data. The registry provides executable relationships and shared effect definitions. This is what lets the app reuse one effect system across resonators, weapons, echoes, and sets instead of hardcoding each behavior in React components.

See [game-data-and-content-pipeline.md](./game-data-and-content-pipeline.md) for detail.

## Store, Runtime, And Persistence Model

Primary files:

- [src/application/state/store.ts](../src/application/state/store.ts)
- [src/engine/runtime/runtimeAdapters.ts](../src/engine/runtime/runtimeAdapters.ts)
- [src/engine/runtime/runtimeMaterialization.ts](../src/engine/runtime/runtimeMaterialization.ts)
- [src/application/persistence/storage.ts](../src/application/persistence/storage.ts)

The app distinguishes between:

- persisted app state
- materialized runtime state
- transient execution state

Persisted state holds durable user choices such as combat scenarios, inventory, optimizer settings, and saved UI preferences.

Runtime adapters expand that into active runtime structures for the engine:

- active resonator runtime
- teammate runtime views
- selected target maps
- team slot layout
- derived workspace bundles

Transient run state holds things such as optimizer progress, optimizer results, and temporary worker lifecycle state.

Persistence is granular by domain. The app does not rewrite one monolithic blob for every small change.

See [state-and-persistence.md](./state-and-persistence.md) for detail.

## Simulation, Suggestions, And Optimizer Model

Primary files:

- [src/engine/pipeline/index.ts](../src/engine/pipeline/index.ts)
- [src/engine/pipeline/buildCombatContext.ts](../src/engine/pipeline/buildCombatContext.ts)
- [src/engine/pipeline/simulateRotation.ts](../src/engine/pipeline/simulateRotation.ts)
- [src/engine/suggestions/core.ts](../src/engine/suggestions/core.ts)
- [src/engine/optimizer/engine.ts](../src/engine/optimizer/engine.ts)

The shared execution model is:

1. build or reuse a combat graph
2. build a combat context for the target slot
3. resolve effects and final stats
4. resolve skills, rows, and rotation outputs
5. return user facing results or feed those results into ranking systems

Suggestions reuse this runtime context to score main stat layouts, set plans, and generated echoes. Main-stat and set-plan suggestion comparisons intentionally neutralize main-Echo passive bonus rows in both the candidate and baseline score so those surfaces rank only the requested change.

Optimizer extends the same model by:

- compiling inventory and runtime state into packed execution payloads
- counting legal combinations
- executing worker coordinated CPU or GPU searches
- materializing compact result refs back into user facing loadouts

See:

- [calculation-and-runtime-engine.md](./calculation-and-runtime-engine.md)
- [optimizer-and-suggestions.md](./optimizer-and-suggestions.md)

## Deployment And Operational Model

Primary files:

- [src/cloudflare/worker.ts](../src/cloudflare/worker.ts)
- [src/infra/googleDrive/server/googleOAuthServer.ts](../src/infra/googleDrive/server/googleOAuthServer.ts)
- [wrangler.jsonc](../wrangler.jsonc)
- [package.json](../package.json)

The production deployment is a Cloudflare Worker plus static assets from `dist`.

The worker has a deliberately small responsibility surface:

- serve static assets through Cloudflare assets
- intercept `/api/exchange-code`
- intercept `/api/refresh-token`

Everything else falls through to the SPA asset handler.

Checked in scripts under `scripts/` matter because they build or refresh central runtime artifacts such as resonator sources, weapon data, echo modules, and asset naming. Some upstream producer inputs are not in git, but the output shape they feed into the checked in runtime files is still part of the production contract.

See [deployment-and-operations.md](./deployment-and-operations.md) for detail.

## Focused Docs

- [docs index](./README.md)
- [app shell and routing](./app-shell-and-routing.md)
- [state and persistence](./state-and-persistence.md)
- [game data and content pipeline](./game-data-and-content-pipeline.md)
- [calculation and runtime engine](./calculation-and-runtime-engine.md)
- [optimizer and suggestions](./optimizer-and-suggestions.md)
- [feature surfaces](./feature-surfaces.md)
- [deployment and operations](./deployment-and-operations.md)
