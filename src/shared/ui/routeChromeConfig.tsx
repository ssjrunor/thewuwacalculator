/*
  Author: Runor Ewhro
  Description: defines the authored route chrome navigation and legacy view
               entries consumed by sidebar and route context menus.
*/

import type { ComponentType as CompType } from 'react'
import type { LeftPaneView } from '@/domain/entities/appState'
import { GiPokecog } from 'react-icons/gi'
import { FaInfo, FaQuestion } from 'react-icons/fa'
import { ImHistory } from 'react-icons/im'
import { TbGoGame, TbMathFunction } from 'react-icons/tb'
import { APP_NAVIGATION } from '@/shared/lib/appRoutes'

export interface RouteNavLink {
  to: string
  label: string
  Icon: CompType<{ size?: number | string; className?: string }>
  iconClssName?: string
}

export interface LegacyCalculatorView {
  key: LeftPaneView
  label: string
  icon: string
}

export const rtNavLnks: RouteNavLink[] = [
  { to: APP_NAVIGATION.home.to, label: APP_NAVIGATION.home.name, Icon: TbGoGame },
  { to: APP_NAVIGATION.modulation.to, label: APP_NAVIGATION.modulation.name, Icon: TbMathFunction },
  { to: APP_NAVIGATION.rotation.to, label: APP_NAVIGATION.rotation.name, Icon: TbGoGame },
  { to: APP_NAVIGATION.showcase.to, label: APP_NAVIGATION.showcase.name, Icon: FaInfo },
  { to: APP_NAVIGATION.optimizer.to, label: APP_NAVIGATION.optimizer.name, Icon: GiPokecog },
  { to: APP_NAVIGATION.calibration.to, label: APP_NAVIGATION.calibration.name, Icon: GiPokecog, iconClssName: 'settings-icon' },
  { to: APP_NAVIGATION.info.to, label: APP_NAVIGATION.info.name, Icon: FaInfo },
  { to: APP_NAVIGATION.guides.to, label: APP_NAVIGATION.guides.name, Icon: FaQuestion, iconClssName: 'help-icon' },
  { to: APP_NAVIGATION.docs.to, label: APP_NAVIGATION.docs.name, Icon: TbMathFunction, iconClssName: 'docs-icon' },
  { to: APP_NAVIGATION.changelog.to, label: APP_NAVIGATION.changelog.name, Icon: ImHistory, iconClssName: 'changelog-icon' },
]

export const legacyCalculatorViews: LegacyCalculatorView[] = [
  { key: 'resonators', label: 'Resonators', icon: 'resonators' },
  { key: 'weapon', label: 'Weapon', icon: 'weapon' },
  { key: 'echoes', label: 'Echoes', icon: 'echoes' },
  { key: 'suggestions', label: 'Suggestions', icon: 'suggestions' },
  { key: 'teams', label: 'Team Buffs', icon: 'teams' },
  { key: 'enemy', label: 'Enemy', icon: 'enemy' },
  { key: 'buffs', label: 'Custom Bonuses', icon: 'buffs' },
  { key: 'rotations', label: 'Rotation', icon: 'rotations' },
]
