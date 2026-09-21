/*
  Author: Runor Ewhro
  Description: Hosts inventory and saved-Echo editing sessions, resolves equip
               targets, and commits draft loadout changes to scenario state.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import type { SavedBuild, SavedEcho } from '@/domain/entities/inventoryStorage'
import {
  cloneEchoFor,
  cloneEchoLoadout,
} from '@/domain/entities/inventoryStorage'
import { initWpnStts } from '@/engine/runtime/sourceStateInit'
import { useAppStore } from '@/application/state'
import { selActRt, selInvSg, selScenarioProfiles } from '@/application/state'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { getWpnById } from '@/data/catalog/weaponCatalogService'
import { MODAL_EXIT_MS, useAppModal } from '@/shared/ui/useAppModal'
import { mainPortal } from '@/shared/lib/portalTarget'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { InvMdl } from '@/modules/simulation/features/inventory/InventoryModal'
import { Edit } from '@/modules/simulation/features/echoes/Edit.tsx'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'

export function InvLyr({ onReady }: { onReady: () => void }) {
  const invOpen = useAppStore((state) => state.invOpen)
  const invEchoSrch = useAppStore((state) => state.invEchoQ)
  const setInvOpen = useAppStore((state) => state.setInvOpen)
  const setInvEchoSr = useAppStore((state) => state.setInvEchoQ)
  const runtime = useAppStore(selActRt)
  const maxWpnOnInit = useAppStore((state) => state.ui.preferences.maxResOnInit)
  const invSg = useAppStore(selInvSg)
  const updActResRt = useAppStore((state) => state.updActRt)
  const clnpNvldInvC = useAppStore((state) => state.cleanInvEcho)
  const showToast = useTstStr((state) => state.show)
  const [dtngInvEchoN, setInvEchoId] = useState<string | null>(null)
  const [dtngInvEchoC, setInvEchoC] = useState(false)
  const editEchoClsT = useRef<number | null>(null)
  const {
    closing: invClsn,
    hide: hideInvMdl,
    open: invDlgOpen,
    show: showInvMdl,
    visible: invVsbl,
  } = useAppModal()
  const mdlPrtlTgt = mainPortal()
  const runtimeSession = useConfigurationSession({
    source: runtime,
    active: invVsbl,
    commit: (reducer) => updActResRt((current) => reducer(current) ?? current),
  })

  const clrEditEchoC = useCallback(() => {
    if (editEchoClsT.current !== null) {
      window.clearTimeout(editEchoClsT.current)
      editEchoClsT.current = null
    }
  }, [])

  const rstDtngInvEc = useCallback(() => {
    clrEditEchoC()
    setInvEchoC(false)
    setInvEchoId(null)
  }, [clrEditEchoC])

  const openDtngInvE = useCallback((entryId: string) => {
    clrEditEchoC()
    setInvEchoC(false)
    setInvEchoId(entryId)
  }, [clrEditEchoC])

  const clsDtngInvEc = useCallback(() => {
    if (!dtngInvEchoN) {
      return
    }

    clrEditEchoC()
    setInvEchoC(true)
    editEchoClsT.current = window.setTimeout(() => {
      setInvEchoC(false)
      setInvEchoId(null)
      editEchoClsT.current = null
    }, MODAL_EXIT_MS)
  }, [clrEditEchoC, dtngInvEchoN])

  useEffect(() => () => {
    clrEditEchoC()
  }, [clrEditEchoC])

  useEffect(() => {
    const removedCount = clnpNvldInvC()

    if (removedCount > 0) {
      showToast({
        content: `Cleaned ${removedCount} invalid inventory echo${removedCount === 1 ? '' : 'es'}.`,
        variant: 'warning',
        duration: 3600,
      })
    }
  }, [clnpNvldInvC, showToast])

  useEffect(() => {
    if (invOpen) {
      showInvMdl()
      return
    }

    hideInvMdl(() => {
      if (!invOpen) {
        rstDtngInvEc()
      }
    })
  }, [hideInvMdl, invOpen, rstDtngInvEc, showInvMdl])

  if (!runtime) {
    return null
  }

  const activeSeed = getResSeedBy(runtime.id)

  return (
    <>
      {invVsbl ? (
        <MntdInvLyr
          runtime={runtimeSession.draft ?? runtime}
          actSeedName={activeSeed?.name ?? runtime.id}
          visible={invVsbl}
          open={invDlgOpen}
          closing={invClsn}
          portalTarget={mdlPrtlTgt}
          invSg={invSg}
          editingEchoId={dtngInvEchoN}
          dtngInvEchqm={dtngInvEchoC}
          ntlEchoSrch={invEchoSrch}
          onClose={() => {
            setInvOpen(false)
            setInvEchoSr('')
            rstDtngInvEc()
          }}
          onEditInvEcho={openDtngInvE}
          onReady={onReady}
          onClsEchoDtr={clsDtngInvEc}
          onQpInvEcho={(entry, slotIndex) => {
            runtimeSession.update((prev) => {
              if (!prev) return prev
              const nextEchoes = [...prev.build.echoes]
              nextEchoes[slotIndex] = cloneEchoFor(entry.echo, slotIndex)
              return {
                ...prev,
                build: {
                  ...prev.build,
                  echoes: nextEchoes,
                },
              }
            })
          }}
          onQpInvBld={(entry) => {
            const seed = getResSeedBy(runtime.id)
            const savedWeapon = entry.build.weapon.id ? getWpnById(entry.build.weapon.id) : null
            const wpnTypeMtch = !seed || !savedWeapon || savedWeapon.weaponType === seed.weaponType

            runtimeSession.update((prev) => {
              if (!prev) return prev
              const nextRuntime = {
                ...prev,
                build: {
                  ...prev.build,
                  ...(wpnTypeMtch ? { weapon: { ...entry.build.weapon } } : {}),
                  echoes: cloneEchoLoadout(entry.build.echoes),
                },
              }

              return wpnTypeMtch
                ? initWpnStts(nextRuntime, {
                  weaponId: entry.build.weapon.id,
                  prevWpnId: prev.build.weapon.id,
                  maxed: maxWpnOnInit,
                })
                : nextRuntime
            })

            if (!wpnTypeMtch) {
              useTstStr.getState().show({
                content: `Oof... ${savedWeapon?.name ?? 'saved weapon'} isn't compatible with ${seed?.name ?? 'this resonator'}. Geared in echoes tho. ദ്ദി˙ ᴗ ˙ )`,
                variant: 'warning',
              })
            } else {
              useTstStr.getState().show({
                content: `Geared~ ദ്ദി ˉ꒳ˉ )✧`,
                variant: 'success',
                duration: 3000,
              })
            }
          }}
        />
      ) : null}
    </>
  )
}

function MntdInvLyr(props: {
  runtime: NonNullable<ReturnType<typeof selActRt>>
  actSeedName: string
  visible: boolean
  open: boolean
  closing: boolean
  portalTarget: HTMLElement | null
  invSg: ReturnType<typeof selInvSg>
  editingEchoId: string | null
  dtngInvEchqm: boolean
  ntlEchoSrch: string
  onClose: () => void
  onEditInvEcho: (entryId: string) => void
  onReady: () => void
  onClsEchoDtr: () => void
  onQpInvEcho: (entry: SavedEcho, slotIndex: number) => void
  onQpInvBld: (entry: SavedBuild) => void
}) {
  const invChs = useAppStore((state) => state.library.echoes)
  const invBlds = useAppStore((state) => state.library.builds)
  const addEchoesToInv = useAppStore((state) => state.addInvEchoes)
  const updInvMk = useAppStore((state) => state.updInvBuild)
  const rmInvMk = useAppStore((state) => state.rmInvBuild)
  const clrInvBlds = useAppStore((state) => state.clrInvBuild)
  const updEchoInInv = useAppStore((state) => state.updInvEcho)
  const rmEchoFromIn = useAppStore((state) => state.rmInvEcho)
  const clrInvChs = useAppStore((state) => state.clrInvEcho)
  const cleanInvalidEchoes = useAppStore((state) => state.cleanInvEcho)
  const showToast = useTstStr((state) => state.show)

  useEffect(() => {
    if (!props.open) {
      return undefined
    }

    // Chunk resolution precedes the modal commit; one frame keeps the loader
    // active until the opened dialog is eligible to paint.
    const frame = window.requestAnimationFrame(props.onReady)
    return () => window.cancelAnimationFrame(frame)
  }, [props.onReady, props.open])

  const dtngInvEchoE = props.editingEchoId
    ? invChs.find((entry) => entry.id === props.editingEchoId) ?? null
    : null

  const saveInitEchoes = useCallback(() => {
    const cleanedCount = cleanInvalidEchoes()
    const profiles = selScenarioProfiles(useAppStore.getState())
    const equippedEchoes = Object.values(profiles)
      .flatMap((profile) => profile.runtime.build.echoes)
      .filter((echo): echo is EchoInstance => echo != null)
    const echoes = equippedEchoes.filter((echo) => getEchoById(echo.id))

    if (echoes.length === 0) {
      showToast({
        content: cleanedCount > 0
          ? `Cleaned ${cleanedCount} invalid inventory echo${cleanedCount === 1 ? '' : 'es'}. No valid equipped echoes found.`
          : 'No initialized resonators have valid echoes equipped.',
        variant: 'warning',
        duration: 2800,
      })
      return
    }

    const added = addEchoesToInv(echoes)
    if (added.length === 0) {
      showToast({
        content: cleanedCount > 0
          ? `Cleaned ${cleanedCount} invalid inventory echo${cleanedCount === 1 ? '' : 'es'}. All valid equipped echoes are already in inventory.`
          : 'All valid initialized resonator echoes are already in inventory.',
        variant: 'warning',
        duration: 3000,
      })
      return
    }

    showToast({
      content: cleanedCount > 0
        ? `Cleaned ${cleanedCount} invalid and saved ${added.length} equipped echo${added.length === 1 ? '' : 'es'} to inventory.`
        : `Saved ${added.length} equipped echo${added.length === 1 ? '' : 'es'} to inventory.`,
      variant: 'success',
      duration: 2800,
    })
  }, [addEchoesToInv, cleanInvalidEchoes, showToast])

  return (
    <>
      <InvMdl
        key={props.ntlEchoSrch ? `echo-search:${props.ntlEchoSrch}` : 'inventory'}
        visible={props.visible}
        open={props.open}
        closing={props.closing}
        portalTarget={props.portalTarget}
        resonatorId={props.runtime.id}
        currentBuild={{
          weapon: props.runtime.build.weapon,
          echoes: props.runtime.build.echoes,
        }}
        invChs={invChs}
        invBlds={invBlds}
        ntlEchoSrch={props.ntlEchoSrch}
        bldUsrsById={props.invSg.buildUseByBldId}
        echoSgByUid={props.invSg.echoUseByUid}
        onClose={props.onClose}
        onQpInvEcho={props.onQpInvEcho}
        onEditEcho={(entry: SavedEcho) => props.onEditInvEcho(entry.id)}
        onAddInvChs={(echoes) => addEchoesToInv(echoes).length}
        onSaveInitEchoes={saveInitEchoes}
        onRmvInvEcho={rmEchoFromIn}
        onRmvInvChs={(entryIds) => {
          for (const entryId of entryIds) {
            rmEchoFromIn(entryId)
          }
        }}
        onClrInvChs={clrInvChs}

        onQpInvBld={props.onQpInvBld}
        onPdtInvBlgk={(entryId, name) => updInvMk(entryId, { name })}
        onRmvInvBld={rmInvMk}
        onClrInvBlds={clrInvBlds}
      />

      {dtngInvEchoE ? (
        <Edit
          visible={true}
          open={!props.dtngInvEchqm}
          closing={props.dtngInvEchqm}
          portalTarget={props.portalTarget}
          echo={dtngInvEchoE.echo}
          slotIndex={0}
          onSave={(updated: EchoInstance) => {
            updEchoInInv(dtngInvEchoE.id, {
              ...updated,
              uid: dtngInvEchoE.echo.uid,
            })
            props.onClsEchoDtr()
          }}
          onClose={props.onClsEchoDtr}
        />
      ) : null}
    </>
  )
}
