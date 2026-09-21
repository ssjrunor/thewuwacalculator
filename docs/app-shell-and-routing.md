# App Shell And Routing

## Summary

The visible information architecture is `Home > Read / Simulation`. URLs stay flat; the hierarchy is expressed by the chrome and module ownership rather than nested public paths.

## Bootstrap

Primary files:

- [src/main.tsx](../src/main.tsx)
- [src/app/AppRoot.tsx](../src/app/AppRoot.tsx)
- [src/app/providers/AppProviders.tsx](../src/app/providers/AppProviders.tsx)

Game data loads before React mounts. App-wide persistence, theme, wallpaper, font, OAuth, tooltip, context-menu, and selection providers then wrap the router.

## Public Routes

Primary files:

- [src/shared/lib/appRoutes.ts](../src/shared/lib/appRoutes.ts)
- [src/app/router/routeTable.tsx](../src/app/router/routeTable.tsx)
- [src/app/nav/routeChunks.ts](../src/app/nav/routeChunks.ts)

Home:

- `/`

Simulation tools:

- `/modulation`
- `/rotation`
- `/showcase`
- `/optimizer`
- `/suggestions`

Read pages:

- `/guides`
- `/docs`
- `/changelog`
- `/privacy`
- `/terms`

Settings is now Calibration at `/calibration`; `/settings` redirects to it.

`/home` redirects to `/`, and `/progression` redirects to `/modulation`. What's New is an act on Home: `/changelog/whatsnew` redirects to `/#whatsnew`, and `/changelog/whatsnew#<release id>` to `/#whatsnew-<release id>`. Old nested tool URLs redirect to their flat counterparts.

## Shared Simulation Workspace

[SimulationPage.tsx](../src/modules/simulation/shell/SimulationPage.tsx) owns initialization and providers shared by Simulation tools. Modulation, Showcase, and Optimizer use one persistent parameterized route and [BuildWorkspaceSurface.tsx](../src/modules/simulation/workspace/BuildWorkspaceSurface.tsx), so their roster, rail, and workspace furniture remain mounted while the tool body changes. Rotation uses its own editor surface but the same Simulation provider boundary.

Route chunks preserve lazy loading and prewarm tool modules on navigation intent.

## Temporary Development Pages

The following direct development URLs are intentionally hidden from primary navigation and SEO:

- `/calculator`
- `/legacy-optimizer`

Their components live under `src/modules/simulation/surfaces/legacy`. They reuse the Simulation provider and initialization boundary; the old Calculator no longer owns shared startup behavior. The former Benchmark and standalone Progression pages have been removed. Historical `/progression` and `/calculator/benchmark` links redirect to Modulation.

## Route Chrome

Primary files:

- [src/app/shell/AppLayout.tsx](../src/app/shell/AppLayout.tsx)
- [src/app/shell/ChromeHeader.tsx](../src/app/shell/ChromeHeader.tsx)
- [src/application/navigation/appIndex.ts](../src/application/navigation/appIndex.ts)

`AppLayout` is the single route layout and owns global hosts, route effects, the roster aperture, and the outlet. `ChromeHeader` owns only the header UI. The header always presents Simulation tools directly. Docs, Guides, Changelog, Calibration, Privacy, and Terms are in the Read dropdown on every route. Home is the front door. Hidden legacy pages are never added to the authored navigation index.

## Related Docs

- [architecture.md](./architecture.md)
- [feature-surfaces.md](./feature-surfaces.md)
- [state-and-persistence.md](./state-and-persistence.md)
