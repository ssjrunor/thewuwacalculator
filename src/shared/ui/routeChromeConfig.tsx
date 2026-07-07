/*
  Author: Runor Ewhro
  Description: defines the authored route chrome navigation and calculator view
               entries consumed by sidebar and route context menus.
*/

import type { ComponentType as CompType } from 'react'
import type { LeftPaneView } from '@/domain/entities/appState'
import { GiPokecog } from 'react-icons/gi'
import { FaInfo, FaQuestion } from 'react-icons/fa'
import { ImHistory } from 'react-icons/im'
import { TbGoGame, TbMathFunction } from 'react-icons/tb'

export interface RouteNavLink {
  to: string
  label: string
  Icon: CompType<{ size?: number; className?: string }>
  iconClssName?: string
}

export interface RtCalcView {
  key: LeftPaneView
  label: string
  icon: string
}

export const rtNavLnks: RouteNavLink[] = [
  { to: '/calculator', label: 'Calculator', Icon: TbGoGame },
  { to: '/settings', label: 'Settings', Icon: GiPokecog, iconClssName: 'settings-icon' },
  { to: '/info', label: 'Info', Icon: FaInfo },
  { to: '/guides', label: 'Guides', Icon: FaQuestion, iconClssName: 'help-icon' },
  { to: '/docs', label: 'Docs', Icon: TbMathFunction, iconClssName: 'docs-icon' },
  { to: '/changelog', label: 'Changelog', Icon: ImHistory, iconClssName: 'changelog-icon' },
]

export const rtCalcVws: RtCalcView[] = [
  { key: 'resonators', label: 'Resonators', icon: 'resonators' },
  { key: 'weapon', label: 'Weapon', icon: 'weapon' },
  { key: 'echoes', label: 'Echoes', icon: 'echoes' },
  { key: 'suggestions', label: 'Suggestions', icon: 'suggestions' },
  { key: 'teams', label: 'Team Buffs', icon: 'teams' },
  { key: 'enemy', label: 'Enemy', icon: 'enemy' },
  { key: 'buffs', label: 'Custom Bonuses', icon: 'buffs' },
  { key: 'rotations', label: 'Rotation', icon: 'rotations' },
]
