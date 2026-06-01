/*
  Author: Runor Ewhro
  Description: Renders the pane surface for the calculator echoes flow.
*/

import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties as CssProps } from 'react'
import { AnimatePresence as NmtPrsn, motion } from 'motion/react'
import {
  Copy,
  FileImage,
  Save,
  Scissors,
  Trash2,
} from 'lucide-react'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { areMkSnpsQvl, areEchoNstnQ, cloneEchoLdt } from '@/domain/entities/inventoryStorage.ts'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { listStatesFor } from '@/domain/services/gameDataService.ts'
import { getMainEchoS } from '@/domain/services/runtimeSourceService.ts'
import { selActTgtSlc } from '@/domain/state/selectors.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { Edit } from '@/modules/calculator/features/echoes/Edit.tsx'
import { Parser } from '@/modules/calculator/features/echoes/Parser.tsx'
import {
  mkDefEchoNst,
} from '@/modules/calculator/features/echoes/lib/echoPane.ts'
import { cmptTtlEchoC } from '@/modules/calculator/features/echoes/lib/echoes.ts'
import {
  getEchoScrPr,
  getMkScrPrcn,
  getMaxEchoSc,
} from '@/data/scoring/echoScoring.ts'
import type { RtUpdHnd } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { CnfrMdl } from '@/shared/ui/ConfirmationModal.tsx'
import { useAppModal, useAppMdlVl } from '@/shared/ui/useAppModal.ts'
import { useCnfr } from '@/app/hooks/useConfirmation.ts'
import { evalSourceState } from '@/modules/calculator/model/sourceEval.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { IoArchive } from 'react-icons/io5'
import { EchoPicker } from '@/modules/calculator/features/echoes/Picker.tsx'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { useCtxBuilder } from '@/shared/context-menu/useCtxBuilder.ts'
import {
  mkMainEchoPn,
  EchoSetBonus,
  EchoSlot,
  EchoTotals,
  getActEchoSe,
} from '@/modules/calculator/features/echoes/Sections.tsx'
import {
  ECHO_CLIP_KIND,
  ECHO_CLIP_VER,
  pstChsIntoLd,
  readEchoClpb,
  type EchoClipPayload,
  writeEchoClp,
} from '@/modules/calculator/features/echoes/lib/clipboard.ts'
import { useSel } from '@/modules/calculator/lib/sel.tsx'
import { getEchoMptyC, getEchoPaneC, getEchoSlotC } from '@/modules/calculator/features/echoes/lib/ctx.tsx'

const MAX_COST = 12
const CHSSELFCSSCP = 'echoes-pane-selection'

interface CalcChsPaneP {
  runtime: ResRuntime
  onRtPdt: RtUpdHnd
}

