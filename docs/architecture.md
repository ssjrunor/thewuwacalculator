# Architecture

## Purpose

This repository is a browser-first React + TypeScript application for build planning, damage simulation, rotation analysis, suggestions, OCR-assisted echo import, and echo optimization for *Wuthering Waves*.

At a high level, the app works like this:

1. Static game data is loaded from checked-in JSON files under `public/data`.
2. That data is normalized into in-memory catalogs plus a richer "game data registry".
3. A single global Zustand store holds UI state, persisted calculator state, inventory, optimizer context, and transient optimizer run status.
4. The active resonator profile is materialized into runtime structures and optionally a 3-slot combat graph.
5. The simulation pipeline builds a combat context, computes final stats, resolves skill/feature definitions, and produces direct or rotation-based outputs.
6. Suggestions and optimizer flows reuse the same runtime and evaluation foundations, but dispatch heavier work to workers and optionally WebGPU.

## Tech Stack

- Vite for app bundling and dev server
- React 19 + React Router 7 for UI and routing
- Zustand for global state
- Zod for persisted-state validation and migration
- Vitest for tests
- Web Workers for suggestions and optimizer compilation/execution
- WebGPU for accelerated optimizer paths when available
- Tesseract.js plus image matching for OCR-assisted echo import
- Vercel serverless functions in `api/` for Google OAuth code exchange and refresh

## Top-Level Layout

The codebase is organized around a fairly clear split between app shell, state/domain logic, simulation engine, browser integrations, and route-facing feature modules.

- `src/app`
  Application bootstrap hooks, providers, and router wiring.
- `src/data`
  Runtime-loaded static data, content, and catalog bootstrapping.
- `src/domain`
  Type definitions, game-data contracts, state factories, selectors, runtime materialization, and service-layer lookups.
- `src/engine`
  Pure calculation-heavy logic: effects, formulas, rotation simulation, suggestions, OCR parsing, and optimizer execution.
- `src/infra`
  Browser and external integrations such as persistence, Google Drive sync, cookies, and analytics.
- `src/modules`
  Route-facing feature modules and larger UI surfaces like calculator, settings, and content pages.
- `src/shared`
  Shared UI primitives, small libs, and local utility stores.
- `public/data`
  Checked-in runtime JSON consumed at startup.
- `api`
  Minimal server endpoints for Google OAuth token exchange/refresh.

## Bootstrap Flow

Entrypoint: [src/main.tsx](/Users/runorewhro/projects/thewuwacalculator/src/main.tsx)

Startup order:

1. `initializeGameData()` fetches and initializes the runtime data package before React mounts.
2. Only after data loads does the app lazily import `AppRoot` and `AppProviders`.
3. `BrowserRouter` wraps the app.
4. `AppRoot` applies cookie bootstrap and page tracking, then renders the route tree.

This is an important architectural choice: the app treats the game-data registry as required infrastructure, not as late-loaded feature data. Many domain services assume initialization has already happened.

## Routing And Shell

Primary router files:

- [src/app/router/routeTable.tsx](/Users/runorewhro/projects/thewuwacalculator/src/app/router/routeTable.tsx)
- [src/shared/ui/RouteChrome.tsx](/Users/runorewhro/projects/thewuwacalculator/src/shared/ui/RouteChrome.tsx)

The route table is intentionally small:

- `/` calculator
- `/settings`
- `/info`
- `/guides`
- `/changelog`
- `/privacy`
- `/terms`

Pages are lazy loaded under a shared chrome component. `RouteChrome` owns:

- global shell styling and theme classes
- sidebar and toolbar navigation
- calculator left-pane tab switching
- global overlays such as confirmation modals, status modal, toasts, and cookie banner

Within the calculator route, `mainMode` in store state switches the view between:

- default calculator workspace
- optimizer stage
- overview stage

That stage switch happens inside [src/modules/calculator/pages/CalculatorPage.tsx](/Users/runorewhro/projects/thewuwacalculator/src/modules/calculator/pages/CalculatorPage.tsx), not in the router.

## Architectural Layers

### 1. App Layer

Files in `src/app` are thin orchestration code. They do not implement combat math or game rules. Their role is:

- start the app
- install providers
- connect router and hooks
- manage viewport-level behavior

`AppProviders` is especially important because it centralizes:

- debounced persistence flushing
- theme synchronization with system settings
- background wallpaper loading and text-mode detection
- body font application
- Google OAuth provider setup

### 2. Domain Layer

The domain layer in `src/domain` defines the application's durable concepts.

Examples:

