# State And Persistence

## Summary

The global Zustand store separates durable UI preferences, canonical combat scenarios, Simulation-tool state, saved artifacts, materialized runtime projections, and transient execution state.

## Persisted State

Primary files:

- [src/domain/entities/appState.ts](../src/domain/entities/appState.ts)
- [src/application/state/store.ts](../src/application/state/store.ts)
- [src/engine/runtime/schema.ts](../src/engine/runtime/schema.ts)
- [src/application/persistence/storage.ts](../src/application/persistence/storage.ts)

Current persisted roots are:

- `ui`: appearance, layout, Modulation and Showcase preferences, editor preferences, and picker memory
- `combat`: canonical scenarios and selected scenario
- `simulation`: optimizer settings and suggestion state
- `library`: saved Echoes, builds, rotations, and scenarios

Character progression and loadout belong to members inside canonical combat scenarios. Simulation tools consume materialized projections of that state; they do not keep a second page-owned model.

## Granular Storage Domains

The storage layer writes explicit domains:

- `ui.appearance`
- `ui.layout`
- `ui.savedRotationPreferences`
- `combat.workspace`
- `simulation.optimizerSettings`
- `simulation.suggestions`
- `library.echoes`
- `library.builds`
- `library.rotations`
- `library.scenarios`

Inventory-backed domains hydrate separately so the initial Home and Read experience does not need to load the full library.
Saved rotations contain immutable scenario snapshots and can become substantially larger than the other artifacts. Their domain is stored with synchronous LZ compression to stay within Web Storage quotas; the reader still accepts earlier plain-JSON v28 values and rewrites them in the compressed format after hydration.

## Runtime Materialization

Primary files:

- [src/engine/runtime/runtimeAdapters.ts](../src/engine/runtime/runtimeAdapters.ts)
- [src/engine/runtime/runtimeMaterialization.ts](../src/engine/runtime/runtimeMaterialization.ts)
- [src/engine/runtime/combatGraph.ts](../src/engine/runtime/combatGraph.ts)

Runtime adapters turn persisted scenario members, routing, controls, and local conditionals into engine-ready resonator and teammate runtimes. Selectors expose those projections to Modulation, Rotation, Showcase, Optimizer, suggestions, and evaluation.

## Evaluation And Showcase Preferences

Current UI preference names describe their consumer:

- `showEvaluationStates`
- `animatedRailPortraits`
- `showcaseCards`

The version 28 migration accepts the prior `showBenchStates`, `benchAnim2d`, and `benchmarkCards` keys, then writes only the current names. The old root `calculator` key is likewise read only as an import/migration boundary and normalized to `simulation` plus the canonical `combat` and `library` roots.

## Transient State

Optimizer progress and results, worker lifecycle state, inventory hydration flags, modal state, and other in-flight UI state are not durable. Reload behavior should be diagnosed against that boundary before changing persistence.

## Writeback And Recovery

App providers debounce dirty-domain writes and flush on page hide and `beforeunload`. Every loaded slice is validated and normalized through Zod. A failed domain write is reported independently and does not prevent later dirty domains from being saved. Legacy-version keys and recovery records are retained only to support safe migration and cleanup.

## Related Docs

- [architecture.md](./architecture.md)
- [app-shell-and-routing.md](./app-shell-and-routing.md)
- [feature-surfaces.md](./feature-surfaces.md)
