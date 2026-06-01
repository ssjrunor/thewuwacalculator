/*
  Author: Runor Ewhro
  Description: Memoizes context-menu builders against their dynamic inputs so
               callers can hand stable item factories to shared menu surfaces.
*/

import { useMemo } from 'react'
import { useRtChrmMen } from '@/shared/context-menu/RouteCtx.tsx'
import {
  usePtnlCalcC,
} from '@/modules/calculator/features/main/lib/ctx.tsx'
import { calcBuilder } from '@/modules/calculator/context-menu/calcCtxBuilders.tsx'

function mssnCalcMenu(): never {
  throw new Error('Calculator context menus are only available within CalculatorProvider')
}

export function useCtxBuilder() {
  const rtChrmMenu = useRtChrmMen()
  const calcMenu = usePtnlCalcC()

  return useMemo(() => ({
    calculator: calcMenu
        ? {
          ...calcMenu.builders.calculator,
          actions: {
            openResonatorPicker: calcMenu.openResPckr,
            openSkillData: calcMenu.openSkllData,
            getSkillDataTarget: calcMenu.getSkillData,
          },
        }
        : {
          workspace: mssnCalcMenu,
          more: mssnCalcMenu,
          damage: {
            row: mssnCalcMenu,
          },
          rotation: {
            pane: mssnCalcMenu,
            item: mssnCalcMenu,
          },
          optimizer: {
            pane: mssnCalcMenu,
          },
          echo: {
            pane: calcBuilder.calculator.echo.pane,
            emptySlot: calcBuilder.calculator.echo.emptySlot,
            slot: calcBuilder.calculator.echo.slot,
            invCard: calcBuilder.calculator.echo.invCard,
            invBld: calcBuilder.calculator.echo.invMk,
            readOnly: calcBuilder.calculator.echo.readOnly,
          },
          actions: {
            openResonatorPicker: mssnCalcMenu,
            openSkillData: mssnCalcMenu,
            getSkillDataTarget: mssnCalcMenu,
          },
        },
    routeChrome: {
      ...rtChrmMenu.builders.routeChrome,
      actions: rtChrmMenu.actions,
    },
  }), [calcMenu, rtChrmMenu.actions, rtChrmMenu.builders.routeChrome])
}
