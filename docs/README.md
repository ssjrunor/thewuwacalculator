# Documentation

## Summary

This folder is the maintainer handoff set for the repository. It documents the shipped app, the checked in operational flows that support it, and the central data and runtime contracts that shape production behavior.

Use these docs in this order:

1. [architecture.md](./architecture.md)
2. the subsystem guide relevant to the area you are changing
3. the source files linked from that guide

## Documents

- [architecture.md](./architecture.md)
  High level system map. Start here.
- [app-shell-and-routing.md](./app-shell-and-routing.md)
  App bootstrap, route table, shell ownership, and calculator stage switching.
- [state-and-persistence.md](./state-and-persistence.md)
  Store structure, runtime materialization, persistence slices, and hydration behavior.
- [game-data-and-content-pipeline.md](./game-data-and-content-pipeline.md)
  Checked in runtime data, registry bootstrapping, authored content, and checked in build pipeline shape.
- [calculation-and-runtime-engine.md](./calculation-and-runtime-engine.md)
  Combat context building, formulas, simulation, effects, and rotation execution.
- [optimizer-and-suggestions.md](./optimizer-and-suggestions.md)
  Suggestions, workers, optimizer compile and search flow, CPU and GPU paths, and result materialization.
- [feature-surfaces.md](./feature-surfaces.md)
  User facing module ownership across calculator, settings, content, and system surfaces.
- [deployment-and-operations.md](./deployment-and-operations.md)
  Local development, Cloudflare deployment, OAuth, sync, and checked in maintenance workflows.

## Coverage Rules

These docs aim to cover:

- shipped runtime behavior
- checked in deployment and operational flows
- checked in scripts that build central runtime artifacts
- the shape of generated outputs that the app depends on

These docs do not aim to deeply document:

- ignored private source files not present in git
- temporary personal scratch files
- one off local developer experiments unless they materially affect shipped behavior

## Update Expectations

When a change alters:

- runtime data shape
- store shape
- route ownership
- deployment setup
- a major feature surface
- a checked in build or ingest contract

the relevant doc in this folder should be updated in the same change.
