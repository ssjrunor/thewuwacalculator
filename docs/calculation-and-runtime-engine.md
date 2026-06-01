# Calculation And Runtime Engine

## Summary

This document covers the shared execution engine that turns runtime state into damage, healing, shield, rotation, and inspection outputs. Use it when changing formulas, effect resolution, combat context assembly, or rotation simulation.

## Main Execution Flow

Primary files:

- [src/engine/pipeline/index.ts](../src/engine/pipeline/index.ts)
- [src/engine/pipeline/buildCombatContext.ts](../src/engine/pipeline/buildCombatContext.ts)
- [src/engine/pipeline/simulateRotation.ts](../src/engine/pipeline/simulateRotation.ts)
- [src/engine/pipeline/prepareRuntimeSkill.ts](../src/engine/pipeline/prepareRuntimeSkill.ts)
- [src/engine/rotation/system.ts](../src/engine/rotation/system.ts)

The shared execution flow is:

1. build or reuse a combat graph
2. select a target slot
3. build a combat context for that slot
4. resolve effects, stats, and routing
5. prepare runtime skills and rows
6. simulate direct results or rotation results
7. optionally inspect node level execution traces

`runResonatorSimulation()` is the common path when the caller starts from an active runtime plus team context. `runCombatGraphSimulation()` is the path when the graph already exists and the caller wants to target a specific slot directly.

## Combat Graph

Primary files:

- [src/domain/entities/combatGraph.ts](../src/domain/entities/combatGraph.ts)
- [src/domain/state/combatGraph.ts](../src/domain/state/combatGraph.ts)

The combat graph is the transient execution structure that ties active participants, runtime state, slot ownership, and targeting together. It is not itself durable persisted app state.

Important responsibilities:

- represent participants by slot
- carry runtime references for active and teammate contexts
- preserve target routing information
- provide enough structure for shared combat context building

## Combat Context

Primary file:

- [src/engine/pipeline/buildCombatContext.ts](../src/engine/pipeline/buildCombatContext.ts)

The combat context is the resolved execution surface used by formulas and simulation. It merges:

- active runtime state
- team sourced effects
- selected target routing
- enemy state
- derived stat and effect maps

If final output looks wrong, the combat context is often the most important seam to inspect because it is the point where stored choices become resolved execution inputs.

## Formulas

Primary directories:

- [src/engine/formulas](../src/engine/formulas)
- [src/engine/effects](../src/engine/effects)
- [src/engine/resolvers](../src/engine/resolvers)

Core formula responsibilities include:

- final stat aggregation
- direct damage resolution
- tune rupture
- negative effect handling
- scoped modifier application

The effect layer determines which modifiers exist. The formula layer determines how those modifiers are numerically applied.

## Skill And Row Preparation

Primary files:

- [src/engine/pipeline/prepareRuntimeSkill.ts](../src/engine/pipeline/prepareRuntimeSkill.ts)
- [src/engine/pipeline/resolveSkill.ts](../src/engine/pipeline/resolveSkill.ts)

Skill preparation turns registry backed feature definitions and runtime state into resolved rows that the UI and rotation summaries can consume. This is where many declarative game data definitions become concrete result rows.

## Rotation Execution

Primary files:

- [src/engine/rotation/system.ts](../src/engine/rotation/system.ts)
- [src/engine/pipeline/simulateRotation.ts](../src/engine/pipeline/simulateRotation.ts)

Rotation execution is not a separate calculator. It is another view over the same combat context and skill resolution system.

Important outputs:

- personal rotation totals
- team rotation totals
- node level inspection entries
- breakdown rows used by UI surfaces

The rotation inspector reuses the same graph and context setup as live simulation so that trace output matches the same team, enemy, and routing assumptions.

## Negative Effects And Specialized Systems

Primary files:

- [src/domain/gameData/negativeEffects.ts](../src/domain/gameData/negativeEffects.ts)
- [src/engine/formulas/negativeEffects.ts](../src/engine/formulas/negativeEffects.ts)

Negative effects, tune systems, healing, and shield paths are part of the shared engine, not bolt on UI logic. They need to stay aligned with the same runtime and combat context model as standard damage rows.

## Debugging Rule

When a result is wrong, check in this order:

1. source data and registry definition
2. runtime materialization
3. combat context assembly
4. effect resolution
5. formula application
6. row presentation

That sequence usually finds the real issue faster than starting in the React component that displays the wrong number.

## Related Docs

- [architecture.md](./architecture.md)
- [state-and-persistence.md](./state-and-persistence.md)
- [optimizer-and-suggestions.md](./optimizer-and-suggestions.md)
