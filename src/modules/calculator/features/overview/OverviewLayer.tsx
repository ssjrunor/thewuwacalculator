/*
  Author: Runor Ewhro
  Description: Renders the overview layer surface for the calculator overview flow.
*/

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties as CssProps, SyntheticEvent as SyntVnt } from 'react'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import { isNoWeaponId } from '@/domain/entities/runtime'
import type { EnemyProfile } from '@/domain/entities/appState'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { makeCombatGraph } from '@/domain/state/combatGraph'
import { getEchoById } from '@/domain/services/echoCatalogService'
import type { SimResult } from '@/engine/pipeline/types'
import type { StateGroup } from '@/modules/calculator/model/stateSummary.ts'
import { getWpnById } from '@/domain/services/weaponCatalogService'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import {
  ggrgEchoStts,
  getMkScrPrcn,
  getEchoScrPr,
  getMaxEchoSc,
} from '@/data/scoring/echoScoring'
import { cmptEchoCrit, getCvBdgClss, getScrBdgCls } from '@/modules/calculator/features/echoes/lib/metric.ts'
import { listRotFeatR } from '@/engine/rotation/system'
import { mkVrvwSttSmm } from '@/modules/calculator/model/stateSummary.ts'
import { getResonator, spriteVars } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { seedRsntById } from '@/modules/calculator/features/resonator/lib/seedData.ts'
import { mkPrepLiveCm } from '@/modules/calculator/model/selectors'
import { getPrimarySkill, getSkillType } from '@/modules/calculator/model/skillTypes'
import { getEchoCostB } from '@/modules/calculator/features/echoes/lib/echoes.ts'
import { getRotFtr, getWpnVslKey, grpByVrg } from '@/modules/calculator/features/overview/lib/overview.ts'
import type { SttsTreeNode } from '@/modules/calculator/features/overview/lib/stats.ts'
import { ATTR_COLORS } from '@/modules/calculator/model/display'
import {
  STATICONMAP,
  mkVrvwSttsVi,
  mkSttsTree,
  fmtCmpcNmbr,
  fmtDsplVl,
  fmtStatKeyLb,
  fmtStatKeyVl,
} from '@/modules/calculator/features/overview/lib/stats.ts'
import { toTitle } from '@/shared/lib/format'
import { useCnfr } from '@/app/hooks/useConfirmation.ts'
import { Expandable } from '@/shared/ui/Expandable'
import { useAppStore } from '@/domain/state/store.ts'
import { mainPortal } from '@/shared/lib/portalTarget'
import { CnfrMdl } from '@/shared/ui/ConfirmationModal'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { mkPrepWork } from '@/engine/pipeline/preparedWorkspace'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { useEchoSrfcM } from '@/modules/calculator/features/echoes/lib/useEchoSurfaceMenu.tsx'
import { qpEchoAtSlot } from '@/modules/calculator/features/echoes/lib/equip.ts'
import {
  makeProfileClip,
  readProfClip,
  writeProfClip,
} from '@/modules/calculator/features/overview/lib/clipboard.ts'
import {Copy, Scissors, Trash2} from 'lucide-react'
import { useSel } from '@/modules/calculator/lib/sel.tsx'
import { getOvDashCtx, getOvPillCtx, getOvStgCtx } from '@/modules/calculator/features/overview/lib/ctx.tsx'

// renders the overview modal that surfaces alternate resonators and detailed stats.
interface VrvwLyrPrps {
  actResId: string | null
  enemyProfile: EnemyProfile
  onClose: () => void
  vrvwSttSmmr: StateGroup[]
  rtngSlctBytf: Record<string, Record<string, string | null>>
  runtime: ResRuntime | null
  runtimesById: Record<string, ResRuntime>
  showExtraStates: boolean
  simulation: SimResult | null
  onImageError: (event: SyntVnt<HTMLImageElement>) => void
}

function SttsTreeLepg({ node }: { node: SttsTreeNode & { kind: 'leaf' } }) {
  if (node.baseValue) {
    return (
      <div className="overview-tree-tile">
        <span className="overview-tree-tile-label">{node.label}</span>
        <span className="overview-tree-tile-final">
          {node.displayValue}
          {node.diffValue ? (
            <sup className={`overview-tree-tile-diff overview-tree-tile-diff--${node.diffSign}`}>
              {node.diffValue}
            </sup>
          ) : null}
        </span>
        <span className="overview-tree-tile-base">Base {node.baseValue}</span>
      </div>
    )
  }

  return (
    <div className="overview-tree-leaf">
      <span className="overview-tree-leaf-label">{node.label}</span>
      <span className="overview-tree-leaf-value" style={node.color ? { color: node.color } as CssProps : undefined}>
        {node.displayValue}
      </span>
    </div>
  )
}

function StatsTreeNode({ node }: { node: SttsTreeNode }) {
  if (node.kind === 'leaf') {
    return <SttsTreeLepg node={node} />
  }

  const kidsClss = node.flow
    ? `overview-tree-children overview-tree-children--${node.flow}`
    : 'overview-tree-children'

  return (
    <div className="overview-tree-branch">
      <div className="overview-tree-branch-head" style={node.color ? { '--tree-accent': node.color } as CssProps : undefined}>
        {node.label}
      </div>
      <div className={kidsClss}>
        {node.children.map((child) => (
          <StatsTreeNode key={child.key} node={child} />
        ))}
      </div>
    </div>
  )
}

