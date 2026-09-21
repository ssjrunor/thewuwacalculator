/*
  Author: Runor Ewhro
  Description: Owns equipped-echo edits, inventory handoff, clipboard actions,
               build saving, and evaluation scoring for the active runtime.
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
  Wand2,
} from 'lucide-react'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { equalEchoes, equalBuildSnapshots, cloneEchoLoadout, sameEchoUid, saveEchoSlots } from '@/domain/entities/inventoryStorage.ts'
import { getEchoById, listEchoes } from '@/data/catalog/echoCatalogService.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { listStatesFor } from '@/data/catalog/gameDataService.ts'
import { getMainEchoS } from '@/engine/services/runtimeSourceService.ts'
import { selActTgtSlc } from '@/application/state'
import { useAppStore } from '@/application/state'
import { Edit } from '@/modules/simulation/features/echoes/Edit.tsx'
import { QuickSetup } from '@/modules/simulation/features/echoes/QuickSetup.tsx'
import { Parser } from '@/modules/simulation/features/echoes/Parser.tsx'
import {
  mkDefEchoNst,
} from '@/modules/simulation/features/echoes/lib/echoPane.ts'
import { cmptTtlEchoC } from '@/modules/simulation/features/echoes/lib/echoes.ts'
import { useEchoScores } from '@/engine/evaluation/useEchoScoringRevision.ts'
import type { RtUpdHnd } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal.tsx'
import { useAppModal, useAppModalValue } from '@/shared/ui/useAppModal.ts'
import { useConfirm } from '@/shared/hooks/useConfirmation.ts'
import { isStateVisible } from '@/engine/services/sourceStateService.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { IoArchive } from 'react-icons/io5'
import { EchoPicker } from '@/modules/simulation/features/echoes/Picker.tsx'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'
import { useCtxBuilder } from '@/modules/simulation/shell/context-menu/useContextMenuBuilder.ts'
import {
  mkMainEchoPn,
  EchoSetBonus,
  EchoSlot,
  EchoTotals,
  getActEchoSe,
} from '@/modules/simulation/features/echoes/Sections.tsx'
import { useEchoClipboard } from '@/modules/simulation/model/useEchoClipboard.ts'
import { useSel } from '@/modules/simulation/lib/sel.tsx'
import { getEchoMptyC, getEchoPaneC, getEchoSlotC } from '@/modules/simulation/features/echoes/lib/ctx.tsx'

const MAX_COST = 12
const CHSSELFCSSCP = 'echoes-pane-selection'

interface EchoPaneProps {
  runtime: ResRuntime
  onRtPdt: RtUpdHnd
}

export function Echoes({
                         runtime,
                         onRtPdt: onRtPdt,
                       }: EchoPaneProps) {
  const allEchoes = useMemo(() => listEchoes(), [])
  const invChs = useAppStore((state) => state.library.echoes)
  const invBlds = useAppStore((state) => state.library.builds)
  const selTrgtByOwn = useAppStore(selActTgtSlc)
  const showToast = useTstStr((s) => s.show)
  const confirmation = useConfirm()
  const portalTarget = mainPortal()
  const addEchoesToInv = useAppStore((state) => state.addInvEchoes)
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
    const savedEntry = invChs.find((entry) => sameEchoUid(entry.echo, echo))
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
        isStateVisible(runtime, runtime, state),
    )
  }, [mainEchoSrc, runtime])

  const pickerModal = useAppModalValue<number>()
  const editModal = useAppModalValue<number>()
  const parserModal = useAppModal()
  const quickSetupModal = useAppModal()
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

  // the editor can re-cast its own slot, so it carries that slot's budget
  const editSlotCost = useMemo(() => {
    if (editSlot === null) return 0

    const echo = runtime.build.echoes[editSlot]
    if (!echo) return 0

    return getEchoById(echo.id)?.cost ?? 0
  }, [editSlot, runtime.build.echoes])

  const maxCostForEdt = MAX_COST - totalCost + editSlotCost

  const clearEditSlot = () => {
    if (editSlot === null) return

    onRtPdt((prev) => {
      const next = [...prev.build.echoes]
      next[editSlot] = null
      return { ...prev, build: { ...prev.build, echoes: next } }
    })

    closeEdit()
  }

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
    // Clipboard operations use canonical slot order to preserve loadout positions.
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
    // The parser owns Cmd/Ctrl+V while it is open. Keeping the pane's standby
    // paste shortcut active here prevents the browser from dispatching the
    // image paste event that the parser listens for.
    active: !parserModal.visible,
    surfaceId: CHSSELFCSSCP,
    ariaLabel: 'Echo selection actions',
    noun: { one: 'echo', many: 'echoes' },
    items: selTms,
    ord: qppdEchoSlot,
    av: qppdEchoSlot,
    acts: [
      // echo pane selection uses the same shared shortcut contract as inventory and manual modifiers.
      {
        id: 'echo:copy',
        key: 'copy',
        needsSel: true,
        icon: <Copy size="1em" />,
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
        icon: <Scissors size="1em" />,
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
        icon: <FileImage size="1em" />,
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
        icon: <Trash2 size="1em" />,
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
  const echoScores = useEchoScores(runtime.id, runtime.build.echoes)
  const mdlPrtlTgt = mainPortal()
  const editEcho = editSlot !== null ? runtime.build.echoes[editSlot] : null

  const currentSaved = useMemo(
      () =>
          invBlds.some((entry) =>
              equalBuildSnapshots(entry.build, {
                weapon: runtime.build.weapon,
                echoes: runtime.build.echoes,
              }),
          ),
      [invBlds, runtime.build.echoes, runtime.build.weapon],
  )

  const mainEchoPnl = mkMainEchoPn(runtime, mainEchoDef, mainEchoStats, onRtPdt)

  const canSaveEcho = useCallback((echo: EchoInstance | null | undefined) => (
      Boolean(echo) && !invChs.some((entry) => equalEchoes(entry.echo, echo))
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

  const saveSlotsToInv = useCallback((slotIndexes: number[]) => {
    const result = saveEchoSlots(runtime.build.echoes, slotIndexes, addEchoesToInv)
    const nextEchoes = result.nextEchoes
    if (nextEchoes) {
      onRtPdt((prev) => {
        return { ...prev, build: { ...prev.build, echoes: nextEchoes } }
      })
    }
    return result.savedCount
  }, [addEchoesToInv, onRtPdt, runtime.build.echoes])

  const {
    copyEchoes: copyChsToClp,
    defaultPasteSlot: resDefPstTgt,
    pasteIntoSlot: pstClpbIntoE,
  } = useEchoClipboard({
    runtime,
    resonatorName: activeSeed?.name ?? runtime.id,
    selectedSlots: selEchoSlotL,
    updateRuntime: onRtPdt,
    showToast,
  })

  const pstClpbIntoD = useCallback(async () => {
    await pstClpbIntoE(resDefPstTgt())
  }, [pstClpbIntoE, resDefPstTgt])

  const saveEchoAtSl = useCallback((slotIndex: number) => {
    const echo = runtime.build.echoes[slotIndex]

    if (!echo) {
      return
    }

    const savedCount = saveSlotsToInv([slotIndex])

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
  }, [runtime.build.echoes, saveSlotsToInv, showToast])

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
        echoes: cloneEchoLoadout(runtime.build.echoes),
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

    const slotIndexes = runtime.build.echoes.reduce<number[]>((result, echo, slotIndex) => {
      if (echo && canSaveEcho(echo)) {
        result.push(slotIndex)
      }

      return result
    }, [])
    const savedCount = saveSlotsToInv(slotIndexes)

    showToast({
      content: `Saved ${savedCount} echo${savedCount === 1 ? '' : 'es'} to bag.`,
      variant: 'success',
      duration: 3000,
    })
  }, [canSaveEcho, runtime.build.echoes, saveSlotsToInv, svblQppdChs.length, showToast])

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
        menu: menu.simulation.echo,
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
    menu.simulation.echo,
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
        menu: menu.simulation.echo,
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
    menu.simulation.echo,
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
        menu: menu.simulation.echo,
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
    menu.simulation.echo,
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
                <button
                    type="button" className="echo-tool echo-tool--accent"
                    onClick={quickSetupModal.show}
                >
                  <Wand2 size={15} aria-hidden="true" />
                  <span className="echo-tool__label">Forge</span>
                </button>

                <button type="button" className="echo-tool" onClick={onMprtEcho}>
                  <FileImage size={15} aria-hidden="true" />
                  <span className="echo-tool__label">Import</span>
                </button>

                <button
                    type="button" className="echo-tool"
                    onClick={onSaveMk}
                    disabled={currentSaved}
                >
                  <Save size={15} aria-hidden="true" />
                  <span className="echo-tool__label">{currentSaved ? 'Saved' : 'Save Build'}</span>
                </button>

                <button
                    type="button" className="echo-tool"
                    disabled={svblQppdChs.length === 0}
                    onClick={onSaveAllChs}
                >
                  <IoArchive size={15} aria-hidden="true" />
                  <span className="echo-tool__label">Save All</span>
                </button>

                <button
                    type="button" className="echo-tool echo-tool--danger"
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
            <motion.div className="echoes-slot-grid"
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
                          key="main-echo-desc" className="echo-slot-detail-panel"
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

            <EchoTotals echoes={runtime.build.echoes} />
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
                  echoes={allEchoes}
                  maxCost={maxCostForEdt}
                  onSave={onEditSave}
                  onClear={clearEditSlot}
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
                  runtime={runtime}
                  currentEchoes={runtime.build.echoes}
                  onApplyRead={(_, next) => {
                    onRtPdt(next)

                    showToast({
                      content: 'Build imported~! (〜^∇^)〜',
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

          {quickSetupModal.visible ? (
              <QuickSetup
                  visible={quickSetupModal.visible}
                  open={quickSetupModal.open}
                  closing={quickSetupModal.closing}
                  portalTarget={mdlPrtlTgt}
                  currentEchoes={runtime.build.echoes}
                  onClose={quickSetupModal.hide}
                  onGenerate={(echoes) => {
                    onRtPdt((prev) => ({
                      ...prev,
                      build: { ...prev.build, echoes },
                    }))

                    showToast({
                      content: 'Build conjured~! ✦(ゝ｡∂)',
                      variant: 'success',
                      duration: 3000,
                    })

                    quickSetupModal.hide()
                  }}
              />
          ) : null}

          <ConfirmHost control={confirmation} portalTarget={portalTarget} />
        </section>
      </ContextTrigger>
  )
}
