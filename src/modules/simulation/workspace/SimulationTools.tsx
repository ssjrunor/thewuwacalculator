/*
  Author: Runor Ewhro
  Description: Shared navigation for tools that use the build workspace. The
               URL owns which page is active.
*/

import { AxLink } from '@/shared/navigation/useNavX'
import { SIMULATION_ROUTES } from '@/shared/lib/appRoutes'

export type BuildWorkspacePage = 'modulation' | 'showcase' | 'optimizer' | 'suggestions'

const WORKSPACE_TOOLS: Array<{
  id: BuildWorkspacePage
  name: string
  to: string
}> = [
  { id: 'modulation', name: 'Modulation', to: SIMULATION_ROUTES.modulation },
  { id: 'showcase', name: 'Showcase', to: SIMULATION_ROUTES.showcase },
  { id: 'optimizer', name: 'Optimizer', to: SIMULATION_ROUTES.optimizer },
]

export function SimulationTools({
  page,
}: {
  page: BuildWorkspacePage
}) {
  return (
    <div className="bhd">
      <nav className="bhd-mode" aria-label="Simulation tools">
        {WORKSPACE_TOOLS.map((entry) => (
          <AxLink
            className={`bhd-mode-opt${entry.id === page ? ' is-at' : ''}`}
            key={entry.id}
            to={entry.to}
            aria-current={entry.id === page ? 'page' : undefined}
          >
            {entry.name}
          </AxLink>
        ))}
      </nav>
    </div>
  )
}
