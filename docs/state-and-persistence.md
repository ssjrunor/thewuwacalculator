# State And Persistence

## Summary

This document explains how the global store is shaped, how runtime state is materialized from persisted data, and how persistence is written back to storage. Use it when changing store fields, persistence boundaries, hydration order, inventory state, or runtime derivation behavior.

## Global Store Model

Primary files:

- [src/domain/state/store.ts](../src/domain/state/store.ts)
- [src/domain/state/defaults.ts](../src/domain/state/defaults.ts)
- [src/domain/state/schema.ts](../src/domain/state/schema.ts)
- [src/domain/state/selectors.ts](../src/domain/state/selectors.ts)

The app uses one global Zustand store. It acts as both:

- the shared state container
- the main application service layer through a large action surface

Broad store categories:

- persisted app state
- non persisted UI and runtime state
- transient long running process state

## Persisted App State

Persisted state is rooted in `PersistedAppState` and primarily split between:

- `ui`
- `calculator`

Durable `ui` state includes:

- theme and appearance settings
- layout and calculator view preferences
- saved rotation preferences
- history related preferences
- picker frequency memory

Durable `calculator` state includes:

- session and active resonator selection
- resonator profiles
- inventory echoes
- inventory builds
- inventory rotations
- optimizer context
- suggestions state by resonator

## Runtime Materialization

Primary files:

- [src/domain/state/runtimeAdapters.ts](../src/domain/state/runtimeAdapters.ts)
- [src/domain/state/runtimeMaterialization.ts](../src/domain/state/runtimeMaterialization.ts)
- [src/domain/state/combatGraph.ts](../src/domain/state/combatGraph.ts)
- [src/domain/state/storeHelpers.ts](../src/domain/state/storeHelpers.ts)

The app does not run formulas directly on compact persisted profile data. It first materializes runtime structures that the engine can consume.

Important runtime outputs:

- active resonator runtime
- teammate runtime views
- active team slot layout
- selected target maps
- workspace derived bundles consumed by selectors and calculator surfaces

The important distinction is:

- persisted profile state stores user authored choices
- runtime state stores execution ready structures derived from those choices

## Transient And Non Persisted State

Not all store state is durable.

Examples:

- inventory mount and hydration flags
- optimizer progress
- optimizer in flight results
- optimizer errors
- compile worker and worker pool coordination state
- other short lived UI control state

This matters when debugging reload behavior. If something disappears after refresh, check whether it belongs to transient runtime state rather than persisted state.

## Persistence Model

Primary file:

- [src/infra/persistence/storage.ts](../src/infra/persistence/storage.ts)

Persistence is written by domain slice rather than one whole app blob. The storage layer defines explicit domain keys such as:

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

Benefits of this model:

- smaller writes
- clearer recovery behavior
- independent validation of slices
- deferred inventory hydration

## Writeback Flow

`AppProviders` subscribes to dirty persisted domains and debounces writes. Dirty domains are collected by the persistence layer, then flushed:

- after a debounce interval
- on page hide
- on `beforeunload`

The provider persists `selectPersistedState(useAppStore.getState())` filtered by the dirty domain set.

## Hydration And Recovery

The storage layer supports:

- current version keys
- legacy version backup keys
- recovery prefixes
- per slice validation through Zod schemas

Hydration does not blindly trust local storage. It validates and normalizes persisted slices before applying them.

## History, Inventory, And Large State Domains

Important supporting files:

- [src/domain/state/history.ts](../src/domain/state/history.ts)
- [src/domain/state/pickerFrequency.ts](../src/domain/state/pickerFrequency.ts)
- [src/domain/state/inventoryUsage.ts](../src/domain/state/inventoryUsage.ts)

Notable state domains:

- app history is its own domain with caps, labels, trimming, and disabled state behavior
- picker frequency is durable UI memory used by recommendation and ordering surfaces
- inventory domains are large enough that they are persisted separately and can be hydrated independently from the main profile state

## Google Drive Sync Relationship

Google Drive sync is not a separate app state model. It serializes and restores the same persistent state domains the local app uses.

That means:

- local persistence remains the primary structure
- Drive sync is a transport and backup layer over that structure
- restore paths can replace local state with a stored snapshot

## Related Docs

- [architecture.md](./architecture.md)
- [feature-surfaces.md](./feature-surfaces.md)
- [deployment-and-operations.md](./deployment-and-operations.md)
