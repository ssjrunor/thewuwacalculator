# Feature Surfaces

## Summary

User-facing modules follow the `Home > Read / Simulation` hierarchy.

## Home

Primary root: [src/modules/home](../src/modules/home)

Home introduces the Simulation tools and links into the Read collection. It does not own simulation state.

## Simulation

Primary root: [src/modules/simulation](../src/modules/simulation)

Shared ownership is divided by purpose:

- `context` and `context-menu`: Simulation-wide providers and menus
- `workspace`: the persistent roster, rail, loadout, and shared board
- `features`: reusable resonator, weapon, Echo, team, enemy, buff, inventory, result, suggestion, rotation, and optimizer feature modules
- `modulation`: the main build-tuning tool and its embedded evaluation report
- `showcase`: presentation-card authoring and export
- `pages`: the Simulation route boundary
- `legacy`: temporary development-only Calculator and Optimizer presentations

### Modulation

Primary root: [src/modules/simulation/modulation](../src/modules/simulation/modulation)

Modulation is the primary everyday tool. It combines character progression, weapon and Echo loadout, active states, team context, live stats, damage, and build evaluation. The evaluation engine produces baseline, active, reference, and maximum builds; it is not a separate public page.

### Rotation

Primary root: [src/modules/simulation/features/rotation](../src/modules/simulation/features/rotation)

Rotation builds, simulates, saves, imports, and shares ordered team programs. It has its own editor surface while reusing the canonical combat scenario and Simulation context.

### Showcase

Primary root: [src/modules/simulation/showcase](../src/modules/simulation/showcase)

Showcase turns the current build and evaluation into a customizable export card. Its visual preferences are stored as `showcaseCards`.

### Optimizer

Primary root: [src/modules/simulation/features/optimizer](../src/modules/simulation/features/optimizer)

Optimizer searches inventory and theoretical Echo combinations against a selected skill or rotation target. Preview changes stay detached until an explicit equip action.

### Shared Workspace And Inventory

Primary roots:

- [src/modules/simulation/workspace](../src/modules/simulation/workspace)
- [src/modules/simulation/features/inventory](../src/modules/simulation/features/inventory)
- [src/modules/simulation/features/echoes](../src/modules/simulation/features/echoes)

Modulation, Showcase, and Optimizer share the same mounted roster and rail. The rail remains editable on each workspace tool. Inventory is a cross-tool library rather than a standalone route.

## Read

Primary root: [src/modules/read](../src/modules/read)

Read owns Guides, Docs, Changelog, Privacy, and Terms pages. What's New is an act on Home, read release by release along one hairline. Authored content lives under `src/data/content`.

## Settings And System

- [src/modules/calibration](../src/modules/calibration) owns the Calibration page: appearance, application preferences, exports and data management.
- [src/modules/system](../src/modules/system) owns fallback system pages such as Not Found.

## Related Docs

- [app-shell-and-routing.md](./app-shell-and-routing.md)
- [state-and-persistence.md](./state-and-persistence.md)
- [optimizer-and-suggestions.md](./optimizer-and-suggestions.md)
