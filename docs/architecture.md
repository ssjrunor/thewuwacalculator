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
6. `AppRoot` applies app wide hooks such as cookie bootstrap and route tracking, then renders the route tree.

The important constraint is that game data is not treated as optional late loaded feature content. Large parts of the app assume the registry already exists.

## Top Level Layers

### `src/app`

Thin application orchestration:

- router setup
- app root hooks
- global providers
- small app level hooks

This layer should wire systems together, not own combat rules.

### `src/data`

Checked in runtime data and authored content:

- game data bootstrap
- catalog loaders
- set effect bootstrapping
- guides and changelog content
- scoring tables

This layer is the bridge between checked in JSON and the domain plus engine layers.

### `src/domain`

Durable concepts and state translation:

- app state entities
- runtime entities
- game data contracts and registry types
- service lookups over catalogs and seeds
- persistence schemas
- selectors
- runtime adapters and materialization helpers

This layer defines what the app means by profile, runtime, inventory entry, optimizer settings, enemy profile, and related concepts.

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

- local persistence
- Google Drive sync
- OAuth token exchange and refresh
- analytics
- cookies

This layer should not own calculator rules. It owns persistence and platform behavior.

### `src/modules`

Route facing feature surfaces:

- calculator
- settings
- content
- system

This is where domain state and engine outputs become interactive UI.

### `src/shared`

Reusable UI primitives and low level helpers:

- shell components
- modals
- toasts
- context menus
- tooltip system
- small utility stores and helpers

## Route And Shell Model

Primary files:

- [src/app/router/routeTable.tsx](../src/app/router/routeTable.tsx)
- [src/shared/ui/RouteChrome.tsx](../src/shared/ui/RouteChrome.tsx)
- [src/modules/calculator/pages/CalculatorPage.tsx](../src/modules/calculator/pages/CalculatorPage.tsx)

The route table is intentionally small:

- `/`
- `/settings`
- `/info`
- `/guides`
- `/changelog`
- `/privacy`
- `/terms`

Pages mount under a shared `RouteChrome`. The chrome owns global shell behavior such as navigation, shell styling, toasts, the app status modal, cookie banner, and shared modal infrastructure.

The calculator route contains an internal stage switch:

- `default`
- `optimizer`
- `overview`

That switch is not separate routing. It is store driven staging inside `CalculatorPage`.

See [app-shell-and-routing.md](./app-shell-and-routing.md) for detail.

## Game Data And Registry Model

Primary files:

- [src/data/gameData/index.ts](../src/data/gameData/index.ts)
- [src/domain/gameData/contracts.ts](../src/domain/gameData/contracts.ts)
- [src/domain/gameData/registry.ts](../src/domain/gameData/registry.ts)

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

- [src/domain/state/store.ts](../src/domain/state/store.ts)
- [src/domain/state/runtimeAdapters.ts](../src/domain/state/runtimeAdapters.ts)
- [src/domain/state/runtimeMaterialization.ts](../src/domain/state/runtimeMaterialization.ts)
- [src/infra/persistence/storage.ts](../src/infra/persistence/storage.ts)

The app distinguishes between:

- persisted app state
- materialized runtime state
- transient execution state

Persisted state holds durable user choices such as profiles, session, inventory, optimizer context, and saved UI preferences.

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

Suggestions reuse this runtime context to score main stat layouts, set plans, and generated echoes.

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