export function VrvwLyr({
  actResId: actResId,
  enemyProfile,
  onClose,
  vrvwSttSmmr: vrvwSttSmmr,
  rtngSlctBytf: rtngSlctByRe,
  runtime,
  runtimesById,
  showExtraStates: showNqntVrvw,
  simulation,
  onImageError,
}: VrvwLyrPrps) {
  const visibleRes = useMemo(
    () =>
      Object.entries(runtimesById)
        .map(([resonatorId, runtimeState]) => {
          const resonator = getResonator(resonatorId)
          const attribute = resonator?.attribute ?? 'aero'

          return {
            id: resonatorId,
            name: resonator?.name ?? toTitle(resonatorId),
            attribute,
            resonator,
            runtime: runtimeState,
            accent: ATTR_COLORS[attribute] ?? '#6b7cff',
          }
        })
        .sort((left, right) => {
          if (left.attribute !== right.attribute) {
            return left.attribute.localeCompare(right.attribute)
          }

          return left.name.localeCompare(right.name)
        }),
    [runtimesById],
  )

  const [selResId, setSelResId] = useState<string | null>(
    actResId ?? visibleRes[0]?.id ?? null,
  )

  const profilesById = useAppStore((state) => state.calculator.profiles)
  const selEnt =
    visibleRes.find((entry) => entry.id === selResId) ??
    visibleRes.find((entry) => entry.id === actResId) ??
    visibleRes[0] ??
    null
  const swtcToRes = useAppStore((s) => s.swRes)
  const dltResPrfl = useAppStore((state) => state.delResProfs)
  const psrtResPrfl = useAppStore((state) => state.upsertRes)
  const updActResRt = useAppStore((state) => state.updActRt)
  const confirmation = useCnfr()
  const showToast = useTstStr((state) => state.show)
  const portalTarget = mainPortal()

  const vlblRsntById = useMemo(
    () => new Map(visibleRes.map((entry) => [entry.id, entry])),
    [visibleRes],
  )

  useEffect(() => {
    // selection is derived from persisted profiles, so repair stale ids after
    // imports or deletes before downstream memoized graph work reads them.
    if (visibleRes.length === 0) {
      if (selResId !== null) {
        setSelResId(null)
      }
      return
    }

    const availableIds = new Set(visibleRes.map((entry) => entry.id))
    if (selResId && availableIds.has(selResId)) {
      return
    }

    const fallbackId =
      (actResId && availableIds.has(actResId) ? actResId : null)
      ?? visibleRes[0]?.id
      ?? null

    if (fallbackId !== selResId) {
      setSelResId(fallbackId)
    }
  }, [actResId, visibleRes, selResId])

  const selRt = selEnt?.runtime ?? (selEnt?.id === actResId ? runtime : null)
  const isSelResAct = selEnt?.id === actResId
  const selectedSeed = selEnt ? seedRsntById[selEnt.id] ?? null : null
  const selPartRntmB = useMemo(
    () => (selRt ? makeRuntimeMap(selRt, runtimesById) : {}),
    [runtimesById, selRt],
  )
  const selTrgtByOwn = useMemo(
    () => (selEnt ? rtngSlctByRe[selEnt.id] ?? {} : {}),
    [rtngSlctByRe, selEnt],
  )
  const combatGraph = useMemo(() => {
    if (!selRt || isSelResAct) {
      return null
    }

    // inactive overview entries do not already have a live graph, so build a
    // transient one that mirrors how the active calculator would simulate them.
    return makeCombatGraph({
      actRt: selRt,
      partRts: selPartRntmB,
      targetsByRes: {
        [selRt.id]: selTrgtByOwn,
      },
    })
  }, [
    isSelResAct,
    selPartRntmB,
    selRt,
    selTrgtByOwn,
  ])
  const selPrepWork = useMemo(() => {
    if (!selRt || !selectedSeed || isSelResAct) {
      return null
    }

    // prepared workspaces let the overview reuse the richer graph-aware
    // simulation path for non-active resonators without mutating live state.
    return mkPrepWork({
      runtime: selRt,
      seed: selectedSeed,
      enemy: enemyProfile,
      prtcRntmById: selPartRntmB,
      activeTarget: selTrgtByOwn,
      combatGraph: combatGraph,
    })
  }, [
    enemyProfile,
    isSelResAct,
    combatGraph,
    selPartRntmB,
    selRt,
    selectedSeed,
    selTrgtByOwn,
  ])
  const selSmlt = useMemo(() => {
    if (!selRt || !selectedSeed) {
      return null
    }

    if (isSelResAct) {
      return simulation
    }

    return mkPrepLiveCm(selPrepWork)
  }, [
    isSelResAct,
    selRt,
    selectedSeed,
    selPrepWork,
    simulation,
  ])
  const selEntHasEch = selEnt ? getMaxEchoSc(selEnt.id) > 0 : false
  const selVrvwSttSm = useMemo(() => {
    if (!selRt) {
      return []
    }

    if (isSelResAct) {
      return vrvwSttSmmr
    }

    // non-active entries need their summary rebuilt against the transient graph
    // so the dashboard reflects that resonator's own routing and team context.
    return mkVrvwSttSmm(
      selRt,
      selPartRntmB,
      combatGraph,
      selTrgtByOwn,
      {
        cntxByResId: selPrepWork?.cntxByResId,
        enemyProfile,
        showNqntStts: showNqntVrvw,
      },
    )
  }, [
    enemyProfile,
    isSelResAct,
    combatGraph,
    vrvwSttSmmr,
    selPrepWork,
    selPartRntmB,
    selRt,
    selTrgtByOwn,
    showNqntVrvw,
  ])
  const actVrvwSttGr =
    selVrvwSttSm.find((group) => group.sourceId === selRt?.id) ?? null
  const spprVrvwSttG = selVrvwSttSm.filter(
    (group) => group.sourceId !== selRt?.id,
  )

  const actRes = selEnt?.resonator ?? null
  const actResName = actRes?.name ?? selEnt?.name ?? 'No Resonator'
  const actTtrb = actRes?.attribute ?? selEnt?.attribute ?? 'aero'
  const activeAccent = selEnt?.accent ?? ATTR_COLORS[actTtrb] ?? '#6b7cff'

  const resNextSelRe = useCallback((removedIds: string[]) => {
    const removedIdSet = new Set(removedIds)
    const rmnnRsnt = visibleRes.filter((entry) => !removedIdSet.has(entry.id))

    if (rmnnRsnt.length === 0) {
      return null
    }

    if (selEnt && !removedIdSet.has(selEnt.id)) {
      return selEnt.id
    }

    const currentIndex = selEnt
      ? visibleRes.findIndex((entry) => entry.id === selEnt.id)
      : -1

    // prefer the nearest surviving entry in display order instead of resetting
    // selection after a delete.
    if (currentIndex >= 0) {
      for (let nextIndex = currentIndex + 1; nextIndex < visibleRes.length; nextIndex += 1) {
        const nextEntry = visibleRes[nextIndex]
        if (nextEntry && !removedIdSet.has(nextEntry.id)) {
          return nextEntry.id
        }
      }

      for (let nextIndex = currentIndex - 1; nextIndex >= 0; nextIndex -= 1) {
        const nextEntry = visibleRes[nextIndex]
        if (nextEntry && !removedIdSet.has(nextEntry.id)) {
          return nextEntry.id
        }
      }
    }

    return rmnnRsnt[0]?.id ?? null
  }, [visibleRes, selEnt])

  const mkClpbEntsFo = useCallback((resonatorIds: string[]) => (
    resonatorIds.flatMap((resonatorId) => {
      const entry = vlblRsntById.get(resonatorId)
      const profile = profilesById[resonatorId]

      if (!entry || !profile) {
        return []
      }

      // clipboard payloads carry the full persisted profile instead of the
      // rendered overview entry so paste can rebuild the exact saved state.
      return [{
        resonatorId,
        resonatorName: entry.name,
        profile,
      }]
    })
  ), [vlblRsntById, profilesById])

  const copyResPrflT = useCallback(async (resonatorIds: string[]) => {
    const clpbEnts = mkClpbEntsFo(resonatorIds)
    if (clpbEnts.length === 0) {
      showToast({
        content: 'Nothing to copy yet.',
        variant: 'default',
        duration: 2200,
      })
      return false
    }

    const wrote = await writeProfClip(
      makeProfileClip(clpbEnts),
    )

    if (wrote) {
      showToast({
        content: `Copied ${clpbEnts.length} resonator profile${clpbEnts.length === 1 ? '' : 's'}.`,
        variant: 'success',
        duration: 2200,
      })
    } else {
      showToast({
        content: 'Clipboard write failed.',
        variant: 'error',
        duration: 2600,
      })
    }

    return wrote
  }, [mkClpbEntsFo, showToast])

  const dltResPrflWi = useCallback((
    resonatorIds: string[],
    options: {
      title?: string
      message?: string
      confirmLabel?: string
      sccsMssg?: string
    } = {},
  ) => {
    const nrmlIds = resonatorIds.filter((resonatorId, index, list) => (
      Boolean(vlblRsntById.get(resonatorId)) && list.indexOf(resonatorId) === index
    ))

    if (nrmlIds.length === 0) {
      return
    }

    // collapse multi-select delete into one confirmation so bulk actions match
    // the current overview selection model.
    const nextSelId = resNextSelRe(nrmlIds)
    const rmvdEnts = nrmlIds
      .map((resonatorId) => vlblRsntById.get(resonatorId))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

    const title = options.title
      ?? (nrmlIds.length === 1 ? 'Delete this resonator profile?' : `Delete ${nrmlIds.length} resonator profiles?`)
    const message = options.message
      ?? (
        nrmlIds.length === 1
          ? `${rmvdEnts[0]?.name ?? 'This resonator'}'s saved calculator state will be removed from overview. inventory items stay intact.`
          : 'These saved calculator profiles will be removed from overview. inventory items stay intact.'
      )

    confirmation.confirm({
      title,
      message,
      confirmLabel: options.confirmLabel ?? 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
      onConfirm: () => {
        dltResPrfl(nrmlIds, nextSelId)
        setSelResId(nextSelId)
        showToast({
          content: options.sccsMssg
            ?? (nrmlIds.length === 1
              ? `${rmvdEnts[0]?.name ?? 'Resonator'} removed from overview.`
              : `Removed ${nrmlIds.length} resonator profiles from overview.`),
          variant: 'success',
          duration: 3000,
        })
      },
    })
  }, [vlblRsntById, confirmation, dltResPrfl, resNextSelRe, showToast])

  const pstVrvwPrflF = useCallback(async () => {
    const payload = await readProfClip()
    if (!payload) {
      showToast({
        content: 'Clipboard does not contain a resonator profile.',
        variant: 'default',
        duration: 2400,
      })
      return
    }

    // split overwrites from additions before applying paste so the destructive
    // path can be confirmed without discarding the single apply implementation.
    const vrwrEnts = payload.profiles.filter((entry) => Boolean(profilesById[entry.resonatorId]))
    const addedCount = payload.profiles.length - vrwrEnts.length
    const applyPaste = () => {
      psrtResPrfl(
        payload.profiles.map((entry) => entry.profile),
        payload.profiles.length === 1 ? 'Pasted Resonator Profile' : 'Pasted Resonator Profiles',
      )

      if (payload.profiles[0]?.resonatorId) {
        setSelResId(payload.profiles[0].resonatorId)
      }

      showToast({
        content: vrwrEnts.length > 0
          ? `Pasted ${payload.profiles.length} resonator profile${payload.profiles.length === 1 ? '' : 's'} (${vrwrEnts.length} overwritten${addedCount > 0 ? `, ${addedCount} added` : ''}).`
          : `Pasted ${payload.profiles.length} resonator profile${payload.profiles.length === 1 ? '' : 's'}.`,
        variant: 'success',
        duration: 3000,
      })
    }

    if (vrwrEnts.length === 0) {
      applyPaste()
      return
    }

    confirmation.confirm({
      title: vrwrEnts.length === 1
        ? `Overwrite ${vrwrEnts[0]?.resonatorName ?? 'this resonator'}?`
        : `Overwrite ${vrwrEnts.length} resonator profiles?`,
      message: vrwrEnts.length === 1
        ? `${vrwrEnts[0]?.resonatorName ?? 'This resonator'} already exists in overview. pasting will replace its saved calculator state.`
        : 'Some resonators in the clipboard already exist in overview. pasting will replace their saved calculator state.',
      confirmLabel: 'Overwrite',
      cancelLabel: 'Cancel',
      variant: 'danger',
      onConfirm: applyPaste,
    })
  }, [confirmation, profilesById, showToast, psrtResPrfl])

  const onDltRes = useCallback(() => {
    if (!selEnt) {
      return
    }

    dltResPrflWi([selEnt.id])
  }, [dltResPrflWi, selEnt])

  const weaponState = selRt?.build.weapon ?? null
  const weapon =
    weaponState?.id && !isNoWeaponId(weaponState.id) ? getWpnById(weaponState.id) : null
  const curWpnKey = getWpnVslKey(actRes?.weaponType ?? null)
  const wpnVslKey =
    weapon?.weaponType != null
      ? getWpnVslKey(weapon.weaponType)
      : curWpnKey
  const weaponName =
    weapon?.name ??
    (weaponState && !isNoWeaponId(weaponState.id) && weaponState.id ? toTitle(weaponState.id) : 'No Weapon')

  const vrvwStts =
    selSmlt && selRt ? mkVrvwSttsVi(selRt, selSmlt.finalStats) : null
  const statsTree =
    selSmlt ? mkSttsTree(selSmlt.finalStats) : null

  const selPersRotRo = useMemo(
    () =>
      selRt && selectedSeed
        ? listRotFeatR(
            selectedSeed,
            selRt,
            selPartRntmB,
            seedRsntById,
            'personal',
          )
        : [],
    [selPartRntmB, selRt, selectedSeed],
  )
  const selTeamRotRo = useMemo(
    () =>
      selRt && selectedSeed
        ? listRotFeatR(
            selectedSeed,
            selRt,
            selPartRntmB,
            seedRsntById,
            'team',
          )
        : [],
    [selPartRntmB, selRt, selectedSeed],
  )
  const selPersRotCn = selPersRotRo.filter((entry) => entry.enabled).length || selPersRotRo.length
  const selTeamRotCn = selTeamRotRo.filter((entry) => entry.enabled).length || selTeamRotRo.length

  const persRot = selSmlt?.rotations.personal.total ?? null
  const teamRotation = selSmlt?.rotations.team.total ?? null
  const topSkllTyps = selSmlt
    ? grpByVrg(
        selSmlt.rotations.personal.entries,
        (entry) => getPrimarySkill(entry.skill.skillType) ?? 'all',
        (entry) => getSkillType(entry.skill.skillType).label,
        (entry) => entry.avg,
      )
    : []
  const topCntr = selSmlt
    ? grpByVrg(
        selSmlt.rotations.team.entries,
        (entry) => entry.resonatorId,
        (entry) => entry.resonatorName,
        (entry) => entry.avg,
      )
    : []

  const qppdChs = useMemo(
    () => selRt?.build.echoes ?? [],
    [selRt?.build.echoes],
  )
  const echoSrfcMenu = useEchoSrfcM({
    clpbSrcResId: selEnt?.id ?? actResId ?? 'unknown',
    clipSourceName: selEnt?.name ?? actResId ?? 'No Resonator',
    curChs: runtime?.build.echoes ?? [],
    onQpEchoAtjg: (echo, slotIndex) => {
      updActResRt((curRt) => ({
        ...curRt,
        build: {
          ...curRt.build,
          echoes: qpEchoAtSlot(curRt.build.echoes, echo, slotIndex),
        },
      }))
    },
  })
  const echoSelTms = useMemo(
    () => qppdChs
      .map((echo, index) => echo ? { id: `overview:${selEnt?.id ?? 'unknown'}:${index}`, val: echo } : null)
      .filter((item): item is { id: string; val: EchoInstance } => Boolean(item)),
    [qppdChs, selEnt?.id],
  )
  const echoSelCtns = useMemo(() => [{
    id: 'overview-echo:copy',
    key: 'copy' as const,
    needsSel: true,
    icon: <Copy size={14} />,
    label: ({ count }: { count: number }) => `Copy (${count})`,
    title: 'Copy selected echoes (Ctrl/Cmd+C)',
    run: async ({ vals }: { vals: EchoInstance[] }) => {
      const wrote = await echoSrfcMenu.copyEchoesToClipboard(vals)
      if (wrote) {
        showToast({
          content: `Copied ${vals.length} echo${vals.length === 1 ? '' : 'es'}.`,
          variant: 'success',
          duration: 2200,
        })
      }
    },
  }], [echoSrfcMenu, showToast])
  const echoSel = useSel({
    surfaceId: `overview:${selEnt?.id ?? 'unknown'}`,
    ariaLabel: 'Overview echo selection actions',
    items: echoSelTms,
    acts: echoSelCtns,
  })
  const resSelTms = useMemo(
    () => visibleRes.map(({ id }) => ({ id })),
    [visibleRes],
  )
  const resSelCtns = useMemo(() => [
    {
      id: 'overview-res:copy',
      key: 'copy' as const,
      needsSel: true,
      icon: <Copy size={14} />,
      label: ({ count }: { count: number }) => `Copy (${count})`,
      title: 'Copy selected resonators (Ctrl/Cmd+C)',
      run: async ({ ids }: { ids: string[] }) => {
        await copyResPrflT(ids)
      },
    },
    {
      id: 'overview-res:cut',
      key: 'cut' as const,
      needsSel: true,
      icon: <Scissors size={14} />,
      label: ({ count }: { count: number }) => `Cut (${count})`,
      title: 'Cut selected resonators (Ctrl/Cmd+X)',
      run: async ({ ids }: { ids: string[] }) => {
        const wrote = await copyResPrflT(ids)
        if (!wrote) {
          return
        }

        dltResPrflWi(ids, {
          title: ids.length === 1 ? 'Cut this resonator profile?' : `Cut ${ids.length} resonator profiles?`,
          message: ids.length === 1
            ? 'The profile was copied to the clipboard. deleting it here will remove it from overview.'
            : 'These profiles were copied to the clipboard. deleting them here will remove them from overview.',
          confirmLabel: 'Cut',
          sccsMssg: ids.length === 1
            ? 'Resonator profile cut to clipboard.'
            : `Cut ${ids.length} resonator profiles to clipboard.`,
        })
      },
    },
    {
      id: 'overview-res:del',
      key: 'delete' as const,
      needsSel: true,
      icon: <Trash2 size={14} />,
      danger: true,
      label: ({ count }: { count: number }) => `Delete (${count})`,
      title: 'Delete selected resonators (Delete)',
      run: ({ ids }: { ids: string[] }) => {
        dltResPrflWi(ids)
      },
    },
    {
      id: 'overview-res:paste',
      key: 'paste' as const,
      float: false,
      label: 'Paste',
      run: () => {
        void pstVrvwPrflF()
      },
    },
  ], [copyResPrflT, dltResPrflWi, pstVrvwPrflF])
  const resSel = useSel({
    surfaceId: 'overview:resonators',
    ariaLabel: 'Overview resonator selection actions',
    items: resSelTms,
    acts: resSelCtns,
  })
  const stgCtxMenuTm = useMemo(() => getOvStgCtx({
    canDelAll: visibleRes.length > 0,
    onPaste: () => {
      void pstVrvwPrflF()
    },
    onDelAll: () => {
      dltResPrflWi(
        visibleRes.map((entry) => entry.id),
        {
          title: 'Delete all resonator profiles?',
          message: 'This will remove every saved resonator profile from overview. the calculator will fall back to its default profile state.',
          sccsMssg: `Removed ${visibleRes.length} resonator profiles from overview.`,
        },
      )
    },
  }), [visibleRes, dltResPrflWi, pstVrvwPrflF])
  const dshbCtxMenuT = useMemo(() => {
    if (!selEnt || !selRt) {
      return []
    }

    return getOvDashCtx({
      canSwitch: selRt.id !== runtime?.id,
      onSwitch: () => swtcToRes(selRt.id),
      onDel: onDltRes,
    })
  }, [onDltRes, runtime?.id, selEnt, selRt, swtcToRes])
  const mkResPillCtx = useCallback((resonatorId: string) => {
    const entry = vlblRsntById.get(resonatorId)
    if (!entry) {
      return []
    }

    // context commands act on the selected set when the clicked pill is already
    // selected; otherwise the clicked profile becomes a one-item target.
    const selectionIds =
      resSel.selectionMode && resSel.isSelected(resonatorId)
        ? resSel.selectedIdsInOrder
        : [resonatorId]

    return getOvPillCtx({
      id: resonatorId,
      isActive: runtime?.id === resonatorId,
      isPicked: selEnt?.id === resonatorId,
      isSel: resSel.isSelected(resonatorId),
      onInspect: () => setSelResId(resonatorId),
      onSwitch: () => swtcToRes(resonatorId),
      onDel: () => {
        dltResPrflWi(selectionIds)
      },
      onCut: () => {
        void (async () => {
          const wrote = await copyResPrflT(selectionIds)
          if (!wrote) {
            return
          }

          dltResPrflWi(selectionIds, {
            title: selectionIds.length === 1 ? 'Cut this resonator profile?' : `Cut ${selectionIds.length} resonator profiles?`,
            message: selectionIds.length === 1
              ? 'The profile was copied to the clipboard. deleting it here will remove it from overview.'
              : 'These profiles were copied to the clipboard. deleting them here will remove them from overview.',
            confirmLabel: 'Cut',
            sccsMssg: selectionIds.length === 1
              ? 'Resonator profile cut to clipboard.'
              : `Cut ${selectionIds.length} resonator profiles to clipboard.`,
          })
        })()
      },
      onCopy: () => {
        void copyResPrflT(selectionIds)
      },
      onPaste: () => {
        void pstVrvwPrflF()
      },
      onSel: () => {
        resSel.focusSurface()
        resSel.toggleSelection(resonatorId)
      },
    })
  }, [
    vlblRsntById,
    copyResPrflT,
    dltResPrflWi,
    pstVrvwPrflF,
    resSel,
    runtime?.id,
    selEnt?.id,
    swtcToRes,
  ])
  const qppdEchoCnt = qppdChs.filter((echo): echo is EchoInstance => Boolean(echo)).length
  const echoCostSprd = qppdChs
    .filter((echo): echo is EchoInstance => Boolean(echo))
    .map((echo) => getEchoCostB(echo.id, 1))
    .join('-')

  const spprMmbr = (selRt?.build.team.slice(1) ?? [null, null]).map((memberId, index) => {
    const resonator = memberId ? getResonator(memberId) : null
    const memRt = memberId ? selPartRntmB[memberId] ?? null : null
    return {
      slotLabel: index === 0 ? 'Support Alpha' : 'Support Beta',
      resonator,
      runtime: memRt,
    }
  })

  const spprWpns = spprMmbr
    .map(({ resonator, runtime: spprRt }) => {
      if (!resonator || !spprRt) return null
      const spprWpnStt = spprRt.build.weapon
      const spprWpn =
        spprWpnStt.id && !isNoWeaponId(spprWpnStt.id)
          ? getWpnById(spprWpnStt.id)
          : null
      const spprWpnVslKe =
        spprWpn?.weaponType != null
          ? getWpnVslKey(spprWpn.weaponType)
          : getWpnVslKey(resonator.weaponType)

      return {
        id: resonator.id,
        icon: spprWpnVslKe ? `/assets/weapons/${spprWpnVslKe}.webp` : null,
        label: spprWpn?.name ?? 'Weapon Pending',
        detail: `R${spprWpnStt.rank ?? 1}`,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

  const setBuffs = Array.from(
      new Map(
          qppdChs
              .filter((echo): echo is EchoInstance => Boolean(echo))
              .map((echo) => {
                const setIcon = getSntSetIco(echo.set)
                const setName = getSntSetNam(echo.set)

                return [
                  echo.set,
                  {
                    id: echo.set,
                    icon: setIcon,
                    name: setName,
                  },
                ]
              }),
      ).values(),
  ).slice(0, 2)

  const memberCount = selRt?.build.team.filter((memberId): memberId is string => Boolean(memberId)).length ?? 0

  const hasWeights = useMemo(() => getMaxEchoSc(selRt?.id) > 0, [selRt?.id])
  const totals = ggrgEchoStts(qppdChs)
  const totalCV = (totals.critRate ?? 0) * 2 + (totals.critDmg ?? 0)

  const buildScore = hasWeights ? getMkScrPrcn(selRt.id, qppdChs) : null

  const viewSttGrp = (group: StateGroup) => (
    <Expandable
      key={group.id}
      as="article"
      className="calculator-hero-state-card"
      triggerClass="calculator-hero-state-expandable-trigger"
      contentClass="calculator-hero-state-expandable"
      innerClass="calculator-hero-state-scopes"
      chevronClass="calculator-hero-state-chevron"
      chevronSize={14}
      defaultOpen
      header={
        <div className="calculator-hero-state-card-head">
          <div className="calculator-hero-state-source">
            <span className="calculator-hero-state-source-frame">
              <img
                src={group.srcProf || '/assets/default.webp'}
                alt={group.sourceName}
                className="calculator-hero-state-source-image"
                loading="lazy"
                decoding="async"
                onError={onImageError}
              />
            </span>
            <div className="calculator-hero-state-source-copy">
              <span>Resonator Source</span>
              <strong>{group.sourceName}</strong>
            </div>
          </div>
          <span className="calculator-hero-state-badge">
            {group.scopes.length} {group.scopes.length === 1 ? 'branch' : 'branches'}
          </span>
        </div>
      }
    >
      {group.scopes.map((scope) => (
        <section key={scope.id} className="calculator-hero-state-scope">
          <div className="calculator-hero-state-scope-head">
            <span className="calculator-hero-state-scope-label">{scope.label}</span>
            <span className="calculator-hero-state-badge">
              {scope.nodes.length} {scope.nodes.length === 1 ? 'node' : 'nodes'}
            </span>
          </div>

          <div className="calculator-hero-state-nodes">
            {scope.nodes.map((node) => (
              <section key={node.id} className="calculator-hero-state-node">
                <div className="calculator-hero-state-node-head">
                  <div>
                    <strong>{node.ownerLabel}</strong>
                  </div>
                </div>

                <ul className="calculator-hero-state-effects">
                  {node.effectLabels.length > 0 ? (
                      node.effectLabels.map((label, index) => (
                          <li
                              key={`${node.id}-${index}`}
                              dangerouslySetInnerHTML={{ __html: label }}
                          />
                      ))
                  ) : (
                      <li>Active.</li>
                  )}
                </ul>
              </section>
            ))}
          </div>
        </section>
      ))}
    </Expandable>
  )

  return (
    <>
      <ContextTrigger
        asChild
        ariaLabel="Overview stage actions"
        items={stgCtxMenuTm}
      >
        <div
          className="character-overview-pane"
          style={{ '--resonator-accent': activeAccent } as CssProps}
        >
          <div className="character-overview-header">
            <h2>Overview</h2>
            <button type="button" onClick={onClose} className="character-overview-close">
              ← Back
            </button>
          </div>

          <div className="character-overview-content">
            <nav
                className="overview-resonator-strip"
                 aria-label="Resonator browser"
                 {...resSel.surfaceProps}
            >
              {visibleRes.length > 0 ? (
                visibleRes.map(({ id, name, resonator, runtime: resRt, accent }, i) => {
                  const isInspected = id === selEnt?.id
                  const isActive = id === runtime?.id
                  const isSelSel = resSel.isSelected(id)
                  const sprtStylVars = spriteVars(resonator)

                  return (
                      <ContextTrigger
                          key={id}
                          asChild
                          ariaLabel={`${name} actions`}
                          items={mkResPillCtx(id)}
                      >
                        <button
                            type="button"
                            className={[
                              'overview-resonator-pill',
                              isInspected ? 'inspected' : '',
                              isSelSel ? 'focus-selected' : '',
                              resSel.selectionMode ? 'selection-mode' : '',
                            ].filter(Boolean).join(' ')}
                            onClick={() => setSelResId(id)}
                            onClickCapture={resSel.buildClickCapture(id)}
                            aria-pressed={isSelSel}
                            data-inspected={isInspected ? 'true' : undefined}
                            data-selected={isSelSel ? 'true' : undefined}
                            data-selection-focus-item="true"
                            style={{
                              '--browser-accent': accent,
                              '--pill-index': i,
                              ...sprtStylVars,
                            } as CssProps}
                        >
                        <span className="overview-resonator-pill-frame" aria-hidden="true">
                          <img
                            src={resonator?.sprite ?? '/assets/default.webp'}
                            alt=""
                            className="overview-resonator-pill-portrait"
                            loading="lazy"
                            decoding="async"
                            onError={onImageError}
                          />
                        </span>
                        <span className="overview-resonator-pill-name">{name}</span>
                        <span className="overview-resonator-pill-meta">
                          <span className="overview-resonator-pill-level">Lv.{resRt.base.level}</span>
                          <span
                              className="overview-resonator-pill-sequence"
                              aria-label={`Sequence ${resRt.base.sequence} of 6`}
                          >
                            {Array.from({ length: 6 }, (_, pip) => (
                                <i key={pip} data-on={pip < resRt.base.sequence ? 'true' : undefined} />
                            ))}
                          </span>
                        </span>
                        {isActive ? <span className="overview-resonator-pill-current" aria-label="Currently active" /> : null}
                      </button>
                    </ContextTrigger>
                  )
                })
              ) : (
                <div className="placeholder">No initialized resonator runtimes.</div>
              )}
            </nav>

            <ContextTrigger
              asChild
              ariaLabel="Overview dashboard actions"
              items={dshbCtxMenuT}
              disabled={dshbCtxMenuT.length === 0}
            >
              <div className="overview-dashboard">
                {selEnt && selRt ? (
                  <div className="overview-dashboard-layout">
              <div className="overview-dashboard-left">
              <div className="overview-mosaic">
                <div className="overview-cell overview-cell--portrait">
                  <div className="overview-portrait-inner">
                    <div className="overview-portrait-details">
                      <span className="overview-portrait-name">{actResName}</span>
                      <span className="overview-portrait-level">Lv.{selRt.base.level ?? 1}</span>
                    </div>
                    <div className="portrait-ops">
                      {selRt?.id !== runtime?.id ? (
                        <button
                          className="team-state-badge overview-badge-button"
                          onClick={() => swtcToRes(selRt?.id)}
                        >
                          Switch
                        </button>
                      ) : null}
                      <button
                        className="team-state-badge overview-badge-button ui-pill-button-danger"
                        onClick={onDltRes}
                      >
                        Delete
                      </button>
                    </div>
                    <div className="overview-portrait-frame">
                      <img
                        key={actRes?.sprite ?? actRes?.profile ?? 'default'}
                        src={actRes?.sprite ?? actRes?.profile ?? '/assets/default.webp'}
                        alt={actResName}
                        className="overview-portrait-img"
                        style={spriteVars(actRes)}
                        loading="lazy"
                        decoding="async"
                        onError={onImageError}
                      />
                    </div>
                    <div className="overview-portrait-badges">
                      <span className="overview-portrait-badge">{isSelResAct ? 'Live' : 'Init'}</span>
                      {totalCV > 0 ? (
                        <span className={`${getCvBdgClss((totalCV - 44)/5)} overview-portrait-badge`}>
                          CV {totalCV.toFixed(1)}
                        </span>
                      ) : null}
                      {buildScore !== null ? (
                        <span className={`${getScrBdgCls(buildScore)} overview-portrait-badge echo-score-badge--build`}>
                          {buildScore.toFixed(1)}%
                        </span>
                      ) : null}
                      {setBuffs.map((entry) => (
                        <span key={`s:${entry.id}`} className="overview-portrait-badge">
                          {entry.icon ? (
                            <img
                              src={entry.icon}
                              alt={entry.name}
                              className="overview-echo-set-icon"
                              loading="lazy"
                              decoding="async"
                              onError={onImageError}
                            />
                          ) : null}
                            {entry.name}
                        </span>
                      ))}
                      <span className="overview-portrait-badge">{`${qppdEchoCnt}/5 Echoes${echoCostSprd ? ` · ${echoCostSprd}` : ''}`}</span>
                    </div>
                  </div>
                </div>

                <div className="overview-cell overview-cell--stats">
                  <span className="overview-cell-label">Combat Stats</span>
                  {vrvwStts ? (
                    <>
                      <div className="overview-main-metrics">
                        {vrvwStts.mainStats.map((stat) => (
                          <div key={stat.label} className="overview-metric-tile">
                            <div className="overview-metric-tile-head">
                              {STATICONMAP[stat.label] ? (
                                <div
                                  className="grid-stat-icon overview"
                                  style={{
                                    '--stat-color': stat.color ?? '#999999',
                                    WebkitMaskImage: `url(${STATICONMAP[stat.label]})`,
                                    maskImage: `url(${STATICONMAP[stat.label]})`,
                                  } as CssProps}
                                />
                              ) : null}
                              <span>{stat.label}</span>
                            </div>
                            <span className="overview-metric-tile-value">{fmtDsplVl(stat.label, stat.total)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="overview-secondary-list">
                        {vrvwStts.secondaryStats.map((stat) => (
                          <div key={stat.label} className="overview-secondary-row">
                            <span className="overview-secondary-label">
                              {STATICONMAP[stat.label] ? (
                                <div
                                  className="grid-stat-icon overview small"
                                  style={{
                                    '--stat-color': stat.color ?? '#999999',
                                    WebkitMaskImage: `url(${STATICONMAP[stat.label]})`,
                                    maskImage: `url(${STATICONMAP[stat.label]})`,
                                  } as CssProps}
                                />
                              ) : null}
                              {stat.label}
                            </span>
                            <span className="overview-secondary-value">{fmtDsplVl(stat.label, stat.total)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="overview-secondary-list">
                        {vrvwStts.dmgMdfrStts.map((stat) => (
                          <div key={stat.label} className="overview-secondary-row">
                            <span
                              className="overview-secondary-label"
                              style={stat.color ? ({ color: stat.color } as CssProps) : undefined}
                            >
                              {STATICONMAP[stat.label] ? (
                                <div
                                  className="grid-stat-icon overview small"
                                  style={{
                                    '--stat-color': stat.color ?? '#999999',
                                    WebkitMaskImage: `url(${STATICONMAP[stat.label]})`,
                                    maskImage: `url(${STATICONMAP[stat.label]})`,
                                  } as CssProps}
                                />
                              ) : null}
                              {stat.label.replace(' DMG Bonus', '')}
                            </span>
                            <span
                              className="overview-secondary-value"
                              style={stat.color ? ({ color: stat.color } as CssProps) : undefined}
                            >
                              {fmtDsplVl(stat.label, stat.total)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="overview-stats-placeholder">No live stat matrix.</div>
                  )}
                </div>

                <div className="overview-cell overview-cell--equip">
                  <span className="overview-cell-label">Equipment & Team</span>
                  <div className="overview-weapon-strip">
                    <div className="overview-weapon-icon-wrap">
                      {weapon?.icon ? (
                        <img
                          src={weapon.icon}
                          alt={weaponName}
                          className="overview-weapon-icon"
                          loading="lazy"
                          decoding="async"
                          onError={onImageError}
                        />
                      ) : wpnVslKey ? (
                        <img
                          src={`/assets/weapons/${wpnVslKey}.webp`}
                          alt={weaponName}
                          className="overview-weapon-icon"
                          loading="lazy"
                          decoding="async"
                          onError={onImageError}
                        />
                      ) : (
                        <div className="overview-weapon-icon overview-weapon-icon--fallback">W</div>
                      )}
                    </div>
                    <div className="overview-weapon-copy">
                      <strong className="overview-weapon-name">{weaponName}</strong>
                      <span className="overview-weapon-meta">
                        Lv.{weaponState?.level ?? 1} · R{weaponState?.rank ?? 1}
                        {weapon ? ` · ${fmtStatKeyLb(weapon.statKey)} ${fmtStatKeyVl(weapon.statKey, weapon.statValue)}` : ''}
                        {' · '}ATK: {weaponState?.baseAtk ? weaponState.baseAtk : weapon?.baseAtk ?? '--'}
                      </span>
                    </div>
                  </div>

                  <div className="overview-team-row">
                    {spprMmbr.map(({ resonator, slotLabel }, index) => (
                      <div key={`${slotLabel}:${resonator?.id ?? index}`} className="overview-team-member">
                        {resonator?.profile ? (
                          <img
                            src={resonator.profile}
                            alt={resonator.name}
                            className="overview-team-avatar"
                            loading="lazy"
                            decoding="async"
                            onError={onImageError}
                          />
                        ) : (
                          <div className="overview-team-avatar overview-team-avatar--empty" />
                        )}
                        <span>{resonator?.name ?? slotLabel}</span>
                      </div>
                    ))}
                  </div>

                  <div className="overview-inline-buffs">
                    {spprWpns.map((entry) => (
                      <span key={`w:${entry.id}`} className="overview-inline-buff">
                        {entry.icon ? (
                          <img src={entry.icon} alt={entry.label} className="overview-inline-buff-icon" loading="lazy" decoding="async" onError={onImageError} />
                        ) : null}
                        {entry.label} {entry.detail}
                      </span>
                    ))}
                    {spprWpns.length === 0 && setBuffs.length === 0 ? (
                      <span className="overview-inline-buff overview-inline-buff--empty">Nothing...</span>
                    ) : null}
                  </div>
                </div>

                <div className="overview-cell overview-cell--rotation">
                  <span className="overview-cell-label">Rotation Damage</span>
                  <div className="overview-rotation-grid-header">
                    <span />
                    <span>Personal</span>
                    <span>Team</span>
                  </div>
                  <div className="overview-rotation-grid-row">
                    <strong className="label">Normal</strong>
                    <span className="value">{fmtCmpcNmbr(persRot?.normal ?? null)}</span>
                    <span className="value">{fmtCmpcNmbr(teamRotation?.normal ?? null)}</span>
                  </div>
                  <div className="overview-rotation-grid-row">
                    <strong className="label">CRIT</strong>
                    <span className="value">{fmtCmpcNmbr(persRot?.crit ?? null)}</span>
                    <span className="value">{fmtCmpcNmbr(teamRotation?.crit ?? null)}</span>
                  </div>
                  <div className="overview-rotation-grid-row overview-rotation-grid-row--avg">
                    <strong className="label">AVG</strong>
                    <span className="value avg">{fmtCmpcNmbr(persRot?.avg ?? null)}</span>
                    <span className="value avg">{fmtCmpcNmbr(teamRotation?.avg ?? null)}</span>
                  </div>
                  <div className="overview-rotation-grid-footer">
                    <span />
                    <span>
                      {getRotFtr(
                        topSkllTyps[0] ? `${topSkllTyps[0].label} · ${selPersRotCn}n` : null,
                        'No rotation',
                      )}
                    </span>
                    <span>
                      {getRotFtr(
                        topCntr[0] ? `${topCntr[0].label} · ${selTeamRotCn}n` : null,
                        'No rotation',
                      )}
                    </span>
                  </div>
                </div>

              </div>

                <div className="overview-cell overview-cell--echoes" {...echoSel.surfaceProps}>
                  {Array.from({ length: 5 }, (_, index) => {
                    const echo = qppdChs[index] ?? null
                    const echoDef = echo?.id ? getEchoById(echo.id) : null
                    const echoCost = echo ? getEchoCostB(echo.id) : 0

                    const setIcon = echo ? getSntSetIco(echo.set) : null
                    const sbstEnts = echo ? Object.entries(echo.substats) : []
                    const echoScore = echo && selEnt && selEntHasEch
                      ? getEchoScrPr(selEnt.id, echo)
                      : null
                    const echoCv = echo ? cmptEchoCrit(echo.substats) : 0
                    const itemId = `overview:${selEnt?.id ?? 'unknown'}:${index}`
                    const selected = echoSel.isSelected(itemId)

                    const tile = (
                      <article
                        key={`echo:${index}`}
                        data-selection-focus-item={echo ? 'true' : undefined}
                        className={`overview-echo-tile${echoSel.selectionMode ? ' selection-mode' : ''}${selected ? ' focus-selected' : ''}`}
                        onClickCapture={echo ? echoSel.buildClickCapture(itemId) : undefined}
                      >
                        {echo ? (
                          <>
                            <div className="overview-echo-tile-head">
                              {echoDef?.icon ? (
                                <img
                                  src={echoDef.icon}
                                  alt={echoDef.name}
                                  className="overview-echo-glyph"
                                  loading="lazy"
                                  decoding="async"
                                  onError={onImageError}
                                />
                              ) : (
                                <div className="overview-echo-glyph" />
                              )}
                              <div className="overview-echo-tile-info">
                                <strong>{echoDef?.name ?? toTitle(echo.id)}</strong>
                                <div className="overview-echo-tile-meta">
                                  {setIcon ? (
                                    <img src={setIcon} alt="" className="overview-echo-set-icon" loading="lazy" onError={onImageError} />
                                  ) : null}
                                  <span className="echo-slot-cost overview-echo-cost">{echoCost}C</span>
                                  {echoScore !== null ? (
                                    <span className={getScrBdgCls(echoScore)}>{echoScore.toFixed(1)}%</span>
                                  ) : null}
                                  {echoCv > 0 ? (
                                    <span className={getCvBdgClss(echoCv)}>CV {echoCv.toFixed(1)}</span>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            <div className="overview-echo-tile-stats">
                              <div className="overview-echo-stat overview-echo-stat--primary">
                                <span className="overview-echo-stat-label">{fmtStatKeyLb(echo.mainStats.primary.key)}</span>
                                <span className="overview-echo-stat-value">{fmtStatKeyVl(echo.mainStats.primary.key, echo.mainStats.primary.value)}</span>
                              </div>
                              <div className="overview-echo-stat overview-echo-stat--secondary">
                                <span className="overview-echo-stat-label">{fmtStatKeyLb(echo.mainStats.secondary.key)}</span>
                                <span className="overview-echo-stat-value">{fmtStatKeyVl(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}</span>
                              </div>
                              {sbstEnts.length > 0 ? (
                                <div className="overview-echo-subs">
                                  {sbstEnts.map(([key, val]) => (
                                    <div key={key} className="overview-echo-stat overview-echo-stat--sub">
                                      <span className="overview-echo-stat-label">{fmtStatKeyLb(key)}</span>
                                      <span className="overview-echo-stat-value">{fmtStatKeyVl(key, val)}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </>
                        ) : (
                          <div className="overview-echo-tile-empty">Empty</div>
                        )}
                      </article>
                    )

                    if (!echo) {
                      return tile
                    }

                    return (
                      <ContextTrigger
                        key={`echo-menu:${index}`}
                        asChild
                        ariaLabel={`${echoDef?.name ?? 'Echo'} actions`}
                        items={echoSrfcMenu.buildReadOnlyMenu({
                          id: itemId,
                          echo,
                          onSelect: () => {
                            echoSel.focusSurface()
                            echoSel.addToSelection(itemId)
                          },
                        })}
                      >
                        {tile}
                      </ContextTrigger>
                    )
                  })}
                </div>

                {statsTree && statsTree.length > 0 ? (
                  <div className="overview-stats-tree">
                    <span className="overview-cell-label">Stat Breakdown</span>
                    <div className="overview-tree-children">
                      {statsTree.map((node) => (
                        <StatsTreeNode key={node.key} node={node} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <section className="calculator-hero-state-summary ui-surface-card ui-surface-card--section" aria-label="Active state sources">
                <div className="calculator-hero-panel-head calculator-hero-state-summary-head">
                  <span className="calculator-hero-stat-label">Active State Sources</span>
                  <div className="calculator-hero-inline-pills">
                    <span className="calculator-hero-pill">
                      {selVrvwSttSm.length} active {selVrvwSttSm.length === 1 ? 'root' : 'roots'}
                    </span>
                    <span className="calculator-hero-pill">{memberCount}/3 linked resonators</span>
                  </div>
                </div>

                <div
                  className={[
                    'calculator-hero-state-layout',
                    actVrvwSttGr && spprVrvwSttG.length > 0
                      ? ''
                      : 'calculator-hero-state-layout--single',
                  ].filter(Boolean).join(' ')}
                >
                  {selVrvwSttSm.length > 0 ? (
                    <>
                      {actVrvwSttGr ? (
                        <div className="calculator-hero-state-column calculator-hero-state-column--active">
                          {viewSttGrp(actVrvwSttGr)}
                        </div>
                      ) : null}
                      {spprVrvwSttG.length > 0 ? (
                        <div className="calculator-hero-state-column calculator-hero-state-column--support">
                          {spprVrvwSttG.map(viewSttGrp)}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <article className="calculator-hero-state-card calculator-hero-state-card--empty">
                      <div className="calculator-hero-state-card-head">
                        <div className="calculator-hero-state-source-copy">
                          <span>Overview</span>
                          <strong>No active state sources</strong>
                        </div>
                      </div>
                      <ul className="calculator-hero-state-effects">
                        <li>
                          No active state sources
                        </li>
                      </ul>
                    </article>
                  )}
                </div>
              </section>
                  </div>
                ) : (
                  <div className="placeholder">No resonator selected.</div>
                )}
              </div>
            </ContextTrigger>
          </div>
        </div>
      </ContextTrigger>

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
