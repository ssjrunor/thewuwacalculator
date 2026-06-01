# Optimizer And Suggestions

## Summary

This document covers the ranking and search systems that sit on top of the shared runtime engine. Use it when changing target skill suggestions, set suggestions, random echo generation, worker behavior, optimizer compilation, or CPU and GPU search execution.

## Shared Runtime Assumption

Suggestions and optimizer do not invent a separate combat model. They both reuse the same underlying runtime assumptions used by the main calculator:

- active resonator runtime
- team state
- enemy state
- shared effect resolution
- shared formula system

Differences appear in how they explore and rank candidates, not in the core meaning of damage.

## Suggestions

Primary files:

- [src/engine/suggestions/core.ts](../src/engine/suggestions/core.ts)
- [src/engine/suggestions/mainStat-suggestion](../src/engine/suggestions/mainStat-suggestion)
- [src/engine/suggestions/setPlan-suggestion](../src/engine/suggestions/setPlan-suggestion)
- [src/engine/suggestions/randomEchoes](../src/engine/suggestions/randomEchoes)
- [src/engine/suggestions/worker.ts](../src/engine/suggestions/worker.ts)

Top level suggestion families:

- main stat suggestions
- set plan suggestions
- random echo generation

Main stat and set plan suggestions are synchronous ranking systems over prepared inputs. Random echo generation is async because it can perform heavier synthetic exploration work.

Suggestions are shaped by:

- selected target skill
- current runtime state
- set conditional state
- prepared scoring or ranking inputs

## Suggestions Worker Boundary

The worker layer exists so expensive suggestion preparation and ranking does not block the main thread during heavier runs. It should stay aligned with the same prepared input contracts used by the direct engine helpers.

## Optimizer Overview

Primary files:

- [src/engine/optimizer/engine.ts](../src/engine/optimizer/engine.ts)
- [src/engine/optimizer/compiler](../src/engine/optimizer/compiler)
- [src/engine/optimizer/search](../src/engine/optimizer/search)
- [src/engine/optimizer/results](../src/engine/optimizer/results)
- [src/engine/optimizer/workers](../src/engine/optimizer/workers)

The optimizer pipeline is:

1. compile raw start payload into a prepared optimizer payload
2. count or derive legal search space
3. choose candidate main echo indices
4. run worker coordinated search for those candidate groups
5. optionally use GPU accelerated target or rotation execution where available
6. materialize compact result refs into user facing loadout results

## Compile Stage

The compile stage is responsible for turning app state into packed execution input:

- filtered inventory echoes
- mode specific packed execution payloads
- locked main candidate indices
- result limits
- packed context structures for target or rotation search

This stage is where many optimizer shape bugs actually originate because the search layers depend on these packed assumptions.

## CPU And GPU Execution

Primary directories:

- [src/engine/optimizer/cpu](../src/engine/optimizer/cpu)
- [src/engine/optimizer/gpu](../src/engine/optimizer/gpu)
- [src/engine/optimizer/shaders](../src/engine/optimizer/shaders)

CPU paths provide the baseline packed search execution.

GPU paths accelerate supported target and rotation workloads by:

- packing context data into GPU friendly buffers
- dispatching compute pipelines
- reducing candidate outputs

Worker orchestration decides when those paths are available and how progress is reported back to the store.

## Worker Model

Primary files:

- [src/engine/optimizer/workers/pool.ts](../src/engine/optimizer/workers/pool.ts)
- [src/engine/optimizer/workers/compile.worker.ts](../src/engine/optimizer/workers/compile.worker.ts)
- [src/engine/optimizer/workers/count.worker.ts](../src/engine/optimizer/workers/count.worker.ts)
- [src/engine/optimizer/workers/task.worker.ts](../src/engine/optimizer/workers/task.worker.ts)

The worker layer exists to keep compilation, counting, batching, and heavy search work off the main thread. Store side runtime helpers coordinate lifecycle, cancellation, and result materialization.

## Result Materialization

Primary files:

- [src/engine/optimizer/results/materialize.ts](../src/engine/optimizer/results/materialize.ts)
- [src/engine/optimizer/results/collector.ts](../src/engine/optimizer/results/collector.ts)

Search execution returns compact refs rather than immediately returning full UI objects. Materialization turns those refs back into user facing result rows and preview loadouts.

This separation matters because:

- compact refs are cheaper during search
- full UI objects are only needed after ranking
- CPU and GPU paths can share a common materialization step

## Store Coordination

Primary files:

- [src/domain/state/storeOptimizerRuntime.ts](../src/domain/state/storeOptimizerRuntime.ts)
- [src/domain/state/store.ts](../src/domain/state/store.ts)

The store layer owns:

- compile worker lifecycle
- run invalidation
- batch sizing
- progress updates
- final result application back into live runtime state

The engine should stay focused on compile and execution. The store should stay focused on orchestration.

## Related Docs

- [architecture.md](./architecture.md)
- [calculation-and-runtime-engine.md](./calculation-and-runtime-engine.md)
- [feature-surfaces.md](./feature-surfaces.md)
