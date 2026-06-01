# Feature Surfaces

## Summary

This document maps the main user facing surfaces to their owning modules and their main state or engine dependencies. Use it when you need to know where a feature lives, which shared systems it depends on, or which module should absorb a behavior change.

## Calculator Workspace

Primary root:

- [src/modules/calculator](../src/modules/calculator)

Main calculator subareas:

- `components/resonator`
- `components/weapons`
- `components/echoes`
- `components/suggesstions`
- `components/teams`
- `components/enemies`
- `components/buffs`
- `components/rotation`
- `components/results`
- `components/main`

The default calculator workspace is the main interactive surface for:

- active resonator selection and setup
- weapon setup
- equipped echoes
- suggestions
- team buffs and teammate state
- enemy state
- custom bonuses
- rotation editing
- live damage and result interpretation

## Optimizer Stage

Primary root:

- [src/modules/calculator/components/optimizer](../src/modules/calculator/features/optimizer)

This stage is still part of the calculator route, but it is a separate interaction model centered on:

- inventory backed echo search
- constraints and filtering
- ranked result inspection
- application of chosen results back into live build state

## Overview Stage

Primary root:

- [src/modules/calculator/components/overview](../src/modules/calculator/features/overview)

This stage is a synchronized summary surface over the current build state. It is not a separate calculator model. It reflects the same active runtime, inventory, and saved data systems used elsewhere.

## Inventory

Primary roots:

- [src/modules/calculator/components/inventory](../src/modules/calculator/features/inventory)
- [src/modules/calculator/components/echoes](../src/modules/calculator/features/echoes)
- [src/modules/calculator/components/rotation](../src/modules/calculator/features/rotation)

Inventory behavior spans several feature areas:

- stored echoes
- stored builds
- stored rotations
- clipboard and selection flows
- bag application back into active runtime state

Inventory is a cross surface persistence feature, not a single isolated page.

## Settings

Primary root:

- [src/modules/settings](../src/modules/settings)

Settings owns:

- theme and wallpaper preferences
- typography
- update toast and context menu preferences
- history preferences
- Google Drive sync controls
- legacy import and data management actions

Settings changes often have app wide effects because they mutate shared persistent UI or app state.

## Content Pages

Primary root:

- [src/modules/content](../src/modules/content)

Content pages include:

- info
- guides
- changelog
- privacy
- terms

These pages are part of the production app and ship from authored checked in content. They are not separate docs infrastructure.

## System Surface

Primary root:

- [src/modules/system](../src/modules/system)

The current system page set is intentionally small and mainly covers fallback route handling such as the not found page.

## Shared Cross Surface Systems

Several behaviors cut across module boundaries:

- route chrome and shell overlays
- global store actions
- runtime selectors
- context menus
- tooltips
- toasts
- selection mode helpers

If a change appears in several surfaces at once, the real owner is often one of those shared systems rather than the leaf component showing the behavior.

## Related Docs

- [app-shell-and-routing.md](./app-shell-and-routing.md)
- [state-and-persistence.md](./state-and-persistence.md)
- [optimizer-and-suggestions.md](./optimizer-and-suggestions.md)
