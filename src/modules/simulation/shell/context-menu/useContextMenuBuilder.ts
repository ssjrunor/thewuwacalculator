/*
  Author: Runor Ewhro
  Description: Memoizes context-menu builders against their dynamic inputs so
               callers can hand stable item factories to shared menu surfaces.
*/

import { useMemo } from 'react'
import { useRtChrmMen } from '@/application/context-menu/routeMenuContext'
import {
  useOptionalSimulationContext,
} from '@/modules/simulation/shell/context/SimulationContext.tsx'
import { simulationMenuBuilder } from '@/modules/simulation/shell/context-menu/simulationContextBuilders.tsx'

function missingSimulationMenu(): never {
  throw new Error('Simulation context menus are only available within SimulationProvider')
}

export function useCtxBuilder() {
  const rtChrmMenu = useRtChrmMen()
  const simulationMenu = useOptionalSimulationContext()

  return useMemo(() => ({
    simulation: simulationMenu
        ? {
          ...simulationMenu.builders.simulation,
          actions: {
            openResonatorPicker: simulationMenu.openResPckr,
            openSkillData: simulationMenu.openSkllData,
            getSkillDataTarget: simulationMenu.getSkillData,
          },
        }
        : {
          workspace: missingSimulationMenu,
          more: missingSimulationMenu,
          damage: {
            row: missingSimulationMenu,
          },
          rotation: {
            pane: missingSimulationMenu,
            item: missingSimulationMenu,
          },
          optimizer: {
            pane: missingSimulationMenu,
          },
          echo: {
            pane: simulationMenuBuilder.simulation.echo.pane,
            emptySlot: simulationMenuBuilder.simulation.echo.emptySlot,
            slot: simulationMenuBuilder.simulation.echo.slot,
            invCard: simulationMenuBuilder.simulation.echo.invCard,
            invBld: simulationMenuBuilder.simulation.echo.invMk,
            readOnly: simulationMenuBuilder.simulation.echo.readOnly,
          },
          actions: {
            openResonatorPicker: missingSimulationMenu,
            openSkillData: missingSimulationMenu,
            getSkillDataTarget: missingSimulationMenu,
          },
        },
    routeChrome: {
      ...rtChrmMenu.builders.routeChrome,
      actions: rtChrmMenu.actions,
    },
  }), [rtChrmMenu.actions, rtChrmMenu.builders.routeChrome, simulationMenu])
}
