/*
  Author: Runor Ewhro
  Description: Edits manual buff modifiers, selection actions, import/export
               payloads, and preset application for the active runtime.
*/

import type { ChangeEvent, ReactNode } from 'react'
import { useCallback, useMemo, useRef } from 'react'
import { CnfrMdl } from '@/shared/ui/ConfirmationModal.tsx'
import { useCnfr } from '@/app/hooks/useConfirmation.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { Copy, CopyPlus, Plus, Scissors, Sparkles, Trash2, Power, PowerOff } from 'lucide-react'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type {
  MnlBaseStatK,
  ManualBuffs,
  MnlMod,
  MnlModScp,
  MnlModVlKey,
  MnlNegFfctModKey,
  QuickBuffs,
  MnlSkllSclrK,
  MnlSkllMtchM,
  MnlTopStatKe,
} from '@/domain/entities/manualBuffs.ts'
import {
  makeCustomBuff,
  mkDefMnlMod,
} from '@/domain/state/defaults.ts'
import { mnlBffsSchm } from '@/domain/state/manualBuffsSchema.ts'
import { Expandable } from '@/shared/ui/Expandable.tsx'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { BuffPresetModal } from './BuffPresetModal.tsx'
import type { RtUpdHnd } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import {getResonatorById as getResById} from "@/domain/services/catalogService.ts";
import { resolveSkill } from '@/engine/pipeline/resolveSkill.ts'
import { useSel, type SelAct } from '@/modules/calculator/lib/sel.tsx'
import { usePtnlCalcC } from '@/modules/calculator/features/main/lib/ctx.tsx'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { NumberInput } from '@/modules/calculator/features/controls/NumberInput.tsx'
import {
  DVNCTTRBPTNS,
  DVNCBASESTuv,
  DVNCBASESTAT,
  DVNCSCPPTNS,
  ADV_SKILL_MATCH,
  ADV_SKILL_TYPES,
  DVNCTOPSTATP,
  DEFDVNCMODSC,
  MAINSCLRBUFF,
  MAINSTATBUFF,
  BUFF_CLIP_VER,
  MOD_VL_PTNS,
  NEG_EFFECT_MODS,
  NEG_EFFECT_OPTS,
  SKLLSCLRPTNS,
  SKLLMODPTNS,
  SKILL_TAB_OPTIONS,
} from '@/modules/calculator/features/buffs/lib/options.ts'
import {
  clmpMnlModVl,
  clampQuickBuff,
  makeModId,
  mprtPay,
  cleanBuffs,
} from '@/modules/calculator/features/buffs/lib/helpers.ts'
import {
  makeModClip,
  cloneMnlMdfr,
  cloneManualMods,
  readMnlModCl,
  writeMnlModC,
} from '@/modules/calculator/features/buffs/lib/clipboard.ts'
import {
  applySkillMod,
  getModVlMax,
  getModVlSfx,
  getSkllModPt,
  modSummary,
} from '@/modules/calculator/features/buffs/lib/manualBuffOps.ts'

interface MnlBuffDtrPr {
  runtime: ResRuntime
  onRtPdt: RtUpdHnd
  cardVariant?: 'section' | 'inner'
  showQckStts?: boolean
  showTrnsCtns?: boolean
}

// exposes the manual buff editor controls and ties them back to the shared runtime handler.

interface MnlBffsXprtP {
  type: 'manual-buffs'
  version: typeof BUFF_CLIP_VER
  resonatorId: string
  exportedAt: string
  manualBuffs: ManualBuffs
}

const MNLMODSELSCP = 'manual-buffs-modifier-selection'