- `entities/`
  Type definitions for app state, runtimes, optimizer settings, inventories, combat graph, and catalogs.
- `gameData/`
  Contracts for effects, states, conditions, features, rotations, and runtime expressions.
- `services/`
  Lookup and aggregation APIs over catalogs and registry content.
- `state/`
  Default factories, selectors, persistence schemas, materialization, cloning, and runtime adapters.

This layer is the seam between raw static data and executable simulation logic.

### 3. Engine Layer

The engine layer in `src/engine` contains the expensive and rules-heavy logic:

- formulas for final stats and damage
- runtime effect application
- combat graph simulation
- skill preparation
- suggestions algorithms
- optimizer compiler/search/execution
- OCR/image matching for echo imports

This layer is mostly framework-agnostic. UI modules call into it through selectors, helper builders, or store actions.

### 4. Infrastructure Layer

`src/infra` wraps browser and network integrations that do not belong in domain or engine logic:

- localStorage persistence
- Google Drive backup/restore
- Google OAuth token storage and refresh
- analytics
- cookie consent

### 5. Module/UI Layer

`src/modules` contains route-facing features and larger UI surfaces:

- `calculator`
- `settings`
- `content`
- `system`

This is where domain state and engine outputs are turned into interactive UI.

## Game Data Model

Core files:

- [src/data/gameData/index.ts](/Users/runorewhro/projects/thewuwacalculator/src/data/gameData/index.ts)
- [src/domain/gameData/contracts.ts](/Users/runorewhro/projects/thewuwacalculator/src/domain/gameData/contracts.ts)
- [src/domain/gameData/registry.ts](/Users/runorewhro/projects/thewuwacalculator/src/domain/gameData/registry.ts)

The runtime data system has two layers.

### Catalog Layer

Catalogs hold direct lookup data:

- resonator catalog and details
- weapon data
- echo definitions
- echo stat tables
- sonata set definitions
- enemies

These are initialized from `public/data/*.json`.

### Registry Layer

The registry is more expressive. It indexes:

- sources
- owners
- states
- conditions
- effects
- features
- rotations
- skills

The registry turns static source packages into something executable. This is the heart of the app's declarative content model. Instead of hardcoding every passive or toggle in React components, the app resolves many behaviors through data-driven definitions.

Important consequences:

- resonators, weapons, echoes, and sets all participate in a shared effect system
- many UI controls are generated from registry state definitions
- the simulation engine can apply content updates without requiring all logic to be rewritten in TSX

## Runtime And Profile Model

Core files:

- [src/domain/entities/runtime.ts](/Users/runorewhro/projects/thewuwacalculator/src/domain/entities/runtime.ts)
- [src/domain/state/runtimeAdapters.ts](/Users/runorewhro/projects/thewuwacalculator/src/domain/state/runtimeAdapters.ts)
- [src/domain/state/runtimeMaterialization.ts](/Users/runorewhro/projects/thewuwacalculator/src/domain/state/runtimeMaterialization.ts)
- [src/domain/state/combatGraph.ts](/Users/runorewhro/projects/thewuwacalculator/src/domain/state/combatGraph.ts)

The app distinguishes between persisted profile state and fully materialized runtime state.

Persisted profile state stores compact, durable user choices such as:

- resonator level, sequence, skill levels, trace nodes
- equipped weapon and echoes
- local control values and manual buffs
- saved rotations
- team members and target-routing selections

Materialized runtime state expands that into executable structures used by the engine:

- full active runtime
- teammate runtime views
- team slot layout
- state/control values attached to the active context
- runtime-local combat and manual buff state

`runtimeAdapters.ts` is a key translation layer. It builds:

- the active runtime
- participant runtime lookup maps
- active team slots
- selected target maps
- workspace runtime bundles for selectors and simulation

## Global State Model

Core files:

- [src/domain/state/store.ts](/Users/runorewhro/projects/thewuwacalculator/src/domain/state/store.ts)
- [src/domain/state/defaults.ts](/Users/runorewhro/projects/thewuwacalculator/src/domain/state/defaults.ts)
- [src/domain/state/schema.ts](/Users/runorewhro/projects/thewuwacalculator/src/domain/state/schema.ts)
- [src/domain/state/selectors.ts](/Users/runorewhro/projects/thewuwacalculator/src/domain/state/selectors.ts)

The app uses one central Zustand store.

The store has three broad categories of state:

### Persisted app state

Stored under `PersistedAppState`:

- `ui`
- `calculator`

`calculator` includes:

- profiles
- session/enemy state
- inventory echoes/builds/rotations
- optimizer context
- per-resonator suggestion settings

