/*
  Author: Runor Ewhro
  Description: Renders the inventory layer surface for the calculator inventory flow.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import type { InventoryEntry, InvEchoEnt } from '@/domain/entities/inventoryStorage'
import {
  cloneEchoFor,
  cloneEchoLdt,
} from '@/domain/entities/inventoryStorage'
import { initWpnStts } from '@/domain/state/sourceStateInit'
import { useAppStore } from '@/domain/state/store'
import { selActRt, selInvSg } from '@/domain/state/selectors'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { getWpnById } from '@/domain/services/weaponCatalogService'
import { APPMDLEXITMS, useAppModal } from '@/shared/ui/useAppModal'
import { mainPortal } from '@/shared/lib/portalTarget'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { InvMdl } from '@/modules/calculator/features/inventory/InventoryModal'
import { Edit } from '@/modules/calculator/features/echoes/Edit.tsx'

// manages the inventory modal layer and the echo/build equip flows.
export function InvLyr() {
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
    }, APPMDLEXITMS)
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
          runtime={runtime}
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
          onClsEchoDtr={clsDtngInvEc}
          onQpInvEcho={(entry, slotIndex) => {
            updActResRt((prev) => {
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

            updActResRt((prev) => {
              const nextRuntime = {
                ...prev,
                build: {
                  ...prev.build,
                  ...(wpnTypeMtch ? { weapon: { ...entry.build.weapon } } : {}),
                  echoes: cloneEchoLdt(entry.build.echoes),
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
  onClsEchoDtr: () => void
  onQpInvEcho: (entry: InvEchoEnt, slotIndex: number) => void
  onQpInvBld: (entry: InventoryEntry) => void
}) {
  const invChs = useAppStore((state) => state.calculator.inventoryEchoes)
  const invBlds = useAppStore((state) => state.calculator.inventoryBuilds)
  const addEchoToInv = useAppStore((state) => state.addInvEcho)
  const addMkToInv = useAppStore((state) => state.addInvBuild)
  const updInvMk = useAppStore((state) => state.updInvBuild)
  const rmInvMk = useAppStore((state) => state.rmInvBuild)
  const clrInvBlds = useAppStore((state) => state.clrInvBuild)
  const updEchoInInv = useAppStore((state) => state.updInvEcho)
  const rmEchoFromIn = useAppStore((state) => state.rmInvEcho)
  const clrInvChs = useAppStore((state) => state.clrInvEcho)

  const dtngInvEchoE = props.editingEchoId
    ? invChs.find((entry) => entry.id === props.editingEchoId) ?? null
    : null

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
        bldSgNmsById={props.invSg.buildUseName}
        echoSgByUid={props.invSg.echoUseByUid}
        onClose={props.onClose}
        onQpInvEcho={props.onQpInvEcho}
        onEditEcho={(entry: InvEchoEnt) => props.onEditInvEcho(entry.id)}
        onAddInvChs={(echoes) => {
          let addedCount = 0

          for (const echo of echoes) {
            if (addEchoToInv(echo)) {
              addedCount += 1
            }
          }

          return addedCount
        }}
        onRmvInvEcho={rmEchoFromIn}
        onRmvInvChs={(entryIds) => {
          for (const entryId of entryIds) {
            rmEchoFromIn(entryId)
          }
        }}
        onClrInvChs={clrInvChs}
        onSaveCurBld={() => {
          addMkToInv({
            resonatorId: props.runtime.id,
            resonatorName: props.actSeedName,
            build: {
              weapon: { ...props.runtime.build.weapon },
              echoes: cloneEchoLdt(props.runtime.build.echoes),
            },
          })
        }}
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
            updEchoInInv(dtngInvEchoE.id, updated)
            props.onClsEchoDtr()
          }}
          onClose={props.onClsEchoDtr}
        />
      ) : null}
    </>
  )
}
