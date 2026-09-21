/*
  Author: Runor Ewhro
  Description: Stable navigation-facing preload contract. The app routing
               layer installs its chunk registry without making links depend
               on app-owned route modules.
*/

interface NavigationPreloader {
  warmPath: (pathname: string) => Promise<void>
  isPathWarm: (pathname: string) => boolean
}

let preloader: NavigationPreloader = {
  warmPath: () => Promise.resolve(),
  isPathWarm: () => false,
}

export function configureNavigationPreloader(next: NavigationPreloader): void {
  preloader = next
}

export function warmNavigationPath(pathname: string): Promise<void> {
  return preloader.warmPath(pathname)
}

export function isNavigationPathWarm(pathname: string): boolean {
  return preloader.isPathWarm(pathname)
}
