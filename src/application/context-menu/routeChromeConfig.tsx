/*
  Author: Runor Ewhro
  description: defines the authored route chrome navigation consumed by the
               sidebar and route context menus.
*/

import type { ComponentType as CompType } from 'react'
import { FileText, Lightbulb, ListOrdered, Settings, Trophy } from 'lucide-react'
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

export const rtNavLnks: RouteNavLink[] = [
  { to: APP_NAVIGATION.home.to, label: APP_NAVIGATION.home.name, Icon: TbGoGame },
  { to: APP_NAVIGATION.modulation.to, label: APP_NAVIGATION.modulation.name, Icon: TbMathFunction },
  { to: APP_NAVIGATION.rotation.to, label: APP_NAVIGATION.rotation.name, Icon: ListOrdered },
  { to: APP_NAVIGATION.showcase.to, label: APP_NAVIGATION.showcase.name, Icon: FaInfo },
  { to: APP_NAVIGATION.suggestions.to, label: APP_NAVIGATION.suggestions.name, Icon: Lightbulb },
  { to: APP_NAVIGATION.optimizer.to, label: APP_NAVIGATION.optimizer.name, Icon: GiPokecog },
  { to: APP_NAVIGATION.leaderboard.to, label: APP_NAVIGATION.leaderboard.name, Icon: Trophy },
  { to: APP_NAVIGATION.calibration.to, label: APP_NAVIGATION.calibration.name, Icon: Settings, iconClssName: 'settings-icon' },
  { to: APP_NAVIGATION.guides.to, label: APP_NAVIGATION.guides.name, Icon: FaQuestion, iconClssName: 'help-icon' },
  { to: APP_NAVIGATION.docs.to, label: APP_NAVIGATION.docs.name, Icon: FileText, iconClssName: 'docs-icon' },
  { to: APP_NAVIGATION.changelog.to, label: APP_NAVIGATION.changelog.name, Icon: ImHistory, iconClssName: 'chl-icon' },
]