### Non-persisted UI/runtime state

Store-only fields include:

- inventory mount/hydration flags
- current optimizer run status/progress/results/error

### Action surface

The store exposes a very large action API for:

- theming and layout
- resonator switching and hydration
- runtime mutation
- inventory CRUD
- optimizer lifecycle
- applying optimizer results back into live state

This makes the store a practical "application service layer", not just a raw state container.

## Persistence Strategy

Core file:

- [src/infra/persistence/storage.ts](/Users/runorewhro/projects/thewuwacalculator/src/infra/persistence/storage.ts)

Persistence is more structured than a single localStorage blob.

The app persists separate slices for:

- `ui.appearance`
- `ui.layout`
- `ui.savedRotationPreferences`
- `calculator.session`
- `calculator.profiles`
- `calculator.optimizerContext`
- `calculator.suggestions`
- `calculator.inventory.echoes`
- `calculator.inventory.builds`
- `calculator.inventory.rotations`

Why this matters:

- inventory hydration can be deferred
- writes are granular instead of rewriting the entire state for every change
- invalid slices can be recovered independently
- migrations and validation are centralized through Zod schemas

`AppProviders` subscribes to dirty persisted domains and flushes them with a debounce. Flushes are forced on `beforeunload` and when the page becomes hidden.

## Derived State And Prepared Workspace

Core files:

- [src/domain/state/selectors.ts](/Users/runorewhro/projects/thewuwacalculator/src/domain/state/selectors.ts)
- [src/engine/pipeline/preparedWorkspace.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/pipeline/preparedWorkspace.ts)

The main calculator UI does not rebuild raw engine inputs ad hoc in components. Instead, selectors assemble a "prepared workspace" that contains:

- active runtime
- participant runtime map
- active target selections
- combat graph
- contexts by slot and resonator
- prepared runtime catalog
- visible skills
- direct output
- reusable rotation environment

`selectWorkspaceDerived` and `selectOverviewDerived` cache this by runtime revision, active resonator, and enemy profile.

This is one of the better architectural decisions in the repo. It gives the UI a reusable, simulation-ready object instead of forcing each pane to understand low-level graph construction.

## Combat Graph

Core files:

- [src/domain/entities/combatGraph.ts](/Users/runorewhro/projects/thewuwacalculator/src/domain/entities/combatGraph.ts)
- [src/domain/state/combatGraph.ts](/Users/runorewhro/projects/thewuwacalculator/src/domain/state/combatGraph.ts)

The combat graph is the engine's team-context representation.

Each participant includes:

- slot id
- resonator id
- slot-local state
- runtime snapshot
- resolved base stats
- stat snapshots

The graph can be built in two ways:

- from workspace/persisted calculator state
- transiently from runtime snapshots

That split is important because it lets the same engine power:

- live calculator views
- prepared workspace simulation
- one-off runtime calculations
- optimizer compilation and evaluation

## Simulation Pipeline

Core files:

- [src/engine/pipeline/index.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/pipeline/index.ts)
- [src/engine/pipeline/buildCombatContext.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/pipeline/buildCombatContext.ts)
- [src/engine/pipeline/prepareRuntimeSkill.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/pipeline/prepareRuntimeSkill.ts)
- [src/engine/pipeline/simulateRotation.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/pipeline/simulateRotation.ts)

### Stage 1: Build combat context

`buildCombatContext()`:

- starts from runtime base buffs
- applies echo stats
- applies trace node and manual buffs
- applies weapon secondary stats
- runs runtime data effects twice:
  first as `preStats`
  then as `postStats`
- computes final stats after each stage

The two-pass design matters because some effects depend on already-computed final stats while others modify the pool before final stat derivation.

### Stage 2: Prepare skills and features

Runtime skill preparation uses:

- runtime source catalogs
- registry-driven skill/effect/state definitions
- skill resolution helpers
- skill data effects

This produces the "visible skill" and direct-output surfaces used in the main calculator.

### Stage 3: Run rotation simulation

`simulateRotation()` delegates to the rotation system, then reshapes results into:

- all feature rows
- all visible skills
- personal rotation entries and totals
- team rotation entries and totals
- damage/healing/shield aggregation buckets

The calculator therefore supports both isolated skill inspection and sequence-based output summaries.

## Effects And Formula System

Important engine areas:

- `src/engine/effects`
- `src/engine/formulas`
- `src/engine/resolvers`

The engine combines:

- stat formulas
- buff-pool merging
- runtime data-driven effects
- manual buff application
- skill-specific modifiers

