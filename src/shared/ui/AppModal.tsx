/*
  Author: Runor Ewhro
  Description: Wraps the shared app dialog with calculator-specific variants
               and portal defaults for modal surfaces across the app.
*/

import type { ReactNode } from 'react'
import { mainPortal } from '@/shared/lib/portalTarget'
import { AppDialog } from '@/shared/ui/AppDialog'

export interface AppMdlStt {
  visible: boolean
  open: boolean
  closing: boolean
}

export type AppModalTone = 'info' | 'danger'
export type AppModalSize = 'regular' | 'wide'

interface AppMdlClss {
  contentClass: string
}

interface AppMdlPrps {
  state: AppMdlStt
  variant?: string
  tone?: AppModalTone
  size?: AppModalSize
  parserView?: 'instructions' | 'preview'
  ariaLabel?: string
  ariaLabelBy?: string
  ariaDscrBy?: string
  onClose: () => void
  children: ReactNode
}

function getVarClss(
  variant: string,
  {
    parserView,
    size = 'regular',
    tone = 'info',
  }: Pick<AppMdlPrps, 'parserView' | 'size' | 'tone'>,
): AppMdlClss {
  switch (variant) {
    case 'picker':
      return {
        contentClass: [
          'app-modal-panel',
          size === 'wide' ? 'app-modal-panel--wide' : '',
        ].filter(Boolean).join(' '),
      }
    case 'confirmation':
      return {
        contentClass: `app-modal-panel confirmation-modal confirmation-modal--${tone}`,
      }
    case 'app-status':
      return {
        contentClass: 'app-modal-panel app-status-modal',
      }
    case 'suggestions':
      return { contentClass: 'app-modal-panel suggestions-modal' }
    case 'suggestions-modal--narrow':
      return { contentClass: 'app-modal-panel suggestions-modal suggestions-modal--narrow' }
    case 'suggestions-modal--mid':
      return { contentClass: 'app-modal-panel suggestions-modal suggestions-modal--mid' }
    case 'suggestions-random':
      return { contentClass: 'app-modal-panel suggestions-modal suggestions-modal--random' }
    case 'team-config':
      return { contentClass: 'app-modal-panel app-modal-panel--wide team-member-config-modal' }
    case 'set-conditionals':
      return { contentClass: 'app-modal-panel ssc-modal' }
    case 'optimizer':
      return { contentClass: 'app-modal-panel optimizer-modal-panel' }
    case 'optimizer-rules':
      return { contentClass: 'app-modal-panel optimizer-rules-panel' }
    case 'manual-buffs':
      return { contentClass: 'app-modal-panel mb-adv-modal' }
    case 'buff-presets':
      return { contentClass: 'app-modal-panel buff-preset-panel' }
    case 'echo-edit':
      return { contentClass: 'app-modal-panel echo-edit-panel' }
    case 'echo-parser':
      return { contentClass: `app-modal-panel echo-parser-panel ${parserView ?? 'single'}` }
    case 'skills':
      return { contentClass: 'app-modal-panel skills-modal-content' }
    case 'skill-menu':
      return {
        contentClass: 'app-modal-panel skill-menu-panel',
      }
    case 'rotation-editor':
      return {
        contentClass: [
          'app-modal-panel skills-modal-content rotation-editor-modal',
          size === 'wide' ? 'rotation-editor-modal--wide' : '',
        ].filter(Boolean).join(' '),
      }
    case 'feature-conditions':
      return { contentClass: 'app-modal-panel feature-conditions-modal' }
    case 'inventory':
      return {
        contentClass: 'app-modal-panel app-modal-panel--wide echo-bag-modal__panel',
      }
    case 'saved-rotation-editor':
      return { contentClass: 'app-modal-panel saved-rotation-editor-modal' }
    case 'rotation-action-list':
      return {
        contentClass: 'app-modal-panel confirmation-modal confirmation-modal--info rotation-action-list-modal',
      }
    case 'default':
    default:
      return { contentClass: 'app-modal-panel' }
  }
}

export function AppModal({
  state,
  variant = 'default',
  tone = 'info',
  size = 'regular',
  parserView,
  ariaLabel,
  ariaLabelBy: ariaLabelBy,
  ariaDscrBy: ariaDscrBy,
  onClose,
  children,
}: AppMdlPrps) {
  const classes = getVarClss(variant, { parserView, size, tone })

  return (
    <AppDialog
      visible={state.visible}
      open={state.open}
      closing={state.closing}
      portalTarget={mainPortal()}
      contentClass={classes.contentClass}
      ariaLabel={ariaLabel}
      ariaLabelBy={ariaLabelBy}
      ariaDscrBy={ariaDscrBy}
      onClose={onClose}
    >
      {children}
    </AppDialog>
  )
}
