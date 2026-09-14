/*
  Author: Runor Ewhro
  Description: Owns app modal behavior and state transitions for the ui module.
*/

import type { CSSProperties, ReactNode } from 'react'
import { mainPortal } from '@/shared/lib/portalTarget'
import { AppDialog } from '@/shared/ui/AppDialog'

export interface AppModalState {
  visible: boolean
  open: boolean
  closing: boolean
}

export type AppModalTone = 'info' | 'warn' | 'danger'
export type AppModalSize = 'regular' | 'wide' | 'x-wide'

interface AppMdlClss {
  contentClass: string
}

interface AppMdlPrps {
  state: AppModalState
  variant?: string
  tone?: AppModalTone
  size?: AppModalSize
  parserView?: 'instructions' | 'preview'
  ariaLabel?: string
  ariaLabelBy?: string
  ariaDscrBy?: string
  style?: CSSProperties
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
          'app-modal-panel amdl-panel amdl-panel--auto picker-modal-panel',
          size === 'wide' ? 'picker-modal-panel--wide' : '',
        ].filter(Boolean).join(' '),
      }
    case 'confirmation':
      return {
        contentClass: `app-modal-panel confirmation-modal confirmation-modal--${tone}`,
      }
    case 'app-status':
      return {
        contentClass: 'app-modal-panel amdl-panel amdl-panel--auto app-status-modal',
      }
    case 'suggestions':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto suggestions-modal' }
    case 'suggestions-modal--narrow':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto suggestions-modal suggestions-modal--narrow' }
    case 'suggestions-modal--mid':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto suggestions-modal suggestions-modal--mid' }
    case 'suggestions-modal--echoes':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto suggestions-modal suggestions-modal--echoes' }
    case 'suggestions-random':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto suggestions-modal suggestions-modal--random' }
    case 'team-config':
      return { contentClass: 'app-modal-panel mcc-modal' }
    case 'weapon-console':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto weapon-console-panel' }
    case 'enemy-console':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto enemy-console-panel' }
    case 'weapon-config':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto wcfg-modal' }
    case 'set-conditionals':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto ssc-modal' }
    case 'optimizer':
      return { contentClass: 'app-modal-panel optimizer-modal-panel' }
    case 'optimizer-rules':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto optimizer-rules-panel' }
    case 'manual-buffs':
      return { contentClass: 'app-modal-panel amdl-panel mb-adv-modal' }
    case 'buff-presets':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto buff-preset-panel' }
    case 'echo-edit':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto echo-edit-panel' }
    case 'echo-quick-setup':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto echo-quick-setup-panel' }
    case 'echo-parser':
      return { contentClass: `app-modal-panel amdl-panel amdl-panel--auto echo-parser-panel ${parserView ?? 'single'}` }
    case 'skills':
      return { contentClass: 'app-modal-panel amdl-panel skills-modal-content skill-data-panel' }
    case 'skill-menu':
      return {
        contentClass: 'app-modal-panel amdl-panel skill-menu-panel',
      }
    case 'settings':
      return {
        contentClass: 'app-modal-panel amdl-panel rtcfg-panel',
      }
    case 'condition-browser':
      return {
        contentClass: 'app-modal-panel amdl-panel cnv-panel',
      }
    case 'rotation-editor':
      return {
        contentClass: [
          'app-modal-panel amdl-panel amdl-panel--auto skills-modal-content rotation-editor-modal',
          size === 'wide' ? 'rotation-editor-modal--wide' : size === 'x-wide' ? 'rotation-editor-modal--x-wide' : '',
        ].filter(Boolean).join(' '),
      }
    case 'feature-conditions':
      return { contentClass: 'app-modal-panel feature-conditions-modal' }
    case 'inventory':
      return {
        contentClass: 'app-modal-panel amdl-panel amdl-panel--auto picker-modal-panel--wide echo-bag-modal__panel',
      }
    case 'saved-rotation-editor':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto saved-rotation-editor-modal' }
    case 'rotation-share':
      return { contentClass: 'app-modal-panel amdl-panel amdl-panel--auto rot-share-modal' }
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
  style,
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
      contentStyle={style}
      ariaLabel={ariaLabel}
      ariaLabelBy={ariaLabelBy}
      ariaDscrBy={ariaDscrBy}
      onClose={onClose}
    >
      {children}
    </AppDialog>
  )
}