The registry contract supports declarative expression trees for:

- numeric formulas
- boolean conditions
- runtime changes

That lets content definitions express a large amount of behavior without hardcoding every passive into component code.

This data-driven effect system is the architectural center of the simulator.

## Suggestions Pipeline

Core files:

- [src/engine/suggestions/core.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/suggestions/core.ts)
- [src/engine/suggestions/client.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/suggestions/client.ts)
- [src/engine/suggestions/worker.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/suggestions/worker.ts)

Suggestions are split into three flows:

- main stat suggestions
- set plan suggestions
- randomized echo generation

Architecturally:

- the UI prepares a runtime-bound evaluation context
- worker jobs handle the expensive ranking/sampling work
- suggestion evaluation reuses the existing simulator rather than inventing a separate scoring engine

The random echo generator is especially notable because it:

- builds legal cost plans
- enumerates compatible main stat combinations
- samples multiple randomized realizations
- applies ER planning
- reuses fast evaluation helpers from the optimizer/simulation stack

## Optimizer Architecture

Core files:

- [src/engine/optimizer/compiler/index.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/optimizer/compiler/index.ts)
- [src/engine/optimizer/engine.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/optimizer/engine.ts)
- [src/engine/optimizer/workers/pool.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/optimizer/workers/pool.ts)
- [src/engine/optimizer/workers/compile.worker.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/optimizer/workers/compile.worker.ts)
- [src/engine/optimizer/workers/task.worker.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/optimizer/workers/task.worker.ts)

The optimizer is effectively a second execution engine layered on top of the main simulator.

### Optimizer modes

- target skill mode
- rotation mode

### Compilation phase

Raw optimizer input includes:

- selected resonator runtime
- optimizer settings
- inventory echoes
- enemy profile
- selected targets
- set conditionals
- optional rotation items

Compilation transforms that into dense numeric payloads:

- packed context arrays
- stats buffers
- set lookup tables
- main echo buffers
- combinadic indexing tables
- locked-main candidate indices
- constraints

This precompilation is critical because the execution loop cannot afford repeated object traversal or dynamic game-data lookups.

### Execution phase

The execution layer supports:

- CPU search
- GPU target search
- GPU rotation search

Worker pool behavior:

- one compile worker builds the prepared payload off the main thread
- task workers execute batches/jobs
- a pool manager handles dispatch, progress, cancellation, and result merging

### Search strategy

The optimizer searches 5-echo combinations using combinadic indexing and cost filtering.

Important details:

- result collectors maintain top-k heaps instead of full result sets
- low-memory mode constrains result storage
- locked main echo handling changes candidate enumeration
- rotation mode evaluates combinations across multiple weighted contexts, then validates constraints against a display context

### Packed context design

Files under `src/engine/optimizer/context`, `encode`, `payloads`, `cpu`, `gpu`, and `search` show a deliberate move from high-level objects to dense typed arrays.

That design exists for two reasons:

- performance on CPU hot loops
- compatibility with WebGPU buffer-based execution

The optimizer is the most performance-specialized part of the codebase.

## OCR And Import Pipeline

Core files:

- [src/engine/echoParser/ocrParsing.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/echoParser/ocrParsing.ts)
- [src/engine/echoParser/echoBuilder.ts](/Users/runorewhro/projects/thewuwacalculator/src/engine/echoParser/echoBuilder.ts)

The app can parse 1920x1080 echo screenshots by combining:

- Tesseract OCR over fixed screen regions
- reference image matching for set and echo identity
- heuristic cleanup for OCR label/number mistakes
- conversion into normalized `EchoInstance` objects

This subsystem is highly app-specific and fairly self-contained. It is a good example of feature logic living in `engine/` rather than `modules/`, because the hard part is data interpretation, not UI.

## Browser And External Integrations

### Persistence

- localStorage-backed
- domain-sliced
- schema-validated
- debounced writes

### Google OAuth And Drive sync

Core files:

- [src/infra/googleDrive/googleAuth.ts](/Users/runorewhro/projects/thewuwacalculator/src/infra/googleDrive/googleAuth.ts)
- [src/infra/googleDrive/driveSync.ts](/Users/runorewhro/projects/thewuwacalculator/src/infra/googleDrive/driveSync.ts)
- [api/exchange-code.js](/Users/runorewhro/projects/thewuwacalculator/api/exchange-code.js)
- [api/refresh-token.js](/Users/runorewhro/projects/thewuwacalculator/api/refresh-token.js)

The app stores OAuth tokens in local storage, uses serverless endpoints to exchange/refresh tokens, and syncs snapshots into Google Drive `appDataFolder`.

