/*
  Author: Runor Ewhro
  Description: the head the echo strip stands under on every build surface. it
               brackets the strip: the readings and the writes share the line
               above, and the word for what these five echoes are sits inside
               the rule rather than beside it. the strip already shows how many
               slots are filled, so the head reports the one number it cannot:
               the cost spent against the cap.
*/

import { useCallback, useMemo } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import {
  cloneEchoLoadout,
  equalBuildSnapshots,
  saveEchoSlots,
} from '@/domain/entities/inventoryStorage.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { cmptTtlEchoC, MAX_ECHO_COST } from '@/modules/simulation/features/echoes/lib/echoes.ts'
import { QuickSetup } from '@/modules/simulation/features/echoes/QuickSetup.tsx'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal.tsx'
import { useConfirm } from '@/app/hooks/useConfirmation.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'

interface HeadTool {
  key: string
  label: string
  title: string
  disabled?: boolean
  danger?: boolean
  go?: boolean
  onSelect: () => void
}

export function LoadoutHead({
  title = 'Echo Loadout',
  runtime,
  resonatorName,
  echoes,
  proposal = false,
  editable = true,
  canSaveEcho,
  onEchoes,
  onForge,
  onEquip,
  aside,
  headRef,
}: {
  /* surfaces that keep a disposable workspace name it themselves */
  title?: string
  runtime: ResRuntime | null
  resonatorName?: string | null
  /* the loadout on show: what is equipped, or what a surface is proposing */
  echoes: Array<EchoInstance | null>
  proposal?: boolean
  editable?: boolean
  canSaveEcho: (echo: EchoInstance) => boolean
  onEchoes?: (echoes: Array<EchoInstance | null>) => void
  /* a surface with its own forge (the optimizer's workspace has one) hands it
     over rather than letting the head open a second one */
  onForge?: () => void
  /* a proposal cannot be taken off, only put on */
  onEquip?: () => void
  aside?: ReactNode
  headRef?: RefObject<HTMLElement | null>
}) {
  const showToast = useTstStr((state) => state.show)
  const savedBuilds = useAppStore((state) => state.library.builds)
  const addBuildToInv = useAppStore((state) => state.addInvBuild)
  const addEchoToInv = useAppStore((state) => state.addInvEcho)
  const confirmation = useConfirm()
  const forgeModal = useAppModal()

  const cost = useMemo(() => cmptTtlEchoC(echoes), [echoes])
  const over = cost > MAX_ECHO_COST
  const filled = echoes.filter(Boolean).length

  const savableSlots = useMemo(() => echoes.reduce<number[]>((slots, echo, index) => {
    if (echo && canSaveEcho(echo)) slots.push(index)
    return slots
  }, []), [canSaveEcho, echoes])

  // a build is only "saved" while the bag holds this exact weapon and loadout
  const alreadySaved = useMemo(() => {
    if (!runtime) return false
    return savedBuilds.some((entry) => equalBuildSnapshots(entry.build, {
      weapon: runtime.build.weapon,
      echoes,
    }))
  }, [echoes, runtime, savedBuilds])

  const onSaveBuild = useCallback(() => {
    if (!runtime || alreadySaved) return

    addBuildToInv({
      resonatorId: runtime.id,
      resonatorName: resonatorName ?? runtime.id,
      build: {
        weapon: { ...runtime.build.weapon },
        echoes: cloneEchoLoadout(echoes),
      },
    })

    showToast({
      content: proposal ? 'Result saved to your builds.' : 'Build saved.',
      variant: 'success',
      duration: 2600,
    })
  }, [addBuildToInv, alreadySaved, echoes, proposal, resonatorName, runtime, showToast])

  const onSaveAll = useCallback(() => {
    if (savableSlots.length === 0) return
    const { savedCount, nextEchoes } = saveEchoSlots(echoes, savableSlots, addEchoToInv)
    if (nextEchoes) onEchoes?.(nextEchoes)

    showToast({
      content: `Saved ${savedCount} echo${savedCount === 1 ? '' : 'es'} to bag.`,
      variant: 'success',
      duration: 2600,
    })
  }, [addEchoToInv, echoes, onEchoes, savableSlots, showToast])

  const onUnequipAll = useCallback(() => {
    confirmation.confirm({
      title: 'Take them all off?',
      message: 'Every echo comes out of this loadout. Saved echoes stay in your bag.',
      confirmLabel: 'Unequip all',
      variant: 'danger',
      onConfirm: () => onEchoes?.([null, null, null, null, null]),
    })
  }, [confirmation, onEchoes])

  const tools: HeadTool[] = [
    {
      key: 'forge',
      label: 'Forge',
      title: 'Build a loadout from your bag',
      disabled: !editable || !runtime,
      onSelect: onForge ?? forgeModal.show,
    },
    {
      key: 'save',
      label: alreadySaved ? 'Saved' : 'Save build',
      title: proposal ? 'Keep this result without equipping it' : 'Save this build',
      disabled: !runtime || alreadySaved,
      onSelect: onSaveBuild,
    },
    {
      key: 'save-all',
      label: 'Save all',
      title: savableSlots.length === 0
        ? 'Every echo here is already in your bag'
        : `Save ${savableSlots.length} echo${savableSlots.length === 1 ? '' : 'es'} to your bag`,
      disabled: !editable || savableSlots.length === 0,
      onSelect: onSaveAll,
    },
    proposal
      ? {
        key: 'equip',
        label: 'Equip',
        title: 'Equip this build',
        disabled: !onEquip,
        go: true,
        onSelect: () => onEquip?.(),
      }
      : {
        key: 'unequip',
        label: 'Unequip',
        title: 'Take every echo out of this loadout',
        disabled: !editable || filled === 0,
        danger: true,
        onSelect: onUnequipAll,
      },
  ]

  return (
    <header className="lho" ref={headRef}>
      <div className="lho-line">
        <h3 className="lho-title">{title}</h3>
        <span className="lho-read"
          data-over={over ? 'true' : undefined}
          title={over ? `${cost} cost, ${cost - MAX_ECHO_COST} over the cap` : `${cost} of ${MAX_ECHO_COST} cost spent`}
        >
          cost {cost}/{MAX_ECHO_COST}
        </span>

        {aside}

        <div className="lho-tools" role="group" aria-label="Echo build actions">
          {tools.map((tool, index) => (
            <span key={tool.key} className="lho-tool-slot">
              {index > 0 ? <span className="lho-sep" aria-hidden="true" /> : null}
              <button
                type="button"
                className={[
                  'lho-tool',
                  tool.danger ? 'lho-tool--danger' : '',
                  tool.go ? 'lho-tool--go' : '',
                ].filter(Boolean).join(' ')}
                title={tool.title}
                disabled={tool.disabled}
                onClick={tool.onSelect}
              >
                {tool.label}
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="lho-rule">
        <span className="lho-seg lho-seg--lead" aria-hidden="true" />
        <b className="lho-word" data-proposed={proposal ? 'true' : undefined}>
          {proposal ? 'Proposed' : 'Equipped'}
        </b>
        <span className="lho-seg lho-seg--rest" aria-hidden="true" />
      </div>

      {!onForge && forgeModal.visible && runtime ? (
        <QuickSetup
          visible={forgeModal.visible}
          open={forgeModal.open}
          closing={forgeModal.closing}
          portalTarget={mainPortal()}
          currentEchoes={echoes}
          onClose={forgeModal.hide}
          onGenerate={(next) => {
            onEchoes?.(next)
            showToast({
              content: 'Echo build forged.',
              variant: 'success',
              duration: 2600,
            })
            forgeModal.hide()
          }}
        />
      ) : null}

      <ConfirmHost control={confirmation} portalTarget={mainPortal()} />
    </header>
  )
}
