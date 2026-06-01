# App Shell And Routing

## Summary

This document covers application bootstrap, route ownership, shell level UI, and calculator stage switching. It is the right reference when you need to understand how pages mount, where shared overlays come from, or which layer owns route wide behavior.

## Bootstrap

Primary files:

- [src/main.tsx](../src/main.tsx)
- [src/app/AppRoot.tsx](../src/app/AppRoot.tsx)
- [src/app/providers/AppProviders.tsx](../src/app/providers/AppProviders.tsx)

Bootstrap sequence:

1. `src/main.tsx` loads game data before React mounts.
2. React mounts inside `BrowserRouter`.
3. `AppProviders` installs app wide providers and sync effects.
4. `AppRoot` applies app wide hooks and renders the route tree.

`AppProviders` owns:

- debounced persistence flush scheduling
- `beforeunload` and visibility based persistence flushes
- body font application
- system theme sync when system mode is selected
- wallpaper resolution and background text mode sync
- Google OAuth provider installation
- shared tooltip, context menu, and floating selection action providers

## Route Table

Primary files:

- [src/app/router/routeTable.tsx](../src/app/router/routeTable.tsx)
- [src/app/router/AppRouter.tsx](../src/app/router/AppRouter.tsx)

The root route table mounts one shared `RouteChrome` and lazy loads child pages:

- `/`
- `/settings`
- `/info`
- `/guides`
- `/changelog`
- `/privacy`
- `/terms`
- fallback `*`

The route table itself stays intentionally small. Most complexity lives below the route shell rather than in nested route trees.

## Route Chrome

Primary file:

- [src/shared/ui/RouteChrome.tsx](../src/shared/ui/RouteChrome.tsx)

`RouteChrome` is the shared page shell. It owns:

- sidebar and toolbar navigation
- shell classes and global theme application
- route level chrome around all major pages
- app status modal
- global toast renderer
- cookie banner and related UI
- shell level toggle entrypoints for calculator stage switching

If something appears across multiple top level pages, `RouteChrome` is the first place to inspect.

## Calculator Route Staging

Primary files:

- [src/modules/calculator/pages/CalculatorPage.tsx](../src/modules/calculator/pages/CalculatorPage.tsx)
- [src/domain/state/store.ts](../src/domain/state/store.ts)

The calculator route contains an internal stage model controlled by `ui.mainMode`:

- `default`
- `optimizer`
- `overview`

`CalculatorPage` always mounts the shared calculator shell context and inventory layer, then conditionally mounts:

- the main calculator workspace
- the optimizer stage
- the overview stage

This is important because optimizer and overview are not separate routes. They are alternative calculator stages over the same broader application state.

## Shell Level Shared Behavior

Cross route shell behavior is assembled from several layers:

- route table for lazy page mounting
- `RouteChrome` for shell chrome and overlays
- app providers for environment sync and provider setup
- shared UI primitives for modals, tooltips, toasts, and selection actions

When debugging route wide behavior, inspect those layers in that order.

## Related Docs

- [architecture.md](./architecture.md)
- [feature-surfaces.md](./feature-surfaces.md)
- [state-and-persistence.md](./state-and-persistence.md)