This is intentionally minimal backend architecture:

- the main app is static
- backend surface exists only for credentialed Google flows

### Analytics

- page views are tracked through a lightweight wrapper around the global `gtag` snippet

### Cookies

- cookie consent state is managed in app hooks and infra helpers

## UI Module Map

### Calculator module

This is the largest feature area.

Responsibilities:

- workspace split panes
- active resonator queue
- left-pane editors for resonators, weapons, echoes, buffs, enemy, teams, rotations, and suggestions
- right-pane results and charts
- overview stage
- optimizer stage
- inventory modal/layer

### Settings module

Responsibilities:

- themes and wallpaper/background selection
- typography controls
- data export/import
- legacy state import
- Google Drive backup/restore

### Content module

Responsibilities:

- info, guides, changelog, privacy, terms

### System module

Responsibilities:

- not found page and app-level fallback surfaces

## Deployment Model

Relevant files:

- [vite.config.ts](/Users/runorewhro/projects/thewuwacalculator/vite.config.ts)
- [vercel.json](/Users/runorewhro/projects/thewuwacalculator/vercel.json)

Key deployment details:

- Vite aliases `@` to `src`
- cross-origin isolation headers are enabled in dev and preview to support advanced worker/WebGPU scenarios
- Rollup manual chunks separate React core, UI vendors, icons, schema libs, and calculator effect data
- Vercel routes all non-filesystem requests back to `index.html`, so the frontend behaves as a SPA

## Testing Shape

There is no separate `src/test` suite in use right now; tests live close to the logic they verify under `__tests__`.

Main tested areas:

- game-data initialization
- persistence schema and domain slicing
- selectors/runtime switching
- damage and rotation pipeline behavior
- optimizer engine, context packing, CPU parity, and combinadics
- legacy import paths

This test distribution reinforces the architecture: the riskiest logic is in domain/engine code, not simple presentational UI.

## Notable Strengths

- Strong separation between UI, domain/state, and engine logic.
- Good reuse of one simulation foundation across calculator, overview, suggestions, and optimizer.
- Data-driven registry model scales better than hardcoding every kit rule in React.
- Prepared workspace selectors are a solid boundary between store state and rendering.
- Optimizer architecture is performance-conscious and clearly isolated from the regular UI path.

## Notable Tradeoffs And Risks

- `store.ts` is a very large integration point. It is practical, but it also concentrates a lot of orchestration and makes local reasoning harder.
- The domain/engine boundary is mostly good, but some responsibilities are still spread across adapters, services, selectors, and store actions.
- Registry-driven behavior is powerful, but debugging content issues can be harder because effects are split between JSON-like source data and engine interpretation.
- There are multiple caches at different layers: runtime catalogs, prepared selectors, combat contexts, optimizer payloads. That helps performance, but increases invalidation complexity.
- The app is frontend-heavy and static-first, so initialization order matters. Any code calling game-data services before `initializeGameData()` will fail.

## Where To Start If You Need To Change Something

### Add or fix a gameplay rule

Start in:

- `src/domain/gameData/contracts.ts`
- `src/domain/gameData/registry.ts`
- `src/engine/effects`
- `src/engine/formulas`
- the relevant data package under `public/data`

### Change persisted state or migrations

Start in:

- `src/domain/entities/appState.ts`
- `src/domain/state/defaults.ts`
- `src/domain/state/schema.ts`
- `src/infra/persistence/storage.ts`

### Change live calculator behavior

Start in:

- `src/domain/state/selectors.ts`
- `src/engine/pipeline/preparedWorkspace.ts`
- `src/modules/calculator/components/stages`

### Change optimizer behavior

Start in:

- `src/engine/optimizer/compiler`
- `src/engine/optimizer/search`
- `src/engine/optimizer/workers`
- `src/engine/optimizer/gpu`

### Change OCR import behavior

Start in:

- `src/engine/echoParser/ocrParsing.ts`
- `src/engine/echoParser/imageMatching.ts`
- `src/engine/echoParser/echoBuilder.ts`

## Summary

The repository is best understood as a static SPA wrapped around a custom combat simulation platform.

The central architectural ideas are:

- a preloaded game-data registry
- one global persisted calculator store
- runtime materialization from compact profile state
- a reusable combat graph and combat context pipeline
- shared simulation foundations reused by the optimizer and suggestion systems
- worker and WebGPU offloading for expensive combinatorial search

If you keep those seams intact, the codebase is navigable. If you blur them, changes will get expensive quickly.