export function BuffEditor({
  runtime,
  onRtPdt: onRtPdt,
  cardVariant = 'section',
  showQckStts: showQckStats = true,
  showTrnsCtns: showTrnsCtns = false,
}: MnlBuffDtrPr) {
  const mprtNptRef = useRef<HTMLInputElement | null>(null)
  const confirmation = useCnfr()
  const portalTarget = mainPortal()
  const resonator = getResById(runtime.id)
  const manualBuffs = runtime.state.manualBuffs
  const menu = usePtnlCalcC()
  const showToast = useTstStr((state) => state.show)
  const exitModSelRe = useRef<() => void>(() => {})
  const presetModal = useAppModal()

  const skillOptions = Array.from(
    new Map(
      (resonator?.skills ?? []).map((rawSkill) => {
        const skill = resolveSkill(runtime, rawSkill)
        return [
          skill.id,
          {
            value: skill.id,
            label: skill.label,
          },
        ]
      }),
    ).values(),
  )
  const tabOptions = SKILL_TAB_OPTIONS.filter(({ value }) =>
    (resonator?.skills ?? []).some((skill) => skill.tab === value),
  )
  const cardClssName = `custom-buffs-card ui-surface-card ui-surface-card--${cardVariant}`
  const vsblMdfr = useMemo(
    // storage appends new modifiers at the end, but the editor presents newest first so recently-created buffs are
    // immediately reachable without scrolling.
    () => manualBuffs.modifiers.slice().reverse(),
    [manualBuffs.modifiers],
  )
  const modSelTms = useMemo(
    () => vsblMdfr.map((modifier) => ({
      id: modifier.id,
      val: modifier,
    })),
    [vsblMdfr],
  )
  const vsblModIds = useMemo(
    () => vsblMdfr.map((modifier) => modifier.id),
    [vsblMdfr],
  )

  const updQckBaseSt = (
    stat: MnlBaseStatK,
    field: 'flat' | 'percent',
    rawValue: number,
  ) => {
    // quick base stats use separate flat and percent fields because the damage engine resolves them at different
    // points in the final-stat pipeline.
    const nextValue = clampQuickBuff(field === 'flat', rawValue)
    onRtPdt((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          quick: {
            ...prev.state.manualBuffs.quick,
            [stat]: {
              ...prev.state.manualBuffs.quick[stat],
              [field]: nextValue,
            },
          },
        },
      },
    }))
  }

  const updQckSclr = (
    key: Exclude<keyof QuickBuffs, 'atk' | 'hp' | 'def'>,
    rawValue: number,
  ) => {
    const nextValue = clampQuickBuff(false, rawValue)
    onRtPdt((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          quick: {
            ...prev.state.manualBuffs.quick,
            [key]: nextValue,
          },
        },
      },
    }))
  }

  const updateMod = (
    modifierId: string,
    updater: (modifier: MnlMod) => MnlMod,
  ) => {
    // advanced modifiers are edited immutably so undo/history and shared runtime subscribers can observe a new manual
    // buffs object on every row mutation.
    onRtPdt((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          modifiers: prev.state.manualBuffs.modifiers.map((modifier) =>
            modifier.id === modifierId ? updater(modifier) : modifier,
          ),
        },
      },
    }))
  }

  const rmMnlMod = (modifierId: string) => {
    onRtPdt((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          modifiers: prev.state.manualBuffs.modifiers.filter((modifier) => modifier.id !== modifierId),
        },
      },
    }))
  }

  const rmMnlMdfr = useCallback((modifierIds: readonly string[]) => {
    const idsToRemove = new Set(modifierIds)
    if (idsToRemove.size === 0) {
      return
    }

    onRtPdt((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          modifiers: prev.state.manualBuffs.modifiers.filter((modifier) => !idsToRemove.has(modifier.id)),
        },
      },
    }))
  }, [onRtPdt])

  const addMnlMod = () => {
    const id = makeModId()
    onRtPdt((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          modifiers: [
            ...prev.state.manualBuffs.modifiers,
            mkDefMnlMod(id, DEFDVNCMODSC),
          ],
        },
      },
    }))
  }

  const dplcMnlMod = (modifier: MnlMod) => {
    const id = makeModId()
    onRtPdt((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          modifiers: [
            ...prev.state.manualBuffs.modifiers,
            { ...modifier, id },
          ],
        },
      },
    }))
  }

  const nsrtMnlMdfr = useCallback((
    modifiers: MnlMod[],
    rplcIds: readonly string[] = [],
  ) => {
    if (modifiers.length === 0) {
      return 0
    }

    const rplcIdSet = new Set(rplcIds)
    // pasted rows need fresh ids and are reversed before storage because the rendered list reverses storage order.
    const pstdMdfrForS = cloneManualMods(modifiers).reverse()

    onRtPdt((prev) => {
      const curMdfr = prev.state.manualBuffs.modifiers
      const rplcNdxs = curMdfr
        .map((modifier, index) => rplcIdSet.has(modifier.id) ? index : -1)
        .filter((index) => index >= 0)

      // no replacement target means a plain paste/duplicate append; selection-aware paste replaces the contiguous
      // selected region at the earliest selected storage index.
      if (rplcNdxs.length === 0) {
        return {
          ...prev,
          state: {
            ...prev.state,
            manualBuffs: {
              ...prev.state.manualBuffs,
              modifiers: [
                ...curMdfr,
                ...pstdMdfrForS,
              ],
            },
          },
        }
      }

      const insertIndex = Math.min(...rplcNdxs)
      const rmnnMdfr = curMdfr.filter((modifier) => !rplcIdSet.has(modifier.id))

      return {
        ...prev,
        state: {
          ...prev.state,
          manualBuffs: {
            ...prev.state.manualBuffs,
            modifiers: [
              ...rmnnMdfr.slice(0, insertIndex),
              ...pstdMdfrForS,
              ...rmnnMdfr.slice(insertIndex),
            ],
          },
        },
      }
    })

    return modifiers.length
  }, [onRtPdt])

  const writeMnlMdfr = useCallback(async (modifiers: MnlMod[]) => {
    if (modifiers.length === 0) {
      return false
    }

    return writeMnlModC(
      makeModClip(cloneMnlMdfr(modifiers)),
    )
  }, [])

  const addPresetMdfr = useCallback((modifiers: MnlMod[]) => {
    const added = nsrtMnlMdfr(modifiers)

    showToast({
      content: added === 1 ? 'Added 1 preset modifier.' : `Added ${added} preset modifiers.`,
      variant: added > 0 ? 'success' : 'warning',
      duration: added > 0 ? 2200 : 3200,
    })
  }, [nsrtMnlMdfr, showToast])

  const copyMnlMdfr = useCallback(async (modifiers: MnlMod[]) => {
    const wrote = await writeMnlMdfr(modifiers)

    showToast({
      content: wrote
        ? (modifiers.length === 1 ? 'Copied 1 advanced modifier.' : `Copied ${modifiers.length} advanced modifiers.`)
        : 'Could not write advanced modifiers to clipboard.',
      variant: wrote ? 'success' : 'warning',
      duration: wrote ? 2200 : 3200,
    })

    return wrote
  }, [showToast, writeMnlMdfr])

  const pstMnlMdfr = useCallback(async (rplcIds: readonly string[] = []) => {
    const payload = await readMnlModCl()
    if (!payload) {
      showToast({
        content: 'Clipboard does not contain advanced manual modifiers.',
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    const pastedCount = nsrtMnlMdfr(payload.modifiers, rplcIds)
    if (pastedCount === 0) {
      return
    }

    // replacing a selection exits selection mode because the selected ids no longer exist after paste.
    if (rplcIds.length > 0) {
      exitModSelRe.current()
    }

    showToast({
      content: rplcIds.length > 0
        ? (pastedCount === 1 ? 'Replaced selection with 1 advanced modifier.' : `Replaced selection with ${pastedCount} advanced modifiers.`)
        : (pastedCount === 1 ? 'Pasted 1 advanced modifier.' : `Pasted ${pastedCount} advanced modifiers.`),
      variant: 'success',
      duration: 2400,
    })
  }, [nsrtMnlMdfr, showToast])

  const dplcMnlMdfr = useCallback((modifiers: MnlMod[]) => {
    const dplcCnt = nsrtMnlMdfr(modifiers)
    if (dplcCnt === 0) {
      return
    }

    showToast({
      content: dplcCnt === 1 ? 'Duplicated 1 advanced modifier.' : `Duplicated ${dplcCnt} advanced modifiers.`,
      variant: 'success',
      duration: 2200,
    })
  }, [nsrtMnlMdfr, showToast])

  const cutMnlMdfr = useCallback(async (ids: readonly string[], modifiers: MnlMod[]) => {
    const wrote = await writeMnlMdfr(modifiers)
    if (!wrote) {
      showToast({
        content: 'Could not write advanced modifiers to clipboard.',
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    rmMnlMdfr(ids)
    exitModSelRe.current()
    showToast({
      content: modifiers.length === 1 ? 'Cut 1 advanced modifier.' : `Cut ${modifiers.length} advanced modifiers.`,
      variant: 'success',
      duration: 2200,
    })
  }, [rmMnlMdfr, showToast, writeMnlMdfr])

  const dltMnlModSel = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) {
      return
    }

    rmMnlMdfr(ids)
    exitModSelRe.current()
    showToast({
      content: ids.length === 1 ? 'Deleted 1 advanced modifier.' : `Deleted ${ids.length} advanced modifiers.`,
      variant: 'success',
      duration: 2200,
    })
  }, [rmMnlMdfr, showToast])

  const modSelCtns = useMemo<Array<SelAct<string, MnlMod>>>(() => [
    // selection actions intentionally mirror the inventory surface shortcuts so copy/cut/paste muscle memory is shared
    // across echo cards and manual buff modifiers.
    {
      id: 'manual-buffs:copy',
      key: 'copy',
      needsSel: true,
      icon: <Copy size={14} />,
      label: ({ count }) => `Copy (${count})`,
      title: 'Copy selection (Ctrl/Cmd+C)',
      run: async ({ vals }) => {
        await copyMnlMdfr(vals)
      },
    },
    {
      id: 'manual-buffs:cut',
      key: 'cut',
      needsSel: true,
      icon: <Scissors size={14} />,
      label: ({ count }) => `Cut (${count})`,
      title: 'Cut selection (Ctrl/Cmd+X)',
      run: async ({ ids, vals }) => {
        await cutMnlMdfr(ids, vals)
      },
    },
    {
      id: 'manual-buffs:duplicate',
      needsSel: true,
      icon: <CopyPlus size={14} />,
      label: ({ count }) => `Duplicate (${count})`,
      title: 'Duplicate selection',
      run: ({ vals }) => {
        dplcMnlMdfr(vals)
      },
    },
    {
      id: 'manual-buffs:paste',
      key: 'paste',
      label: 'Paste',
      title: 'Paste modifiers (Ctrl/Cmd+V)',
      float: false,
      run: async ({ ids, mode }) => {
        await pstMnlMdfr(mode ? ids : [])
      },
    },
    {
      id: 'manual-buffs:delete',
      key: 'delete',
      needsSel: true,
      danger: true,
      icon: <Trash2 size={14} />,
      label: ({ count }) => `Delete (${count})`,
      title: 'Delete selection (Delete / Backspace)',
      run: ({ ids }) => {
        dltMnlModSel(ids)
      },
    },
  ], [
    copyMnlMdfr,
    cutMnlMdfr,
    dltMnlModSel,
    dplcMnlMdfr,
    pstMnlMdfr,
  ])

  const modSel = useSel({
    surfaceId: MNLMODSELSCP,
    ariaLabel: 'Advanced modifier selection actions',
    items: modSelTms,
    ord: vsblModIds,
    acts: modSelCtns,
  })
  exitModSelRe.current = modSel.exitSelectionMode

  const resModCtnTgt = useCallback((modifier: MnlMod) => {
    // context menus act on the full current selection when the clicked row is already selected; otherwise they fall
    // back to the single row under the pointer.
    if (
      modSel.selectionMode &&
      modSel.selectedIdSet.has(modifier.id) &&
      modSel.selectedVals.length > 0
    ) {
      return {
        ids: modSel.selectedIdsInOrder,
        modifiers: modSel.selectedVals,
      }
    }

    return {
      ids: [modifier.id],
      modifiers: [modifier],
    }
  }, [
    modSel.selectedIdSet,
    modSel.selectedIdsInOrder,
    modSel.selectedVals,
    modSel.selectionMode,
  ])

  const mkModRowCtxM = useCallback((modifier: MnlMod): MenuEntry[] => {
    const target = resModCtnTgt(modifier)
    // keep local fallback items here so the row remains usable if the shared calculator menu provider is not mounted.
    const fllbTms: MenuEntry[] = [
      {
        id: `manual-buffs:${modifier.id}:copy`,
        label: 'Copy',
        onSelect: () => {
          void copyMnlMdfr(target.modifiers)
        },
      },
      {
        id: `manual-buffs:${modifier.id}:cut`,
        label: 'Cut',
        onSelect: () => {
          void cutMnlMdfr(target.ids, target.modifiers)
        },
      },
      {
        id: `manual-buffs:${modifier.id}:paste`,
        label: 'Paste',
        onSelect: () => {
          void pstMnlMdfr(
            modSel.selectionMode && modSel.selectedIdSet.has(modifier.id)
              ? modSel.selectedIdsInOrder
              : [],
          )
        },
      },
      {
        id: `manual-buffs:${modifier.id}:duplicate`,
        label: 'Duplicate',
        onSelect: () => dplcMnlMdfr(target.modifiers),
      },
      {
        id: `manual-buffs:${modifier.id}:delete`,
        label: 'Delete',
        danger: true,
        onSelect: () => dltMnlModSel(target.ids),
      },
      {
        id: `manual-buffs:${modifier.id}:select`,
        label: 'Select',
        onSelect: () => modSel.addToSelection(modifier.id),
      },
    ]

    return menu?.builders.calculator.manualBuffs.item({
      modifierId: modifier.id,
      onCopy: () => {
        void copyMnlMdfr(target.modifiers)
      },
      onCut: () => {
        void cutMnlMdfr(target.ids, target.modifiers)
      },
      onPaste: () => {
        void pstMnlMdfr(
          modSel.selectionMode && modSel.selectedIdSet.has(modifier.id)
            ? modSel.selectedIdsInOrder
            : [],
        )
      },
      onDuplicate: () => dplcMnlMdfr(target.modifiers),
      onDelete: () => dltMnlModSel(target.ids),
      onSelect: () => modSel.addToSelection(modifier.id),
    }) ?? fllbTms
  }, [
    copyMnlMdfr,
    cutMnlMdfr,
    dltMnlModSel,
    dplcMnlMdfr,
    menu?.builders.calculator.manualBuffs,
    modSel,
    pstMnlMdfr,
    resModCtnTgt,
  ])

  const mkModPaneCtx = useCallback((): MenuEntry[] => {
    const fllbTms: MenuEntry[] = [
      {
        id: 'manual-buffs:pane:paste',
        label: 'Paste',
        onSelect: () => {
          void pstMnlMdfr(
            modSel.selectionMode ? modSel.selectedIdsInOrder : [],
          )
        },
      },
      {
        id: 'manual-buffs:pane:select-all',
        label: 'Select All',
        disabled: vsblModIds.length === 0,
        onSelect: modSel.selectAll,
      },
      {
        id: 'manual-buffs:pane:deselect-all',
        label: 'Deselect All',
        disabled: !modSel.selectionMode,
        onSelect: modSel.deselectAll,
      },
    ]

    return menu?.builders.calculator.manualBuffs.pane({
      canSelectAny: vsblModIds.length > 0,
      selMode: modSel.selectionMode,
      onPaste: () => {
        void pstMnlMdfr(
          modSel.selectionMode ? modSel.selectedIdsInOrder : [],
        )
      },
      onSelectAll: modSel.selectAll,
      onDeselectAll: modSel.deselectAll,
    }) ?? fllbTms
  }, [
    menu?.builders.calculator.manualBuffs,
    modSel,
    pstMnlMdfr,
    vsblModIds.length,
  ])

  const xprtMnlBffs = () => {
    // exported payloads include the wrapper metadata expected by newer imports while still leaving the manual buff
    // object intact for older import helpers.
    const payload: MnlBffsXprtP = {
      type: 'manual-buffs',
      version: BUFF_CLIP_VER,
      resonatorId: runtime.id,
      exportedAt: new Date().toISOString(),
      manualBuffs,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `${runtime.id}-manual-buffs.json`
    link.click()

    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const mprtMnlBffs = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // clear the input immediately so importing the same file twice still fires a change event.
    event.target.value = ''

    if (!file) {
      return
    }

    try {
      const rawText = await file.text()
      const parsedJson = JSON.parse(rawText) as unknown
      const rslvPay = mprtPay(parsedJson)
      const prsdMnlBffs = mnlBffsSchm.safeParse(rslvPay)

      if (!prsdMnlBffs.success) {
        throw new Error(prsdMnlBffs.error.issues[0]?.message ?? 'Invalid manual buffs JSON.')
      }

      // import sanitation clamps old or hand-edited payloads back to the currently supported option set before they
      // replace runtime state.
      const sntzMnlBffs = cleanBuffs(prsdMnlBffs.data)

      onRtPdt((prev) => ({
        ...prev,
        state: {
          ...prev.state,
          manualBuffs: sntzMnlBffs,
        },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid manual buffs JSON.'
      window.alert(`Import failed: ${message}`)
    }
  }

  const viewQckNpt = (
    value: number,
    onChange: (value: number) => void,
    suffix: string | null = '%',
    max = 999,
  ) => (
    <div className={`custom-buff-input ${suffix ? 'has-suffix' : ''}`}>
      <NumberInput
        value={value}
        min={-max}
        max={max}
        onChange={onChange}
      />
      {suffix ? <span>{suffix}</span> : null}
    </div>
  )

  const viewDualBuff = (label: string, stat: MnlBaseStatK) => (
    <div key={label} className="custom-buff-row">
      <label className="custom-buff-row-label">{label}</label>
      <div className="custom-buff-dual">
        {viewQckNpt(
          manualBuffs.quick[stat].flat,
          (value) => updQckBaseSt(stat, 'flat', value),
          null,
          9999,
        )}
        {viewQckNpt(
          manualBuffs.quick[stat].percent,
          (value) => updQckBaseSt(stat, 'percent', value),
          '%',
          999,
        )}
      </div>
    </div>
  )

  const viewSnglQckR = (
    label: string,
    key: Exclude<keyof QuickBuffs, 'atk' | 'hp' | 'def'>,
    suffix: string | null = '%',
    max = 999,
  ) => (
    <div key={String(key)} className="custom-buff-row">
      <label className="custom-buff-row-label">{label}</label>
      {viewQckNpt(
        manualBuffs.quick[key],
        (value) => updQckSclr(key, value),
        suffix,
        max,
      )}
    </div>
  )

  const viewModVlNpt = (modifier: MnlMod) => (
    <div className={`custom-buff-input ${getModVlSfx(modifier) ? 'has-suffix' : ''}`}>
      <NumberInput
        value={modifier.value}
        min={-getModVlMax(modifier)}
        max={getModVlMax(modifier)}
        onChange={(value) => {
          const nextValue = clmpMnlModVl(modifier, value)
          updateMod(modifier.id, (current) => ({
            ...current,
            value: nextValue,
          }))
        }}
      />
      {getModVlSfx(modifier) ? <span>{getModVlSfx(modifier)}</span> : null}
    </div>
  )

  const viewModFld = (
    label: string,
    control: ReactNode,
    className?: string,
  ) => (
    <label className={['manual-modifier-field', className].filter(Boolean).join(' ')}>
      <span>{label}</span>
      {control}
    </label>
  )

  const viewModTgtFl = (modifier: MnlMod) => {
    const scopeField = viewModFld(
      'Scope',
      <LiquidSelect
        value={modifier.scope}
        options={DVNCSCPPTNS}
        onChange={(value) =>
          updateMod(modifier.id, (current) => ({
            ...mkDefMnlMod(current.id, value as MnlModScp),
            enabled: current.enabled,
          }))
        }
      />,
    )

    if (modifier.scope === 'attribute') {
      return (
        <>
          {scopeField}
          {viewModFld(
            'Element',
            <LiquidSelect
              value={modifier.attribute}
              options={DVNCTTRBPTNS}
              onChange={(value) =>
                updateMod(modifier.id, (current) => ({
                  ...current,
                  attribute: value as Extract<MnlMod, { scope: 'attribute' }>['attribute'],
                }) as MnlMod)
              }
            />,
          )}
        </>
      )
    }

    if (modifier.scope === 'skillType') {
      return (
        <>
          {scopeField}
          {viewModFld(
            'Skill Type',
            <LiquidSelect
              value={modifier.skillType}
              options={ADV_SKILL_TYPES}
              onChange={(value) =>
                updateMod(modifier.id, (current) => ({
                  ...current,
                  skillType: value as Extract<MnlMod, { scope: 'skillType' }>['skillType'],
                }) as MnlMod)
              }
            />,
          )}
        </>
      )
    }

    if (modifier.scope === 'skill') {
      return (
        <>
          {scopeField}
          {viewModFld(
            'Match By',
            <LiquidSelect
              value={modifier.matchMode}
              options={ADV_SKILL_MATCH}
              onChange={(value) =>
                updateMod(modifier.id, (current) => ({
                  ...(current as Extract<MnlMod, { scope: 'skill' }>),
                  matchMode: value as MnlSkllMtchM,
                  skillId: value === 'skillId' ? (current.scope === 'skill' ? current.skillId ?? '' : '') : undefined,
                  tab: value === 'tab' ? (current.scope === 'skill' ? current.tab ?? tabOptions[0]?.value ?? 'normalAttack' : 'normalAttack') : undefined,
                  skillType: value === 'skillType' ? (current.scope === 'skill' ? current.skillType ?? 'all' : 'all') : undefined,
                }))
              }
            />,
          )}
          {viewModFld(
            modifier.matchMode === 'skillId' ? 'Skill' : modifier.matchMode === 'tab' ? 'Tab' : 'Skill Type',
            <LiquidSelect
              value={modifier.matchMode === 'skillId'
                ? modifier.skillId ?? ''
                : modifier.matchMode === 'tab'
                  ? modifier.tab ?? ''
                  : modifier.skillType ?? 'all'}
              options={
                modifier.matchMode === 'skillId'
                  ? [{ value: '', label: 'Select Skill' }, ...skillOptions]
                  : modifier.matchMode === 'tab'
                    ? (tabOptions.length > 0
                      ? tabOptions
                      : [{ value: 'normalAttack', label: 'Normal Attack' }])
                    : ADV_SKILL_TYPES
              }
              onChange={(value) =>
                updateMod(modifier.id, (current) => ({
                  ...(current as Extract<MnlMod, { scope: 'skill' }>),
                  ...(modifier.matchMode === 'skillId'
                    ? { skillId: value }
                    : modifier.matchMode === 'tab'
                      ? { tab: value }
                      : { skillType: value as Extract<MnlMod, { scope: 'skill' }>['skillType'] }),
                }))
              }
            />,
          )}
        </>
      )
    }

    return scopeField
  }

  const viewModFfctF = (modifier: MnlMod) => {
    if (modifier.scope === 'baseStat') {
      return (
        <>
          {viewModFld(
            'Stat',
            <LiquidSelect
              value={modifier.stat}
              options={DVNCBASESTAT}
              onChange={(value) =>
                updateMod(modifier.id, (current) => ({
                  ...current,
                  stat: value as MnlBaseStatK,
                }) as MnlMod)
              }
            />,
          )}
          {viewModFld(
            'Field',
            <LiquidSelect
              value={modifier.field}
              options={DVNCBASESTuv}
              onChange={(value) =>
                updateMod(modifier.id, (current) => ({
                  ...current,
                  field: value as 'flat' | 'percent',
                  value: clmpMnlModVl(
                    { ...(current as Extract<MnlMod, { scope: 'baseStat' }>), field: value as 'flat' | 'percent' },
                    current.value,
                  ),
                }) as MnlMod)
              }
            />,
          )}
          {viewModFld('Value', viewModVlNpt(modifier), 'manual-modifier-field--value')}
        </>
      )
    }

    if (modifier.scope === 'topStat') {
      return (
        <>
          {viewModFld(
            'Stat',
            <LiquidSelect
              value={modifier.stat}
              options={DVNCTOPSTATP}
              onChange={(value) =>
                updateMod(modifier.id, (current) => ({
                  ...current,
                  stat: value as MnlTopStatKe,
                  value: clmpMnlModVl(
                    { ...(current as Extract<MnlMod, { scope: 'topStat' }>), stat: value as MnlTopStatKe },
                    current.value,
                  ),
                }) as MnlMod)
              }
            />,
          )}
          {viewModFld('Value', viewModVlNpt(modifier), 'manual-modifier-field--value')}
        </>
      )
    }

    if (modifier.scope === 'skill') {
      return (
        <>
          {viewModFld(
            'Modifier',
            <LiquidSelect
              value={getSkllModPt(modifier)}
              options={SKLLMODPTNS}
              onChange={(value) =>
                updateMod(
                  modifier.id,
                  (current) => applySkillMod(
                    current as Extract<MnlMod, { scope: 'skill' }>,
                    value,
                  ),
                )
              }
            />,
          )}
          {modifier.effect === 'addHitMultiplier' ? viewModFld(
            'Hit',
            <input
              type="number"
              min={1}
              max={99}
              value={modifier.hitIndex + 1}
              onChange={(event) =>
                updateMod(modifier.id, (current) => ({
                  ...(current as Extract<MnlMod, { scope: 'skill' }>),
                  hitIndex: Math.max(0, (Number(event.target.value) || 1) - 1),
                }) as MnlMod)
              }
            />,
          ) : null}
          {modifier.effect === 'scalar' ? viewModFld(
            'Field',
            <LiquidSelect
              value={modifier.field}
              options={SKLLSCLRPTNS}
              onChange={(value) =>
                updateMod(modifier.id, (current) => ({
                  ...(current as Extract<MnlMod, { scope: 'skill' }>),
                  field: value as MnlSkllSclrK,
                  value: clmpMnlModVl(
                    { ...(current as Extract<MnlMod, { scope: 'skill' }>), effect: 'scalar', field: value as MnlSkllSclrK },
                    current.value,
                  ),
                }) as MnlMod)
              }
            />,
          ) : null}
          {viewModFld('Value', viewModVlNpt(modifier), 'manual-modifier-field--value')}
        </>
      )
    }

    if (modifier.scope === 'negativeEffect') {
      return (
        <>
          {viewModFld(
            'Effect',
            <LiquidSelect
              value={modifier.negativeEffect}
              options={NEG_EFFECT_OPTS}
              onChange={(value) =>
                updateMod(modifier.id, (current) => ({
                  ...current,
                  negativeEffect: value as Extract<MnlMod, { scope: 'negativeEffect' }>['negativeEffect'],
                }) as MnlMod)
              }
            />,
          )}
          {viewModFld(
            'Modifier',
            <LiquidSelect
              value={modifier.mod}
              options={NEG_EFFECT_MODS}
              onChange={(value) =>
                updateMod(modifier.id, (current) => ({
                  ...current,
                  mod: value as MnlNegFfctModKey,
                  value: clmpMnlModVl(
                    { ...(current as Extract<MnlMod, { scope: 'negativeEffect' }>), mod: value as MnlNegFfctModKey },
                    current.value,
                  ),
                }) as MnlMod)
              }
            />,
          )}
          {viewModFld('Value', viewModVlNpt(modifier), 'manual-modifier-field--value')}
        </>
      )
    }

    return (
      <>
        {viewModFld(
          'Modifier',
          <LiquidSelect
            value={modifier.mod}
            options={MOD_VL_PTNS}
            onChange={(value) =>
              updateMod(modifier.id, (current) => ({
                ...current,
                mod: value as MnlModVlKey,
              }) as MnlMod)
            }
          />,
        )}
        {viewModFld('Value', viewModVlNpt(modifier), 'manual-modifier-field--value')}
      </>
    )
  }

  const viewModRow = (modifier: MnlMod) => {
    const selected = modSel.isSelected(modifier.id)
    const summary = modSummary(modifier, { skillOptions, tabOptions })

    return (
      <ContextTrigger
        key={modifier.id}
        asChild
        ariaLabel="Advanced modifier actions"
        items={mkModRowCtxM(modifier)}
      >
        <Expandable
          as="article"
          className={[
            'manual-modifier-row rotation-item ui-surface-card ui-surface-card--inner',
            selected ? 'focus-selected' : '',
            modSel.selectionMode ? 'selection-mode' : '',
          ].filter(Boolean).join(' ')}
          data-selection-focus-item="true"
          aria-selected={selected ? 'true' : 'false'}
          onClickCapture={modSel.buildClickCapture(modifier.id)}
          chevWrapClass="rotation-collapse-button manual-modifier-collapse"
          triggerClass="manual-modifier-expandable-trigger"
          contentClass="manual-modifier-expandable"
          innerClass="manual-modifier-layout"
          chevronClass="manual-modifier-chevron"
          chevronSize={16}
          defaultOpen={false}
          header={
            <div className="manual-modifier-card-head">
              <div className="manual-modifier-card-copy">
                <div className="manual-modifier-card-topline">
                  <span className="manual-modifier-card-index">{summary}</span>
                </div>
              </div>

              <div className="manual-modifier-actions">
                <button
                  type="button"
                  className="block-icon-button power"
                  title={modifier.enabled ? 'Disable modifier' : 'Enable modifier'}
                  aria-pressed={modifier.enabled}
                  onClick={(event) => {
                    event.stopPropagation()
                    updateMod(modifier.id, (current) => ({
                      ...current,
                      enabled: !current.enabled,
                    }))
                  }}
                >
                  {modifier.enabled ? <Power size={16} /> : <PowerOff size={16} />}
                </button>
                <button
                  type="button"
                  className="block-icon-button copy"
                  title="Duplicate modifier"
                  aria-label="Duplicate modifier"
                  onClick={(event) => {
                    event.stopPropagation()
                    dplcMnlMod(modifier)
                  }}
                >
                  <CopyPlus size={15} />
                </button>
                <button
                  type="button"
                  className="block-icon-button delete"
                  title="Remove modifier"
                  aria-label="Remove modifier"
                  onClick={(event) => {
                    event.stopPropagation()
                    rmMnlMod(modifier.id)
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          }
        >
          <section className="manual-modifier-panel block-entries-list ui-surface-card ui-surface-card--inner">
            <span className="manual-modifier-panel-label">Target</span>
            <div className="manual-modifier-fields">
              {viewModTgtFl(modifier)}
            </div>
          </section>

          <section className="manual-modifier-panel block-entries-list ui-surface-card ui-surface-card--inner">
            <span className="manual-modifier-panel-label">Effect</span>
            <div className="manual-modifier-fields">
              {viewModFfctF(modifier)}
            </div>
          </section>
        </Expandable>
      </ContextTrigger>
    )
  }

  return (
    <>
      {showQckStats ? (
        <div className={cardClssName}>
          <h4>Main Stats</h4>
          <div className="custom-buffs-grid">
            {MAINSTATBUFF.map((field) => viewDualBuff(field.label, field.stat))}
            {MAINSCLRBUFF.map((field) => viewSnglQckR(field.label, field.key, '%', field.max ?? 999))}
          </div>
        </div>
      ) : null}

      <div className={cardClssName}>
        <div className="custom-buffs-head custom-buffs-head--modifiers">
          <div>
            <h4>Advanced Modifiers</h4>
          </div>
          <div className="manual-modifier-head-actions">
            <span className="manual-modifier-count">
              {manualBuffs.modifiers.length} {manualBuffs.modifiers.length === 1 ? 'entry' : 'entries'}
            </span>
            <button
              type="button"
              className="block-icon-button manual-modifier-add"
              title="Presets"
              aria-label="Presets"
              onClick={presetModal.show}
            >
              <Sparkles size={15} />
            </button>
            <button
              type="button"
              className="block-icon-button manual-modifier-add"
              title="Add modifier"
              onClick={addMnlMod}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <ContextTrigger
          asChild
          ariaLabel="Advanced modifier list actions"
          getItems={mkModPaneCtx}
        >
          <div className="manual-modifier-list" {...modSel.surfaceProps}>
            {manualBuffs.modifiers.length === 0 ? (
              <div className="soft-empty manual-modifier-empty">
                No advanced modifiers yet.
              </div>
            ) : (
              vsblMdfr.map(viewModRow)
            )}
          </div>
        </ContextTrigger>
      </div>

      {showTrnsCtns ? (
        <div className="custom-buffs-footer">
          <input
            ref={mprtNptRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={mprtMnlBffs}
          />
          <button
            type="button"
            className="ui-pill-button"
            onClick={() => mprtNptRef.current?.click()}
          >
            Import
          </button>
          <button
            type="button"
            className="ui-pill-button"
            onClick={xprtMnlBffs}
          >
            Export
          </button>
          <button
            type="button"
            className="ui-pill-button ui-pill-button-danger custom-buffs-clear"
            onClick={() => confirmation.confirm({
              title: 'You sure about that? ( · ❛ ֊ ❛)',
              message: 'This will reset all custom bonuses back to their defaults.',
              confirmLabel: 'Clear All',
              variant: 'danger',
              onConfirm: () =>
                onRtPdt((prev) => ({
                  ...prev,
                  state: {
                    ...prev.state,
                    manualBuffs: makeCustomBuff(),
                  },
                })),
            })}
          >
            Clear All
          </button>
        </div>
      ) : null}

      <BuffPresetModal
        state={presetModal.dialogProps}
        runtime={runtime}
        onClose={presetModal.hide}
        onAdd={addPresetMdfr}
      />

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
    </>
  )
}