export function Echoes({ runtime, onRtPdt: onRtPdt }: CalcChsPaneP) {
  const allEchoes = useMemo(() => listEchoes(), [])
  const invChs = useAppStore((state) => state.calculator.inventoryEchoes)
  const invBlds = useAppStore((state) => state.calculator.inventoryBuilds)
  const selTrgtByOwn = useAppStore(selActTgtSlc)
  const showToast = useTstStr((s) => s.show)
  const confirmation = useCnfr()
  const portalTarget = mainPortal()
  const addEchoToInv = useAppStore((state) => state.addInvEcho)
  const addMkToInv = useAppStore((state) => state.addInvBuild)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const setInvEchoSr = useAppStore((state) => state.setInvEchoQ)
  const setTargetRes = useAppStore((state) => state.setResTgt)
  const activeSeed = useMemo(() => getResSeedBy(runtime.id), [runtime.id])
  const menu = useCtxBuilder()
  const openInv = menu.routeChrome.actions.openInv
  const openInvWthtE = useCallback(() => {
    // opening the inventory from the pane should show the full bag unless a specific equipped echo asked to be found.
    setInvEchoSr('')
    openInv()
  }, [openInv, setInvEchoSr])
  const findEchoInIn = useCallback((echo: EchoInstance) => {
    // prefer the saved uid when the equipped echo matches an inventory entry, otherwise search for the equipped uid
    // itself so temporary echoes still narrow the bag.
    const savedEntry = invChs.find((entry) => areEchoNstnQ(entry.echo, echo))
    setInvEchoSr(savedEntry?.echo.uid ?? echo.uid)
    openInv()
  }, [invChs, openInv, setInvEchoSr])

  const mainEcho = runtime.build.echoes[0]
  const mainEchoDef = useMemo(
      () => (mainEcho ? getEchoById(mainEcho.id) : null),
      [mainEcho],
  )

  const mainEchoSrc = useMemo(() => getMainEchoS(runtime), [runtime])

  const mainEchoStats = useMemo(() => {
    if (!mainEchoSrc) {
      return []
    }

    // main echo runtime states are shown only when their source visibility passes for the current runtime.
    return listStatesFor(mainEchoSrc.type, mainEchoSrc.id).filter((state) =>
        evalSourceState(runtime, runtime, state),
    )
  }, [mainEchoSrc, runtime])

  const pickerModal = useAppMdlVl<number>()
  const editModal = useAppMdlVl<number>()
  const parserModal = useAppModal()
  const pickerSlot = pickerModal.value
  const editSlot = editModal.value

  const [showMainEcho, setShowMainE] = useState(false)
  const hasMainEchoD = Boolean(mainEchoDef && (mainEchoDef.skillDesc || mainEchoStats.length > 0))

  const openPicker = useCallback((slotIndex: number) => {
    pickerModal.show(slotIndex)
  }, [pickerModal])

  const closePicker = () => {
    pickerModal.hide()
  }

  const openEdit = useCallback((slotIndex: number) => {
    editModal.show(slotIndex)
  }, [editModal])

  const closeEdit = () => {
    editModal.hide()
  }

  const onEditSave = (updated: EchoInstance) => {
    if (editSlot === null) return

    onRtPdt((prev) => {
      const next = [...prev.build.echoes]
      next[editSlot] = updated
      return { ...prev, build: { ...prev.build, echoes: next } }
    })

    closeEdit()
  }

  const totalCost = useMemo(() => cmptTtlEchoC(runtime.build.echoes), [runtime.build.echoes])
  const qppdCnt = runtime.build.echoes.filter(Boolean).length

  const slotCost = useMemo(() => {
    if (pickerSlot === null) return 0

    const echo = runtime.build.echoes[pickerSlot]
    if (!echo) return 0

    return getEchoById(echo.id)?.cost ?? 0
  }, [pickerSlot, runtime.build.echoes])

  const maxCostForSl = MAX_COST - totalCost + slotCost

  const handleSelect = (echoId: string) => {
    if (pickerSlot === null) return

    // slot cost is added back before validating so replacing an equipped echo only checks the net build cost.
    const echoDef = getEchoById(echoId)
    if (!echoDef) return
    if (echoDef.cost > maxCostForSl) return

    const previous = runtime.build.echoes[pickerSlot]
    const instance = mkDefEchoNst(echoId, pickerSlot, previous)
    if (!instance) return

    onRtPdt((prev) => {
      const next = [...prev.build.echoes]
      next[pickerSlot] = instance
      return { ...prev, build: { ...prev.build, echoes: next } }
    })
    bumpPickerFreq({
      bucket: 'echo',
      ids: [instance.id],
    })
  }

  const handleClear = () => {
    if (pickerSlot === null) return

    onRtPdt((prev) => {
      const next = [...prev.build.echoes]
      next[pickerSlot] = null
      return { ...prev, build: { ...prev.build, echoes: next } }
    })
  }

  const activeSets = useMemo(() => getActEchoSe(runtime.build.echoes), [runtime.build.echoes])

  const qppdEchoSlot = useMemo(() => runtime.build.echoes.reduce<number[]>((result, echo, index) => {
    // selection order follows slot order rather than render order so copy/cut/paste preserve loadout positions.
    if (echo) {
      result.push(index)
    }

    return result
  }, []), [runtime.build.echoes])
  const selTms = useMemo(
    () => runtime.build.echoes.flatMap((echo, index) => (
      echo ? [{ id: index, val: echo }] : []
    )),
    [runtime.build.echoes],
  )
  const selection = useSel({
    surfaceId: CHSSELFCSSCP,
    ariaLabel: 'Echo selection actions',
    items: selTms,
    ord: qppdEchoSlot,
    av: qppdEchoSlot,
    acts: [
      // echo pane selection uses the same shared shortcut contract as inventory and manual modifiers.
      {
        id: 'echo:copy',
        key: 'copy',
        needsSel: true,
        icon: <Copy size={14} />,
        label: ({ count }) => `Copy (${count})`,
        title: 'Copy selected echoes (Ctrl/Cmd+C)',
        run: async ({ vals }) => {
          const wrote = await copyChsToClp(vals)
          if (wrote) {
            showToast({
              content: `Copied ${vals.length} echo${vals.length === 1 ? '' : 'es'}.`,
              variant: 'success',
              duration: 2200,
            })
          }
        },
      },
      {
        id: 'echo:cut',
        key: 'cut',
        needsSel: true,
        icon: <Scissors size={14} />,
        label: ({ count }) => `Cut (${count})`,
        title: 'Cut selected echoes (Ctrl/Cmd+X)',
        run: async ({ ids, vals }) => {
          const wrote = await copyChsToClp(vals)
          if (!wrote) {
            return
          }

          rmEchoSlts(ids)
          showToast({
            content: `Cut ${vals.length} echo${vals.length === 1 ? '' : 'es'}.`,
            variant: 'success',
            duration: 2200,
          })
        },
      },
      {
        id: 'echo:paste',
        key: 'paste',
        icon: <FileImage size={14} />,
        label: 'Paste',
        title: 'Paste echoes (Ctrl/Cmd+V)',
        float: false,
        run: async () => {
          await pstClpbIntoD()
        },
      },
      {
        id: 'echo:del',
        key: 'delete',
        needsSel: true,
        danger: true,
        icon: <Trash2 size={15} />,
        label: ({ count }) => `Remove (${count})`,
        title: 'Remove selected echoes (Delete / Backspace)',
        run: ({ ids }) => {
          rmEchoSlts(ids)
        },
      },
    ],
  })
  const selMode = selection.selectionMode
  const selEchoSlotL = selection.selectedIdsInOrder
  const ffctSlotNdxs = useMemo(
    () => new Set(selEchoSlotL),
    [selEchoSlotL],
  )

  const hasWeights = useMemo(() => getMaxEchoSc(runtime.id) > 0, [runtime.id])

  const echoScores = useMemo(() => {
    if (!hasWeights) return null

    return runtime.build.echoes.map((echo) =>
        echo ? getEchoScrPr(runtime.id, echo) : null,
    )
  }, [hasWeights, runtime.id, runtime.build.echoes])

  const buildScore = useMemo(() => {
    if (!hasWeights) return null
    return getMkScrPrcn(runtime.id, runtime.build.echoes)
  }, [hasWeights, runtime.id, runtime.build.echoes])

  const mdlPrtlTgt = mainPortal()
  const editEcho = editSlot !== null ? runtime.build.echoes[editSlot] : null

  const currentSaved = useMemo(
      () =>
          invBlds.some((entry) =>
              areMkSnpsQvl(entry.build, {
                weapon: runtime.build.weapon,
                echoes: runtime.build.echoes,
              }),
          ),
      [invBlds, runtime.build.echoes, runtime.build.weapon],
  )

  const mainEchoPnl = mkMainEchoPn(runtime, mainEchoDef, mainEchoStats, onRtPdt)

  const canSaveEcho = useCallback((echo: EchoInstance | null | undefined) => (
      Boolean(echo) && !invChs.some((entry) => areEchoNstnQ(entry.echo, echo))
  ), [invChs])

  const svblQppdChs = useMemo(() => {
    return runtime.build.echoes.filter(
        (echo): echo is EchoInstance => canSaveEcho(echo),
    )
  }, [canSaveEcho, runtime.build.echoes])

  const addEchoSlotT = selection.addToSelection
  const tglEchoSlotS = selection.toggleSelection
  const addEchoSelRn = selection.addRangeToSelection
  const selAllEchoSl = selection.selectAll
  const dslcAllEchoS = selection.deselectAll

  const rmEchoSlts = useCallback((slotIndexes: number[]) => {
    if (slotIndexes.length === 0) {
      return
    }

    onRtPdt((prev) => {
      const nextEchoes = [...prev.build.echoes]

      for (const slotIndex of slotIndexes) {
        nextEchoes[slotIndex] = null
      }

      return {
        ...prev,
        build: { ...prev.build, echoes: nextEchoes },
      }
    })
  }, [onRtPdt])

  const saveChsToInv = useCallback((echoes: EchoInstance[]) => {
    let savedCount = 0

    for (const echo of echoes) {
      if (addEchoToInv(echo)) {
        savedCount += 1
      }
    }

    return savedCount
  }, [addEchoToInv])

  const mkEchoClpbPa = useCallback((echoes: EchoInstance[]): EchoClipPayload => ({
    kind: ECHO_CLIP_KIND,
    version: ECHO_CLIP_VER,
    source: 'loadout',
    resonatorId: runtime.id,
    resName: activeSeed?.name ?? runtime.id,
    echoes,
  }), [activeSeed?.name, runtime.id])

  const copyChsToClp = useCallback(async (echoes: EchoInstance[]) => {
    if (echoes.length === 0) {
      showToast({
        content: 'Nothing to copy yet.',
        variant: 'warning',
        duration: 2600,
      })
      return false
    }

    const wrote = await writeEchoClp(mkEchoClpbPa(echoes))

    if (!wrote) {
      showToast({
        content: 'Clipboard write failed.',
        variant: 'error',
        duration: 3000,
      })
      return false
    }

    return true
  }, [mkEchoClpbPa, showToast])

  const showEchoPstR = useCallback((pastedCount: number, skippedCount: number) => {
    if (pastedCount === 0) {
      showToast({
        content: skippedCount > 0 ? 'Nothing valid to paste here.' : 'Clipboard does not contain an echo.',
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    showToast({
      content:
          skippedCount > 0
              ? `Pasted ${pastedCount} echo${pastedCount === 1 ? '' : 'es'} (${skippedCount} skipped).`
              : `Pasted ${pastedCount} echo${pastedCount === 1 ? '' : 'es'}.`,
      variant: 'success',
      duration: 2400,
    })
  }, [showToast])

  const pstClpbIntoE = useCallback(async (slotIndex: number) => {
    const payload = await readEchoClpb()

    if (!payload) {
      showToast({
        content: 'Clipboard does not contain an echo.',
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    // paste through the clipboard helper so slot bounds, duplicate payloads,
    // and multi-echo clips are normalized before mutating the live loadout.
    const result = pstChsIntoLd(runtime.build.echoes, payload, slotIndex)

    if (result.pastedCount === 0) {
      showEchoPstR(result.pastedCount, result.skippedCount)
      return
    }

    onRtPdt((prev) => ({
      ...prev,
      build: {
        ...prev.build,
        echoes: result.nextEchoes,
      },
    }))

    showEchoPstR(result.pastedCount, result.skippedCount)
  }, [onRtPdt, runtime.build.echoes, showEchoPstR, showToast])

  const resDefPstTgt = useCallback(() => {
    if (selEchoSlotL.length > 0) {
      return selEchoSlotL[0]
    }

    // pane-level paste should fill the first empty slot, while a full build
    // falls back to slot zero so clipboard behavior remains deterministic.
    const frstMptySlot = runtime.build.echoes.findIndex((echo) => echo == null)
    return frstMptySlot >= 0 ? frstMptySlot : 0
  }, [runtime.build.echoes, selEchoSlotL])

  const pstClpbIntoD = useCallback(async () => {
    await pstClpbIntoE(resDefPstTgt())
  }, [pstClpbIntoE, resDefPstTgt])

  const saveEchoAtSl = useCallback((slotIndex: number) => {
    const echo = runtime.build.echoes[slotIndex]

    if (!echo) {
      return
    }

    const savedCount = saveChsToInv([echo])

    if (savedCount === 0) {
      showToast({
        content: 'This echo is already saved.',
        variant: 'warning',
        duration: 2600,
      })
      return
    }

    showToast({
      content: 'Saved 1 echo to bag.',
      variant: 'success',
      duration: 2400,
    })
  }, [runtime.build.echoes, saveChsToInv, showToast])

  const copyEchoAtSl = useCallback(async (slotIndex: number) => {
    const echo = runtime.build.echoes[slotIndex]

    if (!echo) {
      return
    }

    const wrote = await copyChsToClp([echo])

    if (wrote) {
      showToast({
        content: 'Copied 1 echo.',
        variant: 'success',
        duration: 2200,
      })
    }
  }, [copyChsToClp, runtime.build.echoes, showToast])

  const cutEchoAtSlo = useCallback(async (slotIndex: number) => {
    const echo = runtime.build.echoes[slotIndex]

    if (!echo) {
      return
    }

    const wrote = await copyChsToClp([echo])

    if (!wrote) {
      return
    }

    rmEchoSlts([slotIndex])

    showToast({
      content: 'Cut 1 echo.',
      variant: 'success',
      duration: 2200,
    })
  }, [copyChsToClp, rmEchoSlts, runtime.build.echoes, showToast])

  const onMprtEcho = useCallback(() => {
    parserModal.show()
  }, [parserModal])

  const onSaveMk = useCallback(() => {
    if (currentSaved) {
      return
    }

    addMkToInv({
      resonatorId: runtime.id,
      resonatorName: activeSeed?.name ?? runtime.id,
      build: {
        weapon: { ...runtime.build.weapon },
        echoes: cloneEchoLdt(runtime.build.echoes),
      },
    })

    showToast({
      content: `Saved~ ദ്ദി ˉ꒳ˉ )✧`,
      variant: 'success',
      duration: 3000,
    })
  }, [
    activeSeed?.name,
    addMkToInv,
    currentSaved,
    runtime.build.echoes,
    runtime.build.weapon,
    runtime.id,
    showToast,
  ])

  const onSaveAllChs = useCallback(() => {
    if (svblQppdChs.length === 0) {
      return
    }

    for (const echo of svblQppdChs) {
      addEchoToInv(echo)
    }

    showToast({
      content: `Saved ${svblQppdChs.length} echo${svblQppdChs.length === 1 ? '' : 'es'} to bag.`,
      variant: 'success',
      duration: 3000,
    })
  }, [addEchoToInv, svblQppdChs, showToast])

  const onNqpAllChs = useCallback(() => {
    confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message: 'This will remove all echoes from the current loadout.',
      confirmLabel: 'Unequip All',
      variant: 'danger',
      onConfirm: () => onRtPdt((prev) => ({
        ...prev,
        build: { ...prev.build, echoes: [null, null, null, null, null] },
      })),
    })
  }, [confirmation, onRtPdt])

  const mkEchoSlotCt = useCallback((slotIndex: number, echo: EchoInstance) => (
      // the context menu captures slot index at creation time so async copy,
      // cut, and paste callbacks still target the item that opened the menu.
      getEchoSlotC({
        menu: menu.calculator.echo,
        slotIndex,
        echo,
        canSave: canSaveEcho(echo),
        descVisible: slotIndex === 0 && showMainEcho,
        hasDesc: hasMainEchoD,
        onSave: () => saveEchoAtSl(slotIndex),
        onRemove: () => rmEchoSlts([slotIndex]),
        onEdit: () => openEdit(slotIndex),
        onChange: () => openPicker(slotIndex),
        onCopy: () => {
          void copyEchoAtSl(slotIndex)
        },
        onCut: () => {
          void cutEchoAtSlo(slotIndex)
        },
        onPaste: () => {
          void pstClpbIntoE(slotIndex)
        },
        onSel: () => addEchoSlotT(slotIndex),
        onFind: () => findEchoInIn(echo),
        onToggleDesc: () => setShowMainE((previous) => !previous),
      })
  ), [
    addEchoSlotT,
    canSaveEcho,
    copyEchoAtSl,
    cutEchoAtSlo,
    findEchoInIn,
    hasMainEchoD,
    menu.calculator.echo,
    openEdit,
    openPicker,
    pstClpbIntoE,
    rmEchoSlts,
    saveEchoAtSl,
    showMainEcho,
  ])

  const mkMptySlotCt = useCallback((slotIndex: number) => (
      // empty slots expose only actions that can create or select a target;
      // destructive item actions stay attached to occupied slot menus.
      getEchoMptyC({
        menu: menu.calculator.echo,
        slotIndex,
        canSel: qppdEchoSlot.length > 0,
        mode: selMode,
        onPick: () => openPicker(slotIndex),
        onOpenInv: openInvWthtE,
        onPaste: () => {
          void pstClpbIntoE(slotIndex)
        },
        onAll: selAllEchoSl,
        onNone: dslcAllEchoS,
      })
  ), [
    dslcAllEchoS,
    qppdEchoSlot.length,
    menu.calculator.echo,
    openInvWthtE,
    openPicker,
    pstClpbIntoE,
    selAllEchoSl,
    selMode,
  ])

  const mkEchoPaneCt = useCallback(() => (
      // pane actions operate on the current aggregate loadout and selection
      // state instead of a single slot, which keeps keyboard and menu behavior aligned.
      getEchoPaneC({
        menu: menu.calculator.echo,
        saved: currentSaved,
        canSaveAll: svblQppdChs.length > 0,
        canNqpAll: qppdCnt > 0,
        canSel: qppdEchoSlot.length > 0,
        mode: selMode,
        onOpenInv: openInvWthtE,
        onImport: onMprtEcho,
        onSaveBuild: onSaveMk,
        onSaveAll: onSaveAllChs,
        onUnequipAll: onNqpAllChs,
        onPaste: () => {
          void pstClpbIntoD()
        },
        onAll: selAllEchoSl,
        onNone: dslcAllEchoS,
      })
  ), [
    currentSaved,
    dslcAllEchoS,
    qppdCnt,
    qppdEchoSlot.length,
    onMprtEcho,
    onSaveAllChs,
    onSaveMk,
    onNqpAllChs,
    menu.calculator.echo,
    openInvWthtE,
    pstClpbIntoD,
    svblQppdChs.length,
    selAllEchoSl,
    selMode,
  ])

  const mkEchoSlotCl = useCallback((slotIndex: number, selectable: boolean) => (
      (event: React.MouseEvent<HTMLElement>) => {
        if (event.defaultPrevented) {
          return
        }

        if (selMode && !selectable) {
          event.preventDefault()
          event.stopPropagation()
          return
        }

        // shift selection expands from the ordered selection anchor; meta/ctrl
        // starts or toggles single-slot selection without opening edit actions.
        if (selectable && event.shiftKey) {
          event.preventDefault()
          event.stopPropagation()
          addEchoSelRn(slotIndex)
          return
        }

        if (!selectable || (!selMode && !(event.metaKey || event.ctrlKey))) {
          return
        }

        event.preventDefault()
        event.stopPropagation()

        if (selMode) {
          tglEchoSlotS(slotIndex)
          return
        }

        addEchoSlotT(slotIndex)
      }
  ), [addEchoSelRn, addEchoSlotT, selMode, tglEchoSlotS])

  return (
      <ContextTrigger
          asChild
          ariaLabel="Echoes pane actions"
          items={mkEchoPaneCt()}
      >
        <section
            className={`calc-pane echoes-pane${selMode ? ' selection-mode' : ''}`}
            {...selection.focusProps}
        >
          <div className="echoes-pane-header">
            <div className="echoes-pane-title weapon-effect__bar">
              <span className="weapon-effect__sigil" aria-hidden="true" />
              <span className="weapon-effect__titles">
                <span className="weapon-effect__tag">Build</span>
                <span className="weapon-effect__name">Echoes</span>
              </span>
            </div>

            <div className="echoes-pane-summary">
              <div className="echo-toolbar" role="group" aria-label="Echo build actions">
                <button type="button" className="echo-tool" onClick={onMprtEcho}>
                  <FileImage size={15} aria-hidden="true" />
                  <span className="echo-tool__label">Import</span>
                </button>

                <button
                    type="button"
                    className="echo-tool"
                    onClick={onSaveMk}
                    disabled={currentSaved}
                >
                  <Save size={15} aria-hidden="true" />
                  <span className="echo-tool__label">{currentSaved ? 'Saved' : 'Save Build'}</span>
                </button>

                <button
                    type="button"
                    className="echo-tool"
                    disabled={svblQppdChs.length === 0}
                    onClick={onSaveAllChs}
                >
                  <IoArchive size={15} aria-hidden="true" />
                  <span className="echo-tool__label">Save All</span>
                </button>

                <button
                    type="button"
                    className="echo-tool echo-tool--danger"
                    onClick={onNqpAllChs}
                    disabled={qppdCnt === 0}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  <span className="echo-tool__label">Unequip</span>
                </button>
              </div>

              <div
                  className={`echo-cost${totalCost > MAX_COST ? ' echo-cost--over' : ''}`}
                  style={{ '--cost-pct': `${Math.min(100, (totalCost / MAX_COST) * 100)}%` } as CssProps}
                  title={`${totalCost} of ${MAX_COST} cost used`}
              >
                <span className="echo-cost__label">Cost</span>
                <span className="echo-cost__read">
                  <span className="echo-cost__val">{totalCost}</span>
                  <span className="echo-cost__max">/ {MAX_COST}</span>
                </span>
              </div>
            </div>
          </div>

          <section className="echoes-pane-content">
            <motion.div
                className="echoes-slot-grid"
                layout
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                {...selection.scopeProps}
            >
              <motion.div
                  layout
                  transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
              >
                {runtime.build.echoes[0] ? (
                    <ContextTrigger
                        asChild
                        ariaLabel={`${getEchoById(runtime.build.echoes[0].id)?.name ?? 'Echo'} actions`}
                        items={mkEchoSlotCt(0, runtime.build.echoes[0])}
                    >
                      <EchoSlot
                          key="echo-slot-0"
                          echo={runtime.build.echoes[0]}
                          index={0}
                          score={echoScores?.[0] ?? null}
                          canSave={canSaveEcho(runtime.build.echoes[0])}
                          selected={ffctSlotNdxs.has(0)}
                          selMode={selMode}
                          showMainChvr={hasMainEchoD}
                          mainEchoExp={showMainEcho}
                          onTgglMainjt={() => setShowMainE((prev) => !prev)}
                          onOpenPicker={() => openPicker(0)}
                          onOpenEdit={() => openEdit(0)}
                          onSave={() => saveEchoAtSl(0)}
                          onRemove={() => rmEchoSlts([0])}
                          onClickCapture={mkEchoSlotCl(0, true)}
                      />
                    </ContextTrigger>
                ) : (
                    <ContextTrigger
                        asChild
                        ariaLabel="Empty echo slot actions"
                        items={mkMptySlotCt(0)}
                    >
                      <EchoSlot
                          key="echo-slot-0"
                          echo={runtime.build.echoes[0]}
                          index={0}
                          score={echoScores?.[0] ?? null}
                          canSave={false}
                          selected={false}
                          selMode={selMode}
                          showMainChvr={hasMainEchoD}
                          mainEchoExp={showMainEcho}
                          onTgglMainjt={() => setShowMainE((prev) => !prev)}
                          onOpenPicker={() => openPicker(0)}
                          onOpenEdit={() => openEdit(0)}
                          onSave={() => saveEchoAtSl(0)}
                          onRemove={() => rmEchoSlts([0])}
                          onClickCapture={mkEchoSlotCl(0, false)}
                      />
                    </ContextTrigger>
                )}
              </motion.div>

              <motion.div layout transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}>
                <NmtPrsn mode="wait">
                  {showMainEcho && mainEchoPnl ? (
                      <motion.div
                          key="main-echo-desc"
                          className="echo-slot-detail-panel"
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <div className="echo-slot-feature">
                          {mainEchoPnl}
                        </div>
                      </motion.div>
                  ) : (
                      <motion.div
                          key="echo-slot-1"
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      >
                        {runtime.build.echoes[1] ? (
                            <ContextTrigger
                                asChild
                                ariaLabel={`${getEchoById(runtime.build.echoes[1].id)?.name ?? 'Echo'} actions`}
                                items={mkEchoSlotCt(1, runtime.build.echoes[1])}
                            >
                              <EchoSlot
                                  echo={runtime.build.echoes[1]}
                                  index={1}
                                  score={echoScores?.[1] ?? null}
                                  canSave={canSaveEcho(runtime.build.echoes[1])}
                                  selected={ffctSlotNdxs.has(1)}
                                  selMode={selMode}
                                  onOpenPicker={() => openPicker(1)}
                                  onOpenEdit={() => openEdit(1)}
                                  onSave={() => saveEchoAtSl(1)}
                                  onRemove={() => rmEchoSlts([1])}
                                  onClickCapture={mkEchoSlotCl(1, true)}
                              />
                            </ContextTrigger>
                        ) : (
                            <ContextTrigger
                                asChild
                                ariaLabel="Empty echo slot actions"
                                items={mkMptySlotCt(1)}
                            >
                              <EchoSlot
                                  echo={runtime.build.echoes[1]}
                                  index={1}
                                  score={echoScores?.[1] ?? null}
                                  canSave={false}
                                  selected={false}
                                  selMode={selMode}
                                  onOpenPicker={() => openPicker(1)}
                                  onOpenEdit={() => openEdit(1)}
                                  onSave={() => saveEchoAtSl(1)}
                                  onRemove={() => rmEchoSlts([1])}
                                  onClickCapture={mkEchoSlotCl(1, false)}
                              />
                            </ContextTrigger>
                        )}
                      </motion.div>
                  )}
                </NmtPrsn>
              </motion.div>

              {runtime.build.echoes.slice(2).map((echo, i) => {
                const index = i + 2

                return (
                    <motion.div
                        key={`echo-slot-wrapper-${index}`}
                        layout
                        transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                    >
                      {echo ? (
                          <ContextTrigger
                              asChild
                              ariaLabel={`${getEchoById(echo.id)?.name ?? 'Echo'} actions`}
                              items={mkEchoSlotCt(index, echo)}
                          >
                            <EchoSlot
                                echo={echo}
                                index={index}
                                score={echoScores?.[index] ?? null}
                                canSave={canSaveEcho(echo)}
                                selected={ffctSlotNdxs.has(index)}
                                selMode={selMode}
                                onOpenPicker={() => openPicker(index)}
                                onOpenEdit={() => openEdit(index)}
                                onSave={() => saveEchoAtSl(index)}
                                onRemove={() => rmEchoSlts([index])}
                                onClickCapture={mkEchoSlotCl(index, true)}
                            />
                          </ContextTrigger>
                      ) : (
                          <ContextTrigger
                              asChild
                              ariaLabel="Empty echo slot actions"
                              items={mkMptySlotCt(index)}
                          >
                            <EchoSlot
                                echo={echo}
                                index={index}
                                score={echoScores?.[index] ?? null}
                                canSave={false}
                                selected={false}
                                selMode={selMode}
                                onOpenPicker={() => openPicker(index)}
                                onOpenEdit={() => openEdit(index)}
                                onSave={() => saveEchoAtSl(index)}
                                onRemove={() => rmEchoSlts([index])}
                                onClickCapture={mkEchoSlotCl(index, false)}
                            />
                          </ContextTrigger>
                      )}
                    </motion.div>
                )
              })}
            </motion.div>

            {activeSets.length > 0 ? (
                <div className="echo-set-bonuses">
                  {activeSets.map(({ setId, count }) => (
                      <EchoSetBonus
                          key={setId}
                          setId={setId}
                          count={count}
                          runtime={runtime}
                          onRtPdt={onRtPdt}
                          selectedTargets={selTrgtByOwn}
                          setTargetRes={setTargetRes}
                      />
                  ))}
                </div>
            ) : null}

            <EchoTotals echoes={runtime.build.echoes} buildScore={buildScore} />
          </section>

          {pickerModal.visible && pickerSlot !== null ? (
              <EchoPicker
                  visible={pickerModal.visible}
                  open={pickerModal.open}
                  closing={pickerModal.closing}
                  portalTarget={mdlPrtlTgt}
                  echoes={allEchoes}
                  selEchoId={runtime.build.echoes[pickerSlot]?.id ?? null}
                  slotIndex={pickerSlot}
                  maxCost={maxCostForSl}
                  onSelect={handleSelect}
                  onClear={handleClear}
                  onClose={closePicker}
              />
          ) : null}

          {editModal.visible && editSlot !== null && editEcho ? (
              <Edit
                  visible={editModal.visible}
                  open={editModal.open}
                  closing={editModal.closing}
                  portalTarget={mdlPrtlTgt}
                  echo={editEcho}
                  slotIndex={editSlot}
                  onSave={onEditSave}
                  onClose={closeEdit}
              />
          ) : null}

          {parserModal.visible ? (
              <Parser
                  visible={parserModal.visible}
                  open={parserModal.open}
                  closing={parserModal.closing}
                  portalTarget={mdlPrtlTgt}
                  charId={runtime.id}
                  curChs={runtime.build.echoes}
                  onEquip={(echoes) => {
                    onRtPdt((prev) => ({
                      ...prev,
                      build: { ...prev.build, echoes },
                    }))

                    showToast({
                      content: 'Echoes imported~! (〜^∇^)〜',
                      variant: 'success',
                      duration: 3000,
                    })
                  }}
                  onEquipEcho={(echoes) => {
                    onRtPdt((prev) => ({
                      ...prev,
                      build: { ...prev.build, echoes },
                    }))
                  }}
                  onClose={parserModal.hide}
              />
          ) : null}

          <CnfrMdl
              visible={confirmation.visible}
              open={confirmation.open}
              closing={confirmation.closing}
              portalTarget={portalTarget}
              title={confirmation.title}
              message={confirmation.message}
              confirmLabel={confirmation.confirmLabel}
              cancelLabel={confirmation.cancelLabel}
              variant={confirmation.variant}
              onConfirm={confirmation.onConfirm}
              onCancel={confirmation.onCancel}
          />
        </section>
      </ContextTrigger>
  )
}
