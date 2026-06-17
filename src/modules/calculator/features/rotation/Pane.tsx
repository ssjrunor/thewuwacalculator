/*
  Author: Runor Ewhro
  Description: Renders the pane surface for the calculator rotation flow.
*/

import * as React from 'react'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {
  Copy,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Scissors,
  Trash2,
  ArrowDownNarrowWide as RrwDownNrrwW,
  ArrowUpNarrowWide as RrwUpNrrwWid,
} from 'lucide-react'
import type { RotDef, RotationNode } from '@/domain/gameData/contracts'
import type {ResRuntime, TeamSlots} from '@/domain/entities/runtime'
import type {InvRotEnt} from '@/domain/entities/inventoryStorage'
import { cloneRotNds } from '@/domain/entities/inventoryStorage'
import {useAppStore} from '@/domain/state/store'
import type {SimResult} from '@/engine/pipeline/types'
import {listResRttn} from '@/domain/services/gameDataService'
import {mkMemCntr} from '@/modules/calculator/features/results/lib/utils.ts'
import {seedRsntById} from '@/modules/calculator/features/resonator/lib/seedData.ts'
import {LiquidSelect} from '@/shared/ui/LiquidSelect'
import {AppModal} from '@/shared/ui/AppModal'
import {useAppMdlVl} from '@/shared/ui/useAppModal'
import {MdlClsBttn} from '@/shared/ui/ModalCloseButton'
import {Expandable} from '@/shared/ui/Expandable'
import {CnfrMdl} from '@/shared/ui/ConfirmationModal'
import type {MenuEntry} from '@/shared/ui/CtxMenu.tsx'
import {useCnfr} from '@/app/hooks/useConfirmation.ts'
import {useTstStr} from '@/shared/util/toastStore.ts'
import {bodyPortal, mainPortal} from '@/shared/lib/portalTarget'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { useCtxBuilder } from '@/shared/context-menu/useCtxBuilder.ts'
import {getResonatorSeedById as getResSeedBy} from "@/domain/services/catalogService.ts";
import { mkSqnc } from '@/modules/calculator/features/rotation/lib/sequence.ts'
import { mkWhenNspcRo } from '@/modules/calculator/features/rotation/lib/inspection.ts'
import { CgListTree} from "react-icons/cg";
import {PiDownloadSimpleBold as PiDwnlSmplBo, PiUploadSimpleBold as PiPldSmplBol} from "react-icons/pi";
import {
  cllcRotNdsBy,
  cllcVsblRotN,
  prsRotClpbPa,
  rmRotNds,
  ROT_CLIP_KIND,
  ROT_CLIP_VER,
  serRotClpbPa,
  type RotClpbPay,
} from '@/modules/calculator/features/rotation/lib/helpers.ts'
import {
  canNsrtNodeI,
  cllcAllRotNo,
  findNodeLctn,
  findRotNode,
  nsrtNodeAtTg,
  nsrtRotNode,
  nsrtRotNds,
  moveRotNode,
  rmRotNode,
  trnsGrps,
  updRotNode,
} from '@/modules/calculator/features/rotation/lib/tree.ts'
import { mkRotCondNod } from '@/modules/calculator/features/rotation/lib/conditions.tsx'
import {
  mkRotXprtPay,
  mkSvdRotDtrD,
  dwnlJsonFile,
  fmtSvdRotDur,
  fmtSvdRotNtg,
  getSvdRotDps,
  normMprtRot,
  slgfRotFileN,
} from '@/modules/calculator/features/rotation/lib/savedRotations.ts'
import type {
  BlckPckrStt,
  CondChoice,
  CondDtrStt,
  FeatCondStt,
  FeatMenuStt,
  FeatureMeta,
  LoopDtrStt,
  NegFfctCnfgS,
  RotPanePrps,
  TrnsRslt,
  RotDragArea,
  RotDropTgt,
  EditConfig,
  RotNsrtTgt,
  RotLoadPay,
  RotMemEnt,
  SvdRotDtrDrf,
  SvdRotDtrTgt,
  WhenDtrStt,
} from '@/modules/calculator/features/rotation/lib/types.ts'
import {Block, Condition, Loop, NegFfct, When} from "@/modules/calculator/features/rotation/Modals.tsx";
import {
  MPTYFEATCOND,
  isEntryNode,
  mkBlckNode,
  makeNodeId,
} from "@/modules/calculator/features/rotation/lib/utils.ts";
import {RotSkllMenu} from "@/modules/calculator/features/rotation/RotationSkillMenu.tsx";
import {SavedSummary} from "@/modules/calculator/features/rotation/SavedSummary.tsx";
import {TreeNode} from "@/modules/calculator/features/rotation/TreeNode.tsx";
import {RotDragPrvw} from "@/modules/calculator/features/rotation/NodeDeets.tsx";
import { useSel, type SelAct } from '@/modules/calculator/lib/sel.tsx'
import {
  getRotEditCt,
  getRotSvdIte,
  getRotSvdPan,
} from '@/modules/calculator/features/rotation/lib/ctx.tsx'
import {CtnSqnc} from "@/modules/calculator/features/rotation/ActionSequence.tsx";
import { mkVrvwSttSmm } from '@/modules/calculator/model/stateSummary.ts'
import {
  mkDjcnFeatBy,
  mkVlblRotMmb,
  mkCurTeamMem,
  mkDtblRotMmb,
  mkPrvsFeatBy,
  mkRotCondChc,
  mkRotFeatMet,
} from '@/modules/calculator/features/rotation/lib/setup.ts'
import { nspcResRot } from '@/engine/pipeline'
import type { RotNspcEnt } from '@/engine/rotation/system'
import {
  applyLoopDrf,
  mkRotLoopInf,
  cllcLoopNds,
  mkLoopLblGnr,
  getRotLpsCvr,
  type RotLoopInfo,
} from '@/modules/calculator/features/rotation/lib/loops.ts'
import {
  blckRotTms,
  lpfyRotTms,
  type RotBlckType,
} from '@/modules/calculator/features/rotation/lib/transforms.ts'

// orchestrates the rotation editor surface, its context menus, and the helper dialogs around it.
const ROTSELFCSSCP = 'rotation-pane-selection'

function fltrWrppRotN(items: RotationNode[], nodeIds: ReadonlySet<string>): Set<string> {
  const next = new Set<string>()
  for (const nodeId of nodeIds) {
    // setup branches already live under wrapper nodes, so only keep main-list
    // nodes eligible for loop/block wrapping actions.
    if (findNodeLctn(items, nodeId)?.branch !== 'setup') {
      next.add(nodeId)
    }
  }
  return next
}

function listPresetRotations(resonatorId: string): RotDef[] {
  const seed = seedRsntById[resonatorId]
  const rotations = new Map<string, RotDef>()

  // preset rotations can arrive on either the seed or the game-data registry,
  // depending on which catalog path built the resonator object.
  for (const rotation of seed?.rotations ?? []) {
    rotations.set(rotation.id, rotation)
  }
  for (const rotation of listResRttn(resonatorId)) {
    rotations.set(rotation.id, rotation)
  }

  return Array.from(rotations.values()).filter((rotation) => rotation.items.length > 0)
}

type WhenView = 'edit' | 'loop' | 'states'

function getLoopRunCount(loop: RotLoopInfo): number {
  return Math.max(1, Math.floor(loop.runs ?? 1))
}

function findWhenStateEntry(
  entries: RotNspcEnt[],
  nodeId: string,
  loopId: string | null,
  run: number,
): RotNspcEnt | null {
  const nodeEntries = entries.filter((entry) => entry.nodeId === nodeId && entry.nodeType === 'feature')

  if (!loopId) {
    return nodeEntries.find((entry) => entry.runtimeById) ?? null
  }

  return nodeEntries.find((entry) => entry.loopRuns?.[loopId] === run && entry.runtimeById) ?? null
}

export function Rotation({runtime, runtimesById, simulation, onRtPdt: onRtPdt}: RotPanePrps) {
  const ensTeamMemRt = useAppStore((state) => state.ensTeamRt)
  const loadResProf = useAppStore((state) => state.loadResProf)
  const swtcToRes = useAppStore((state) => state.swRes)
  const updResRt = useAppStore((state) => state.updResRt)
  const invRttn = useAppStore((state) => state.calculator.inventoryRotations)
  const addRotToInv = useAppStore((state) => state.addInvRot)
  const updInvRot = useAppStore((state) => state.updInvRot)
  const rmInvRot = useAppStore((state) => state.rmInvRot)
  const clrInvRttn = useAppStore((state) => state.clrInvRot)
  const enemyProfile = useAppStore((state) => state.calculator.session.enemyProfile)
  const svdRotPrefs = useAppStore((state) => state.ui.savedRotationPreferences)
  const setSvdRotPre = useAppStore((state) => state.setRotPrefs)
  const confirmation = useCnfr()
  const menu = useCtxBuilder()
  const mprtFileNptR = useRef<HTMLInputElement | null>(null)
  const rotClpbCchRe = useRef<RotClpbPay | null>(null)
  const copyRotNdsTo = useRef<(items: RotationNode[]) => Promise<void>>(async () => {})
  const copySvdRotSe = useRef<(entries: InvRotEnt[]) => Promise<void>>(async () => {})
  const cutCurSelRef = useRef<() => Promise<void>>(async () => {})
  const pstClpbIntoR = useRef<(target: RotNsrtTgt) => Promise<void>>(async () => {})
  const pstClpbIntoS = useRef<() => Promise<void>>(async () => {})
  const dltSelLiveNd = useRef<() => void>(() => {})
  const dltSelSvdEnt = useRef<() => void>(() => {})
  const prvsViewRef = useRef(runtime.rotation.view)
  const showToast = useTstStr((s) => s.show)
  const seed = seedRsntById[runtime.id]
  const [collapsedIds, setCllpIds] = useState<Record<string, boolean>>({})
  const featMenuMdl = useAppMdlVl<FeatMenuStt>()
  const condDtrMdl = useAppMdlVl<CondDtrStt>()
  const featCondDtrM = useAppMdlVl<FeatCondStt>()
  const negFfctCnfgM = useAppMdlVl<NegFfctCnfgS>()
  const blckPckrMdl = useAppMdlVl<BlckPckrStt>()
  const loopDtrMdl = useAppMdlVl<LoopDtrStt>()
  const whenDtrMdl = useAppMdlVl<WhenDtrStt>()
  const [whenView, setWhenView] = useState<WhenView>('edit')
  const [whenStateLoopId, setWhenStateLoopId] = useState<string | null>(null)
  const [whenStateRun, setWhenStateRun] = useState(1)
  const ctnListMdl = useAppMdlVl<InvRotEnt>()
  const loadChcMdl = useAppMdlVl<InvRotEnt>()
  const svdRotDtrMdl = useAppMdlVl<SvdRotDtrTgt>()
  const [svdSrchNpt, setSvdSrchNp] = useState(() =>
    svdRotPrefs.autoSearchActiveResonator ? seed.name : '',
  )
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverKey, setDragOverK] = useState<string | null>(null)
  const [dragOverArea, setDragOverA] = useState<RotDragArea | null>(null)
  const [dragPointer, setDragPntr] = useState<{ x: number; y: number } | null>(null)
  const [selPpndSrcId, setSelPpndSr] = useState<string>('')
  const [svdRttnDtrDr, setSvdRttnDt] = useState<SvdRotDtrDrf>(() =>
    mkSvdRotDtrD(null),
  )
  const portalTarget = mainPortal()
  const currentMode = runtime.rotation.view === 'team' ? 'team' : 'personal'
  const showEditor = runtime.rotation.view !== 'saved'
  const savedSortBy = svdRotPrefs.sortBy
  const svdSortRdr = svdRotPrefs.sortOrder
  const svdFltrMode = svdRotPrefs.filterMode
  const auto = svdRotPrefs.autoSearchActiveResonator
  const svdSrchQry = svdSrchNpt

  useEffect(() => {
    setSvdRttnDt(mkSvdRotDtrD(svdRotDtrMdl.value))
  }, [svdRotDtrMdl.value])

  const onXprtRot = useCallback((entry: InvRotEnt) => {
    const payload = mkRotXprtPay(entry)
    const filename = `${slgfRotFileN(entry.name || entry.resonatorName || 'rotation')}.json`
    dwnlJsonFile(filename, payload)

    showToast({
      content: `Exported "${entry.name}"`,
      variant: 'success',
      duration: 2500,
    })
  }, [showToast])

  const onMprtRttn = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown

      let candidates: unknown[] = []

      // imports accept the app's wrapped export shape, a raw array of saved
      // rotations, or a single normalized rotation payload.
      if (
          parsed &&
          typeof parsed === 'object' &&
          'kind' in parsed &&
          (parsed as Record<string, unknown>).kind === 'rotation-export'
      ) {
        const wrapped = parsed as Record<string, unknown>

        if (Array.isArray(wrapped.rotations)) {
          candidates = wrapped.rotations
        } else if ('rotation' in wrapped) {
          candidates = [wrapped.rotation]
        }
      } else if (Array.isArray(parsed)) {
        candidates = parsed
      } else {
        candidates = [parsed]
      }

      const imported = candidates
          .map((entry) => normMprtRot(entry))
          .filter((entry): entry is NonNullable<ReturnType<typeof normMprtRot>> => Boolean(entry))

      if (imported.length === 0) {
        showToast({
          content: 'No valid rotation data found in that file.',
          variant: 'error',
          duration: 3500,
        })
        return
      }

      for (const entry of imported) {
        addRotToInv({ ...entry, resonatorName: entry.resName })
      }

      showToast({
        content: `Imported ${imported.length} rotation${imported.length === 1 ? '' : 's'}.`,
        variant: 'success',
        duration: 3000,
      })
    } catch {
      showToast({
        content: 'Failed to import file. Make sure it is valid JSON.',
        variant: 'error',
        duration: 3500,
      })
    } finally {
      event.target.value = ''
    }
  }, [addRotToInv, showToast])

  const curTeamMemId = useMemo(
    () => mkCurTeamMem(runtime),
    [runtime],
  )

  const resultMap = useMemo(() => {
    const map = new Map<string, SimResult['perSkill']>()

    // several rotation rows can resolve to the same logical node id, so group
    // entries first and let later views decide how to aggregate them.
    for (const entry of simulation?.rotations[currentMode].entries ?? []) {
      const key = entry.nodeId ?? entry.id
      const current = map.get(key) ?? []
      current.push(entry)
      map.set(key, current)
    }

    return map
  }, [currentMode, simulation])

  const visibleMember = useMemo<RotMemEnt[]>(
    () => mkVlblRotMmb(runtime, runtimesById),
    [runtime, runtimesById],
  )

  const dtblMmbr = useMemo(
    () => mkDtblRotMmb(visibleMember, runtime.id, runtime.rotation.view),
    [visibleMember, runtime.id, runtime.rotation.view],
  )

  const featMetaById = useMemo<Record<string, FeatureMeta>>(
    () => mkRotFeatMet(visibleMember),
    [visibleMember],
  )

  const djcnFeatById = useMemo(
    () => mkDjcnFeatBy(visibleMember),
    [visibleMember],
  )

  const prvsFeatById = useMemo(
    () => mkPrvsFeatBy(visibleMember),
    [visibleMember],
  )

  const condChoices = useMemo<CondChoice[]>(
    () => mkRotCondChc(visibleMember, runtime, enemyProfile.id),
    [visibleMember, runtime, enemyProfile.id],
  )

  const writeRotClpb = useCallback(async (payload: RotClpbPay) => {
    const nrmlPay: RotClpbPay = {
      ...payload,
      items: cloneRotNds(payload.items),
      ...(payload.team ? { team: [...payload.team] as TeamSlots } : {}),
      ...(payload.savedEntries
        ? {
            savedEntries: payload.savedEntries.map((entry) => ({
              ...structuredClone(entry),
              items: cloneRotNds(entry.items),
            })),
          }
        : {}),
    }

    rotClpbCchRe.current = nrmlPay

    // keep an in-memory fallback cache so copy/paste still works when browser
    // clipboard permissions fail or are unavailable.
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return true
    }

    try {
      await navigator.clipboard.writeText(serRotClpbPa(nrmlPay))
      return true
    } catch {
      showToast({
        content: 'Clipboard write failed.',
        variant: 'error',
        duration: 3000,
      })
      return false
    }
  }, [showToast])

  const readRotClpb = useCallback(async (): Promise<RotClpbPay | null> => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      return rotClpbCchRe.current ? structuredClone(rotClpbCchRe.current) : null
    }

    try {
      const text = await navigator.clipboard.readText()
      const parsed = prsRotClpbPa(text)
      rotClpbCchRe.current = parsed ? structuredClone(parsed) : null
      return parsed
    } catch {
      return rotClpbCchRe.current ? structuredClone(rotClpbCchRe.current) : null
    }
  }, [])

  const getFeatOwnId = useCallback((node: Extract<RotationNode, { type: 'feature' }>, payload: RotClpbPay) => {
    return node.resonatorId ?? featMetaById[node.featureId]?.resonatorId ?? payload.resonatorId
  }, [featMetaById])

  const trnsClpbNode = useCallback((
    node: RotationNode,
    payload: RotClpbPay,
    targetMode: 'personal' | 'team',
  ): { node: RotationNode | null; skippedCount: number } => {
    if (node.type === 'feature') {
      const ownerId = getFeatOwnId(node, payload)
      if (targetMode === 'personal') {
        // personal rotations can only target the active resonator, so teammate
        // feature nodes from team clips are dropped during paste.
        if (ownerId && ownerId !== runtime.id) {
          return { node: null, skippedCount: 1 }
        }

        return {
          node: {
            ...node,
            resonatorId: runtime.id,
          },
          skippedCount: 0,
        }
      }

      if (ownerId && !curTeamMemId.includes(ownerId)) {
        return { node: null, skippedCount: 1 }
      }

      return {
        node: {
          ...node,
          resonatorId: ownerId,
        },
        skippedCount: 0,
      }
    }

    if (node.type === 'condition') {
      return { node, skippedCount: 0 }
    }

    if (node.type === 'repeat') {
      const trnsTms = node.items.reduce<TrnsRslt>((result, child) => {
        const transformed = trnsClpbNode(child, payload, targetMode)
        if (transformed.node) {
          result.items.push(transformed.node)
        }
        result.skippedCount += transformed.skippedCount
        return result
      }, { items: [], skippedCount: 0 })

      return {
        node: {
          ...node,
          items: trnsTms.items,
        },
        skippedCount: trnsTms.skippedCount,
      }
    }

    if (node.type === 'loop') {
      return { node, skippedCount: 0 }
    }

    const trnsStp = (node.setup ?? []).reduce<TrnsRslt>((result, child) => {
      const transformed = trnsClpbNode(child, payload, targetMode)
      if (transformed.node?.type === 'condition') {
        result.items.push(transformed.node)
      } else if (transformed.node) {
        result.skippedCount += 1
      }
      result.skippedCount += transformed.skippedCount
      return result
    }, { items: [], skippedCount: 0 })
    const trnsTms = node.items.reduce<TrnsRslt>((result, child) => {
      const transformed = trnsClpbNode(child, payload, targetMode)
      if (transformed.node) {
        result.items.push(transformed.node)
      }
      result.skippedCount += transformed.skippedCount
      return result
    }, { items: [], skippedCount: 0 })

    return {
      node: {
        ...node,
        setup: trnsStp.items,
        items: trnsTms.items,
      },
      skippedCount: trnsStp.skippedCount + trnsTms.skippedCount,
    }
  }, [curTeamMemId, getFeatOwnId, runtime.id])

  const trnsClpbPayF = useCallback((
    payload: RotClpbPay,
    target: RotNsrtTgt,
    targetMode: 'personal' | 'team',
  ): TrnsRslt => {
    // transform before insertion checks so copied team nodes are first rebound
    // to the current team and then filtered against the destination branch rules.
    const transformed = payload.items.reduce<TrnsRslt>((result, node) => {
      const next = trnsClpbNode(node, payload, targetMode)
      if (next.node && canNsrtNodeI(next.node, target.branch)) {
        result.items.push(next.node)
      } else if (next.node) {
        result.skippedCount += 1
      }
      result.skippedCount += next.skippedCount
      return result
    }, { items: [], skippedCount: 0 })

    return {
      items: cloneRotNds(transformed.items, { freshIds: true }),
      skippedCount: transformed.skippedCount,
    }
  }, [trnsClpbNode])

  const showPstRsltT = useCallback((items: RotationNode[], skippedCount: number) => {
    if (items.length === 0) {
      showToast({
        content: skippedCount > 0
          ? 'Nothing valid to paste here.'
          : 'Clipboard does not contain a rotation item.',
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    if (skippedCount > 0) {
      showToast({
        content: `Pasted ${items.length} item${items.length === 1 ? '' : 's'} and skipped ${skippedCount}.`,
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    showToast({
      content: `Pasted ${items.length} item${items.length === 1 ? '' : 's'}.`,
      variant: 'success',
      duration: 2200,
    })
  }, [showToast])

  const canPstIntoTg = useCallback((target: RotNsrtTgt) => {
    const payload = rotClpbCchRe.current
    if (!payload) {
      return true
    }

    // menu disabled state uses the cached payload only; the actual paste still
    // re-reads clipboard text so the final operation can use newer external data.
    return trnsClpbPayF(payload, target, currentMode).items.length > 0
  }, [currentMode, trnsClpbPayF])

  const svdRotEnts = useMemo(() => {
    const query = svdSrchQry.trim().toLowerCase()
    // filter before sorting so saved rotation selection order mirrors the
    // visible list, not the underlying inventory order.
    const filtered = invRttn.filter((entry) => {
      if (svdFltrMode !== 'all' && entry.mode !== svdFltrMode) return false
      return !(query && !entry.name.toLowerCase().includes(query) && !entry.resonatorName.toLowerCase().includes(query));

    })
    filtered.sort((a, b) => {
      let cmp = 0
      switch (savedSortBy) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'avg':
          cmp = (a.summary?.total.avg ?? 0) - (b.summary?.total.avg ?? 0)
          break
        case 'dps': {
          const aDps = getSvdRotDps(a)
          const bDps = getSvdRotDps(b)
          if (aDps != null && bDps == null) {
            return -1
          }
          if (aDps == null && bDps != null) {
            return 1
          }
          cmp = (aDps ?? 0) - (bDps ?? 0)
          break
        }
        case 'date':
        default:
          cmp = a.updatedAt - b.updatedAt
          break
      }
      return svdSortRdr === 'desc' ? -cmp : cmp
    })
    return filtered
  }, [invRttn, savedSortBy, svdSortRdr, svdFltrMode, svdSrchQry])
  const vsblSvdEntId = useMemo(
    () => svdRotEnts.map((entry) => entry.id),
    [svdRotEnts],
  )
  const lgblSvdPersR = useMemo(
    () =>
      invRttn.filter(
        (entry) => entry.mode === 'personal' && curTeamMemId.includes(entry.resonatorId),
      ),
    [curTeamMemId, invRttn],
  )

  const ppndSrcPtns = useMemo(() => {
    const options: Array<{ value: string; label: string; items: RotationNode[] }> = []

    if (runtime.rotation.personalItems.length > 0) {
      options.push({
        value: `live:${runtime.id}`,
        label: `${seed.name} · Current Personal Rotation · Live`,
        items: runtime.rotation.personalItems,
      })
    }

    // team append should not require teammates to be saved first; their
    // authored presets are valid sources alongside live and saved rotations.
    for (const resonatorId of curTeamMemId) {
      const memberSeed = seedRsntById[resonatorId]
      if (!memberSeed) {
        continue
      }

      for (const rotation of listPresetRotations(resonatorId)) {
        options.push({
          value: `preset:${resonatorId}:${rotation.id}`,
          label: `${memberSeed.name} · ${rotation.label} · Preset`,
          items: rotation.items,
        })
      }
    }

    for (const entry of lgblSvdPersR) {
      options.push({
        value: `saved:${entry.id}`,
        label: `${entry.resonatorName} · ${entry.name} · Personal`,
        items: entry.items,
      })
    }

    return options
  }, [curTeamMemId, lgblSvdPersR, runtime.id, runtime.rotation.personalItems, seed.name])

  const rslvPpndSrcI = useMemo(() => {
    if (ppndSrcPtns.some((entry) => entry.value === selPpndSrcId)) {
      return selPpndSrcId
    }

    return ppndSrcPtns[0]?.value ?? ''
  }, [ppndSrcPtns, selPpndSrcId])

  const currentItems = currentMode === 'team' ? runtime.rotation.teamItems : runtime.rotation.personalItems
  const loopAnalysis = useMemo(
    () => mkRotLoopInf(currentItems, simulation?.rotations[currentMode].entries ?? []),
    [currentItems, currentMode, simulation],
  )
  const loopLabelById = useMemo(
    () => new Map(loopAnalysis.loops.map((loop) => [loop.loopId, loop.label])),
    [loopAnalysis.loops],
  )
  const curLiveNodeI = useMemo(
    () => cllcAllRotNo(currentItems),
    [currentItems],
  )
  const vsblLiveNode = useMemo(
    () => cllcVsblRotN(currentItems, collapsedIds),
    [collapsedIds, currentItems],
  )
  const liveNdsById = useMemo(
    () => cllcRotNdsBy(currentItems),
    [currentItems],
  )
  const liveSelTms = useMemo(
    () => vsblLiveNode
      .map((nodeId) => {
        const node = liveNdsById.get(nodeId)
        return node ? { id: nodeId, val: node } : null
      })
      .filter((item): item is { id: string; val: RotationNode } => Boolean(item)),
    [liveNdsById, vsblLiveNode],
  )
  const liveSelCtns = useMemo<Array<SelAct<string, RotationNode>>>(() => [
    {
      id: 'rot-live:copy',
      key: 'copy',
      needsSel: true,
      icon: <Copy size={14} />,
      label: ({ count }) => `Copy (${count})`,
      title: 'Copy selection (Ctrl/Cmd+C)',
      run: async ({ vals }) => {
        await copyRotNdsTo.current(vals)
      },
    },
    {
      id: 'rot-live:cut',
      key: 'cut',
      needsSel: true,
      icon: <Scissors size={14} />,
      label: ({ count }) => `Cut (${count})`,
      title: 'Cut selection (Ctrl/Cmd+X)',
      run: async () => {
        await cutCurSelRef.current()
      },
    },
    {
      id: 'rot-live:paste',
      key: 'paste',
      label: 'Paste',
      title: 'Paste selection (Ctrl/Cmd+V)',
      float: false,
      run: async () => {
        await pstClpbIntoR.current({ parentId: null, branch: 'root' })
      },
    },
    {
      id: 'rot-live:del',
      key: 'delete',
      needsSel: true,
      danger: true,
      icon: <Trash2 size={14} />,
      label: ({ count }) => `Delete (${count})`,
      title: 'Delete selection (Delete / Backspace)',
      run: () => {
        dltSelLiveNd.current()
      },
    },
  ], [])
  const liveSel = useSel({
    active: showEditor,
    surfaceId: ROTSELFCSSCP,
    ariaLabel: 'Rotation selection actions',
    items: liveSelTms,
    ord: vsblLiveNode,
    av: curLiveNodeI,
    acts: liveSelCtns,
  })
  const svdSelTms = useMemo(
    () => svdRotEnts.map((entry) => ({
      id: entry.id,
      val: entry,
    })),
    [svdRotEnts],
  )
  const svdSelCtns = useMemo<Array<SelAct<string, InvRotEnt>>>(() => [
    {
      id: 'rot-saved:copy',
      key: 'copy',
      needsSel: true,
      icon: <Copy size={14} />,
      label: ({ count }) => `Copy (${count})`,
      title: 'Copy selection (Ctrl/Cmd+C)',
      run: async ({ vals }) => {
        await copySvdRotSe.current(vals)
      },
    },
    {
      id: 'rot-saved:cut',
      key: 'cut',
      needsSel: true,
      icon: <Scissors size={14} />,
      label: ({ count }) => `Cut (${count})`,
      title: 'Cut selection (Ctrl/Cmd+X)',
      run: async () => {
        await cutCurSelRef.current()
      },
    },
    {
      id: 'rot-saved:paste',
      key: 'paste',
      label: 'Paste',
      title: 'Paste selection (Ctrl/Cmd+V)',
      float: false,
      run: async () => {
        await pstClpbIntoS.current()
      },
    },
    {
      id: 'rot-saved:del',
      key: 'delete',
      needsSel: true,
      danger: true,
      icon: <Trash2 size={14} />,
      label: ({ count }) => `Delete (${count})`,
      title: 'Delete selection (Delete / Backspace)',
      run: () => {
        dltSelSvdEnt.current()
      },
    },
  ], [])
  const svdSel = useSel({
    active: !showEditor,
    surfaceId: ROTSELFCSSCP,
    ariaLabel: 'Saved rotation selection actions',
    items: svdSelTms,
    ord: vsblSvdEntId,
    acts: svdSelCtns,
  })
  const actSel = showEditor ? liveSel : svdSel
  const selMode = actSel.selectionMode
  const selLiveNodeI = liveSel.selectedIdSet
  const selSvdEntIds = svdSel.selectedIdSet
  const hasPndnSel = actSel.hasSelection
  const selLiveNds = liveSel.selectedVals
  const selSvdEnts = svdSel.selectedVals
  const draggedNode = useMemo(
    () => (draggedId ? findRotNode(currentItems, draggedId) : null),
    [currentItems, draggedId],
  )
  const dtdFeatNode = featMenuMdl.value?.nodeId
    ? (() => {
        const found = findRotNode(currentItems, featMenuMdl.value.nodeId)
        return found?.type === 'feature' ? found : null
      })()
    : null

  const dtdCondNode = condDtrMdl.value?.nodeId
    ? (() => {
        const found = findRotNode(currentItems, condDtrMdl.value.nodeId)
        return found?.type === 'condition' ? found : null
      })()
    : null
  const dtdFeatCondN = featCondDtrM.value?.nodeId
    ? (() => {
        const found = findRotNode(currentItems, featCondDtrM.value.nodeId)
        return found?.type === 'feature' ? found : null
      })()
    : null
  const dtdWhenNode = whenDtrMdl.value?.nodeId
    ? findRotNode(currentItems, whenDtrMdl.value.nodeId)
    : null
  const dtdWhenLps = useMemo(
    () => getRotLpsCvr(currentItems, whenDtrMdl.value?.nodeId, loopAnalysis.loops),
    [currentItems, loopAnalysis.loops, whenDtrMdl.value?.nodeId],
  )
  const handleWhenViewChange = useCallback((view: WhenView) => {
    setWhenView(view)
  }, [])

  useEffect(() => {
    if (!whenDtrMdl.visible) {
      setWhenView('edit')
      setWhenStateLoopId(null)
      setWhenStateRun(1)
      return
    }

    if (whenView !== 'states') {
      return
    }

    const firstLoop = dtdWhenLps[0] ?? null
    if (!firstLoop) {
      setWhenStateLoopId(null)
      setWhenStateRun(1)
      return
    }

    const selectedLoop = dtdWhenLps.find((loop) => loop.loopId === whenStateLoopId) ?? null
    if (!selectedLoop) {
      setWhenStateLoopId(firstLoop.loopId)
      setWhenStateRun(1)
      return
    }

    if (whenStateRun < 1 || whenStateRun > getLoopRunCount(selectedLoop)) {
      setWhenStateRun(1)
    }
  }, [dtdWhenLps, whenDtrMdl.visible, whenStateLoopId, whenStateRun, whenView])

  const whenInspectionEntries = useMemo(() => {
    if (!whenDtrMdl.visible || !seed || !dtdWhenNode || (whenView !== 'loop' && whenView !== 'states')) {
      return []
    }

    const inspection = nspcResRot(runtime, seed, enemyProfile, runtimesById)
    return inspection.rotations[currentMode].entries
  }, [
    currentMode,
    dtdWhenNode,
    enemyProfile,
    runtime,
    runtimesById,
    seed,
    whenDtrMdl.visible,
    whenView,
  ])
  const whenNspcRows = useMemo(() => {
    if (!whenDtrMdl.visible || !dtdWhenNode || whenView !== 'loop') {
      return []
    }

    return mkWhenNspcRo({
      items: currentItems,
      node: dtdWhenNode,
      allLoops: loopAnalysis.loops,
      traces: whenInspectionEntries,
      choices: condChoices,
    })
  }, [
    condChoices,
    currentItems,
    dtdWhenNode,
    loopAnalysis.loops,
    whenInspectionEntries,
    whenDtrMdl.visible,
    whenView,
  ])
  const whenStateGroups = useMemo(() => {
    if (!whenDtrMdl.visible || whenView !== 'states' || !dtdWhenNode || dtdWhenNode.type !== 'feature') {
      return []
    }

    const meta = featMetaById[dtdWhenNode.featureId]
    const memberId = dtdWhenNode.resonatorId ?? meta?.resonatorId ?? runtime.id
    const member = visibleMember.find((entry) => entry.id === memberId)
    const skillId = meta?.skillId ?? member?.features.find((feature) => feature.id === dtdWhenNode.featureId)?.skillId
    const skill = skillId ? member?.skills.find((entry) => entry.id === skillId) : null
    if (!member || !skill) {
      return []
    }

    const selectedLoop = dtdWhenLps.find((loop) => loop.loopId === whenStateLoopId) ?? dtdWhenLps[0] ?? null
    const selectedRun = selectedLoop ? Math.min(Math.max(1, whenStateRun), getLoopRunCount(selectedLoop)) : 1
    const stateEntry = findWhenStateEntry(
      whenInspectionEntries,
      dtdWhenNode.id,
      selectedLoop?.loopId ?? null,
      selectedRun,
    )
    if (selectedLoop && !stateEntry) {
      return []
    }

    const snapshotRuntimes = stateEntry?.runtimeById ?? runtimesById
    const snapshotEnemy = stateEntry?.enemy ?? enemyProfile
    const teamIds = mkCurTeamMem(runtime)
      .filter((id) => id !== member.id)
      .slice(0, 3)
    const baseRuntime = snapshotRuntimes[member.id] ?? member.runtime
    const targetRuntime: ResRuntime = member.id === runtime.id
      ? snapshotRuntimes[runtime.id] ?? runtime
      : {
        ...baseRuntime,
        build: {
          ...baseRuntime.build,
          team: [
            teamIds[0] ?? null,
            teamIds[1] ?? null,
            teamIds[2] ?? null,
          ],
        },
      }
    const activeResonatorId = stateEntry?.activeResonatorId ?? runtime.id
    const activeRuntime =
      snapshotRuntimes[activeResonatorId]
      ?? (activeResonatorId === runtime.id ? runtime : runtimesById[activeResonatorId])
      ?? targetRuntime

    return mkVrvwSttSmm(
      targetRuntime,
      {
        ...runtimesById,
        ...snapshotRuntimes,
        [runtime.id]: snapshotRuntimes[runtime.id] ?? runtime,
        [activeRuntime.id]: activeRuntime,
        [targetRuntime.id]: targetRuntime,
      },
      null,
      stateEntry?.selectedTargetsByRuntimeId?.[targetRuntime.id] ?? null,
      {
        enemyProfile: snapshotEnemy,
        activeRuntime,
        skillTarget: {
          resonatorId: member.id,
          skill,
        },
      },
    )
  }, [
    dtdWhenNode,
    dtdWhenLps,
    enemyProfile,
    featMetaById,
    runtime,
    runtimesById,
    visibleMember,
    whenInspectionEntries,
    whenStateLoopId,
    whenStateRun,
    whenDtrMdl.visible,
    whenView,
  ])

  const dtdNegFfctFe = negFfctCnfgM.value?.nodeId
    ? (() => {
        const found = findRotNode(currentItems, negFfctCnfgM.value.nodeId)
        return found?.type === 'feature' ? found : null
      })()
    : null
  const dtdNegFfctMe = dtdNegFfctFe
    ? featMetaById[dtdNegFfctFe.featureId]
    : undefined

  const clrDragStt = useCallback(() => {
    setDraggedId(null)
    setDragOverK(null)
    setDragOverA(null)
    setDragPntr(null)
  }, [])

  const clrAllSel = useCallback(() => {
    liveSel.exitSelectionMode()
    svdSel.exitSelectionMode()
  }, [liveSel, svdSel])

  const exitSelMode = useCallback(() => {
    clrAllSel()
    clrDragStt()
  }, [clrAllSel, clrDragStt])

  useEffect(() => {
    const currentView = runtime.rotation.view
    if (prvsViewRef.current === currentView) {
      return
    }

    prvsViewRef.current = currentView
    exitSelMode()
  }, [exitSelMode, runtime.rotation.view])

  const ntrPaneSelMo = useCallback(() => {
    clrDragStt()

    if (showEditor) {
      liveSel.enterSelectionMode()
      return
    }

    svdSel.enterSelectionMode()
  }, [clrDragStt, liveSel, svdSel, showEditor])

  const addLiveNodeT = useCallback((nodeId: string) => {
    clrDragStt()
    liveSel.addToSelection(nodeId)
  }, [clrDragStt, liveSel])

  const addSvdEntToS = useCallback((entryId: string) => {
    clrDragStt()
    svdSel.addToSelection(entryId)
  }, [clrDragStt, svdSel])

  const addLiveNodeS = useCallback((nodeId: string) => {
    clrDragStt()
    liveSel.addRangeToSelection(nodeId)
  }, [clrDragStt, liveSel])

  const tglLiveNodeS = liveSel.toggleSelection

  const setRotView = useCallback((view: ResRuntime['rotation']['view']) => {
    onRtPdt((prev) => ({
      ...prev,
      rotation: {
        ...prev.rotation,
        view,
      },
    }))
  }, [onRtPdt])

  const updCurTms = useCallback((updater: (items: RotationNode[]) => RotationNode[]) => {
    onRtPdt((prev) => ({
      ...prev,
      rotation: {
        ...prev.rotation,
        ...(prev.rotation.view === 'team'
          ? { teamItems: updater(prev.rotation.teamItems) }
          : { personalItems: updater(prev.rotation.personalItems) }),
      },
    }))
  }, [onRtPdt])

  const updCurNode = useCallback((nodeId: string, updater: (node: RotationNode) => RotationNode) => {
    updCurTms((items) => updRotNode(items, nodeId, updater))
  }, [updCurTms])

  const dltCurNode = useCallback((nodeId: string) => {
    updCurTms((items) => rmRotNode(items, nodeId))
  }, [updCurTms])

  const lpfyCurRot = useCallback(() => {
    updCurTms((items) => {
      const nextLoopLbl = mkLoopLblGnr(items)
      return lpfyRotTms(items, { label: nextLoopLbl() })
    })
  }, [updCurTms])

  const lpfyCurNodeG = useCallback((nodeIds: ReadonlySet<string>) => {
    if (nodeIds.size === 0) {
      return
    }

    updCurTms((items) => {
      const wrappableIds = fltrWrppRotN(items, nodeIds)
      if (wrappableIds.size === 0) {
        return items
      }

      const nextLoopLbl = mkLoopLblGnr(items)
      return trnsGrps(items, wrappableIds, (nodes) => (
        lpfyRotTms(nodes, { label: nextLoopLbl() })
      ))
    })
  }, [updCurTms])

  const blckCurNodeG = useCallback((nodeIds: ReadonlySet<string>, type: RotBlckType) => {
    if (nodeIds.size === 0) {
      return
    }

    updCurTms((items) => {
      const wrappableIds = fltrWrppRotN(items, nodeIds)
      if (wrappableIds.size === 0) {
        return items
      }

      return trnsGrps(items, wrappableIds, (nodes) => (
        blckRotTms(nodes, type)
      ))
    })
  }, [updCurTms])

  const lpfyCurNode = useCallback((nodeId: string) => {
    const targetIds = selMode && selLiveNodeI.has(nodeId)
      ? selLiveNodeI
      : new Set([nodeId])
    lpfyCurNodeG(targetIds)
  }, [lpfyCurNodeG, selLiveNodeI, selMode])

  const blckCurNode = useCallback((nodeId: string, type: RotBlckType) => {
    const targetIds = selMode && selLiveNodeI.has(nodeId)
      ? selLiveNodeI
      : new Set([nodeId])
    blckCurNodeG(targetIds, type)
  }, [blckCurNodeG, selLiveNodeI, selMode])

  const nsrtCurNode = useCallback((target: RotNsrtTgt, node: RotationNode) => {
    updCurTms((items) => nsrtRotNode(items, target, node))
  }, [updCurTms])

  const nsrtCurNds = useCallback((target: RotNsrtTgt, nodes: RotationNode[]) => {
    updCurTms((items) => nsrtRotNds(items, target, nodes))
  }, [updCurTms])

  const mkLiveClpbPa = useCallback((items: RotationNode[]): RotClpbPay => ({
    kind: ROT_CLIP_KIND,
    version: ROT_CLIP_VER,
    source: currentMode,
    mode: currentMode,
    resonatorId: runtime.id,
    resName: seed.name,
    ...(currentMode === 'team' ? { team: [...runtime.build.team] as TeamSlots } : {}),
    items: cloneRotNds(items),
  }), [currentMode, runtime.build.team, runtime.id, seed.name])

  const mkSvdClpbPay = useCallback((entries: InvRotEnt[]): RotClpbPay => ({
    kind: ROT_CLIP_KIND,
    version: ROT_CLIP_VER,
    source: 'saved',
    mode: entries[0]?.mode ?? 'personal',
    resonatorId: entries[0]?.resonatorId ?? runtime.id,
    resName: entries[0]?.resonatorName ?? seed.name,
    ...(entries[0]?.team ? { team: [...entries[0].team] as TeamSlots } : {}),
    items: cloneRotNds(entries.flatMap((entry) => entry.items)),
    ...(entries[0]
      ? {
          name: entries[0].name,
          duration: entries[0].duration,
          note: entries[0].note,
        }
      : {}),
    savedEntries: entries.map((entry) => ({
      ...structuredClone(entry),
      items: cloneRotNds(entry.items),
    })),
  }), [runtime.id, seed.name])

  const copyRotNdsul = useCallback(async (items: RotationNode[]) => {
    if (items.length === 0) {
      showToast({
        content: 'Nothing to copy yet.',
        variant: 'warning',
        duration: 2600,
      })
      return
    }

    const wrote = await writeRotClpb(mkLiveClpbPa(items))
    if (wrote) {
      showToast({
        content: `Copied ${items.length} item${items.length === 1 ? '' : 's'}.`,
        variant: 'success',
        duration: 2200,
      })
    }
  }, [mkLiveClpbPa, showToast, writeRotClpb])

  const copySvdRotgg = useCallback(async (entries: InvRotEnt[]) => {
    if (entries.length === 0) {
      return
    }

    const wrote = await writeRotClpb(mkSvdClpbPay(entries))
    if (wrote) {
      showToast({
        content:
          entries.length === 1
            ? `Copied "${entries[0].name}".`
            : `Copied ${entries.length} saved rotations.`,
        variant: 'success',
        duration: 2200,
      })
    }
  }, [mkSvdClpbPay, showToast, writeRotClpb])

  const copySvdRotTo = useCallback(async (entry: InvRotEnt) => {
    await copySvdRotgg([entry])
  }, [copySvdRotgg])

  const openSvdRotDr = useCallback((payload: RotClpbPay, items: RotationNode[]) => {
    svdRotDtrMdl.show({
      kind: 'create',
      rotation: {
        name: payload.name ?? `${payload.resName} Rotation`,
        mode: payload.mode,
        resonatorId: payload.resonatorId,
        resName: payload.resName,
        ...(payload.mode === 'team' && payload.team ? { team: [...payload.team] as TeamSlots } : {}),
        items,
      },
    })
  }, [svdRotDtrMdl])

  const openSavedRot = useCallback((entry: InvRotEnt) => {
    svdRotDtrMdl.show({
      kind: 'create',
      rotation: {
        name: entry.name,
        mode: entry.mode,
        resonatorId: entry.resonatorId,
        resName: entry.resonatorName,
        duration: entry.duration,
        note: entry.note,
        ...(entry.team ? { team: [...entry.team] as TeamSlots } : {}),
        items: cloneRotNds(entry.items),
        ...(entry.snapshot ? { snapshot: structuredClone(entry.snapshot) } : {}),
        ...(entry.summary ? { summary: structuredClone(entry.summary) } : {}),
      },
    })
  }, [svdRotDtrMdl])

  const dplcSvdRotEn = useCallback((entries: InvRotEnt[]) => {
    for (const entry of entries) {
      addRotToInv({
        name: entry.name,
        mode: entry.mode,
        resonatorId: entry.resonatorId,
        resonatorName: entry.resonatorName,
        duration: entry.duration,
        note: entry.note,
        ...(entry.team ? { team: [...entry.team] as TeamSlots } : {}),
        items: cloneRotNds(entry.items),
        ...(entry.snapshot ? { snapshot: structuredClone(entry.snapshot) } : {}),
        ...(entry.summary ? { summary: structuredClone(entry.summary) } : {}),
      })
    }
  }, [addRotToInv])

  const pasteClipboard = useCallback(async (target: RotNsrtTgt) => {
    const payload = await readRotClpb()
    if (!payload) {
      showToast({
        content: 'Clipboard does not contain a rotation item.',
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    const result = trnsClpbPayF(payload, target, currentMode)
    if (result.items.length > 0) {
      nsrtCurNds(target, result.items)
    }
    showPstRsltT(result.items, result.skippedCount)
  }, [currentMode, nsrtCurNds, readRotClpb, showPstRsltT, showToast, trnsClpbPayF])

  const pstClpbIntsf = useCallback(async () => {
    const payload = await readRotClpb()
    if (!payload) {
      showToast({
        content: 'Clipboard does not contain a rotation item.',
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    if (payload.source === 'saved' && payload.savedEntries?.length) {
      if (payload.savedEntries.length === 1) {
        openSavedRot(payload.savedEntries[0])
        showToast({
          content: `Pasted "${payload.savedEntries[0].name}" into a new saved rotation draft.`,
          variant: 'success',
          duration: 2200,
        })
        return
      }

      dplcSvdRotEn(payload.savedEntries)
      showToast({
        content: `Pasted ${payload.savedEntries.length} saved rotations.`,
        variant: 'success',
        duration: 2600,
      })
      return
    }

    const result = trnsClpbPayF(payload, { parentId: null, branch: 'root' }, payload.mode)
    if (result.items.length === 0) {
      showPstRsltT(result.items, result.skippedCount)
      return
    }

    openSvdRotDr(payload, result.items)
    showPstRsltT(result.items, result.skippedCount)
  }, [
    dplcSvdRotEn,
    openSvdRotDr,
    openSavedRot,
    readRotClpb,
    showPstRsltT,
    showToast,
    trnsClpbPayF,
  ])

  const cutRotNodeTo = useCallback(async (node: RotationNode) => {
    const wrote = await writeRotClpb(mkLiveClpbPa([node]))
    if (!wrote) {
      return
    }

    dltCurNode(node.id)
    showToast({
      content: 'Cut 1 item.',
      variant: 'success',
      duration: 2200,
    })
  }, [mkLiveClpbPa, dltCurNode, showToast, writeRotClpb])

  const copyLiveNode = useCallback(async (node: RotationNode) => {
    if (selMode && selLiveNodeI.has(node.id) && selLiveNds.length > 0) {
      await copyRotNdsul(selLiveNds)
      return
    }

    await copyRotNdsul([node])
  }, [copyRotNdsul, selLiveNodeI, selLiveNds, selMode])

  const cutLiveNodeS = useCallback(async (node: RotationNode) => {
    if (selMode && selLiveNodeI.has(node.id) && selLiveNds.length > 0) {
      const wrote = await writeRotClpb(mkLiveClpbPa(selLiveNds))
      if (!wrote) {
        return
      }

      updCurTms((items) => rmRotNds(items, selLiveNodeI))
      exitSelMode()
      showToast({
        content: `Cut ${selLiveNds.length} item${selLiveNds.length === 1 ? '' : 's'}.`,
        variant: 'success',
        duration: 2200,
      })
      return
    }

    await cutRotNodeTo(node)
  }, [
    mkLiveClpbPa,
    cutRotNodeTo,
    exitSelMode,
    selLiveNodeI,
    selLiveNds,
    selMode,
    showToast,
    updCurTms,
    writeRotClpb,
  ])

  const cutSvdRotToC = useCallback(async (entry: InvRotEnt) => {
    const wrote = await writeRotClpb(mkSvdClpbPay([entry]))
    if (!wrote) {
      return
    }

    confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message: `Delete "${entry.name}" from your saved rotations?`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => {
        rmInvRot(entry.id)
        showToast({
          content: `Cut "${entry.name}".`,
          variant: 'success',
          duration: 2200,
        })
      },
    })
  }, [mkSvdClpbPay, confirmation, rmInvRot, showToast, writeRotClpb])

  const dltSelLiveag = useCallback(() => {
    if (selLiveNodeI.size === 0) {
      return
    }

    updCurTms((items) => rmRotNds(items, selLiveNodeI))
    exitSelMode()
  }, [exitSelMode, selLiveNodeI, updCurTms])

  const dltSelSvdEfo = useCallback(() => {
    if (selSvdEnts.length === 0) {
      return
    }

    const selCnt = selSvdEnts.length
    confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message:
        selCnt === 1
          ? `Delete "${selSvdEnts[0].name}" from your saved rotations?`
          : `Delete ${selCnt} saved rotations? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => {
        for (const entry of selSvdEnts) {
          rmInvRot(entry.id)
        }

        exitSelMode()
      },
    })
  }, [confirmation, exitSelMode, rmInvRot, selSvdEnts])

  const copyCurSel = useCallback(async () => {
    if (!hasPndnSel) {
      return
    }

    if (showEditor) {
      await copyRotNdsul(selLiveNds)
      return
    }

    if (selSvdEnts.length === 0) {
      return
    }

    const wrote = await writeRotClpb(mkSvdClpbPay(selSvdEnts))
    if (wrote) {
      showToast({
        content:
          selSvdEnts.length === 1
            ? `Copied "${selSvdEnts[0].name}".`
            : `Copied ${selSvdEnts.length} saved rotations.`,
        variant: 'success',
        duration: 2200,
      })
    }
  }, [
    mkSvdClpbPay,
    copyRotNdsul,
    hasPndnSel,
    selLiveNds,
    selSvdEnts,
    showEditor,
    showToast,
    writeRotClpb,
  ])

  const cutCurSel = useCallback(async () => {
    if (!hasPndnSel) {
      return
    }

    if (showEditor) {
      const wrote = await writeRotClpb(mkLiveClpbPa(selLiveNds))
      if (!wrote) {
        return
      }

      updCurTms((items) => rmRotNds(items, selLiveNodeI))
      exitSelMode()
      showToast({
        content: `Cut ${selLiveNds.length} item${selLiveNds.length === 1 ? '' : 's'}.`,
        variant: 'success',
        duration: 2200,
      })
      return
    }

    if (selSvdEnts.length === 0) {
      return
    }

    const wrote = await writeRotClpb(mkSvdClpbPay(selSvdEnts))
    if (!wrote) {
      return
    }

    const selCnt = selSvdEnts.length
    confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message:
        selCnt === 1
          ? `Delete "${selSvdEnts[0].name}" from your saved rotations?`
          : `Delete ${selCnt} saved rotations?`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => {
        for (const entry of selSvdEnts) {
          rmInvRot(entry.id)
        }

        exitSelMode()
        showToast({
          content:
            selCnt === 1
              ? `Cut "${selSvdEnts[0].name}".`
              : `Cut ${selCnt} saved rotations.`,
          variant: 'success',
          duration: 2200,
        })
      },
    })
  }, [
    mkLiveClpbPa,
    mkSvdClpbPay,
    confirmation,
    exitSelMode,
    hasPndnSel,
    rmInvRot,
    selLiveNodeI,
    selLiveNds,
    selSvdEnts,
    showEditor,
    showToast,
    updCurTms,
    writeRotClpb,
  ])

  useEffect(() => {
    // selection action descriptors are intentionally stable, so refs are
    // rebound to the latest callbacks instead of rebuilding every action array.
    copyRotNdsTo.current = copyRotNdsul
    copySvdRotSe.current = copySvdRotgg
    cutCurSelRef.current = cutCurSel
    pstClpbIntoR.current = pasteClipboard
    pstClpbIntoS.current = pstClpbIntsf
    dltSelLiveNd.current = dltSelLiveag
    dltSelSvdEnt.current = dltSelSvdEfo
  }, [
    copyRotNdsul,
    copySvdRotgg,
    cutCurSel,
    dltSelLiveag,
    dltSelSvdEfo,
    pasteClipboard,
    pstClpbIntsf,
  ])

  const getNodeEditC = useCallback((
    target: RotNsrtTgt,
    node: RotationNode,
  ): EditConfig => {
    const pstBvTgt = target
    const pstBodyTgt: RotNsrtTgt = { parentId: node.id, branch: 'items' }
    const pstStpTgt: RotNsrtTgt = { parentId: node.id, branch: 'setup' }
    const pasteSubmenu =
      node.type === 'uptime'
        ? [
            {
              id: `${node.id}:paste:above`,
              label: 'Above block',
              disabled: !canPstIntoTg(pstBvTgt),
              onSelect: () => {
                void pasteClipboard(pstBvTgt)
              },
            },
            {
              id: `${node.id}:paste:body`,
              label: 'In body',
              disabled: !canPstIntoTg(pstBodyTgt),
              onSelect: () => {
                void pasteClipboard(pstBodyTgt)
              },
            },
            {
              id: `${node.id}:paste:setup`,
              label: 'In setup',
              disabled: !canPstIntoTg(pstStpTgt),
              onSelect: () => {
                void pasteClipboard(pstStpTgt)
              },
            },
          ] satisfies MenuEntry[]
        : node.type === 'repeat'
          ? [
              {
                id: `${node.id}:paste:above`,
                label: 'Above block',
                disabled: !canPstIntoTg(pstBvTgt),
                onSelect: () => {
                  void pasteClipboard(pstBvTgt)
                },
              },
              {
                id: `${node.id}:paste:body`,
                label: 'In body',
                disabled: !canPstIntoTg(pstBodyTgt),
                onSelect: () => {
                  void pasteClipboard(pstBodyTgt)
                },
              },
            ] satisfies MenuEntry[]
          : null

    return {
      copy: {
        onSelect: () => {
          void copyLiveNode(node)
        },
      },
      cut: {
        onSelect: () => {
          void cutLiveNodeS(node)
        },
      },
      paste: pasteSubmenu
        ? {
            submenu: pasteSubmenu,
          }
        : {
            onSelect: () => {
              void pasteClipboard(target)
            },
          },
      select: {
        onSelect: () => {
          addLiveNodeT(node.id)
        },
      },
    }
  }, [addLiveNodeT, canPstIntoTg, copyLiveNode, cutLiveNodeS, pasteClipboard])

  const onDragOverTg = useCallback((key: string | null, area: RotDragArea | null) => {
    setDragOverK(key)
    setDragOverA(area)
  }, [])

  const onMoveNode = (drggNodeId: string, target: RotDropTgt) => {
    updCurTms((items) => moveRotNode(items, drggNodeId, target))
    setDraggedId(null)
    setDragOverK(null)
    setDragOverA(null)
    setDragPntr(null)
  }

  useEffect(() => {
    if (!draggedId) {
      document.body.style.cursor = ''
      return
    }

    const onDragOver = (event: DragEvent) => {
      if (event.clientX === 0 && event.clientY === 0) {
        return
      }

      setDragPntr({
        x: event.clientX,
        y: event.clientY,
      })
    }

    document.body.style.cursor = 'grabbing'
    window.addEventListener('dragover', onDragOver)

    return () => {
      document.body.style.cursor = ''
      window.removeEventListener('dragover', onDragOver)
    }
  }, [draggedId])

  const addRootFeat = () => {
    featMenuMdl.show({
      mode: 'add',
      actMemId: runtime.id,
      target: { parentId: null, branch: 'root' },
    })
  }

  const addRootCond = () => {
    condDtrMdl.show({
      mode: 'add',
      target: { parentId: null, branch: 'root' },
    })
  }

  const addRootBlock = () => {
    blckPckrMdl.show({ target: { parentId: null, branch: 'root' } })
  }

  const addRootLoop = () => {
    loopDtrMdl.show({ target: { parentId: null, branch: 'root' } })
  }

  const loadPrstRot = () => {
    if (!seed) {
      return
    }

    const defRot = seed.rotations?.[0] ?? listResRttn(seed.id)[0]
    if (!defRot) {
      return
    }

    if (runtime.rotation.personalItems.length <= 0) {
      updCurTms(() => structuredClone(defRot.items))
      return
    }

    confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message: 'This will overwrite your current entries with the preset rotation.',
      confirmLabel: 'Load',
      variant: 'danger',
      onConfirm: () => updCurTms(() => structuredClone(defRot.items)),
    })
  }

  const clrCurRot = () => {
    confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message: 'This will remove all items from the current rotation.',
      confirmLabel: 'Clear',
      variant: 'danger',
      onConfirm: () => updCurTms(() => []),
    })
  }

  const saveRotation = () => {
    const countForMode =
      invRttn.filter((entry) => entry.mode === currentMode && entry.resonatorId === seed.id).length + 1
    let name: string
    if (currentMode === 'team') {
      const seen = new Set<string>()
      const memberNames: string[] = []
      for (const id of [runtime.id, ...runtime.build.team]) {
        if (!id || seen.has(id)) continue
        seen.add(id)
        const n = seedRsntById[id]?.name
        if (n) memberNames.push(n)
      }
      name = `${memberNames.join('/')} Rotation ${countForMode}`
    } else {
      name = `${seed.name} Rotation ${countForMode}`
    }

    const profile = useAppStore.getState().calculator.profiles[runtime.id] ?? undefined
    const rotGrp = currentMode === 'team' ? simulation?.rotations.team : simulation?.rotations.personal
    const summary = rotGrp ? (() => {
      const total = { normal: rotGrp.total.normal, avg: rotGrp.total.avg, crit: rotGrp.total.crit }
      if (currentMode !== 'team') return { total }
      const members = mkMemCntr(rotGrp.entries)
      return { total, members }
    })() : undefined

    svdRotDtrMdl.show({
      kind: 'create',
      rotation: {
      name,
      mode: currentMode,
      resonatorId: seed.id,
      resName: seed.name,
      ...(currentMode === 'team' ? { team: [...runtime.build.team] as ResRuntime['build']['team'] } : {}),
      items: currentItems,
      snapshot: profile,
      summary,
      },
    })
  }

  const applyRotToRe = (entry: RotLoadPay, targetId: string) => {
    if (entry.mode === 'team' && entry.team) {
      for (const memberId of entry.team) {
        if (!memberId) continue
        const memberSeed = seedRsntById[memberId]
        if (memberSeed && memberId !== targetId) {
          ensTeamMemRt(memberSeed)
        }
      }
    }

    const updater = (prev: ResRuntime): ResRuntime => ({
      ...prev,
      build: {
        ...prev.build,
        team:
          entry.mode === 'team' && entry.team
            ? [...entry.team] as ResRuntime['build']['team']
            : prev.build.team,
      },
      rotation: {
        ...prev.rotation,
        view: entry.mode,
        ...(entry.mode === 'team'
          ? { teamItems: cloneRotNds(entry.items) }
          : { personalItems: cloneRotNds(entry.items) }),
      },
    })

    if (targetId === runtime.id) {
      onRtPdt(updater)
    } else {
      updResRt(targetId, updater)
    }
  }

  const loadSvdRot = (entry: InvRotEnt, withSnapshot?: boolean) => {
    const apply = () => {
      if (entry.resonatorId !== runtime.id) {
        swtcToRes(entry.resonatorId)
      }
      if (withSnapshot && entry.snapshot) {
        loadResProf(entry.snapshot)
      }
      applyRotToRe({ ...entry, resName: entry.resonatorName }, entry.resonatorId)
    }

    if (entry.resonatorId !== runtime.id) {
      confirmation.confirm({
        title: `Switch to ${entry.resonatorName}?`,
        message: `This rotation belongs to ${entry.resonatorName}. Loading it will switch the active resonator and apply the rotation.`,
        confirmLabel: 'Switch & Load',
        variant: 'info',
        onConfirm: apply,
      })
      return
    }

    apply()
  }

  const ppndRotNdsTo = useCallback((items: RotationNode[]) => {
    if (items.length === 0) {
      return
    }

    onRtPdt((prev) => ({
      ...prev,
      rotation: {
        ...prev.rotation,
        view: 'team',
        teamItems: [...prev.rotation.teamItems, ...cloneRotNds(items, { freshIds: true })],
      },
    }))
  }, [onRtPdt])

  const ppndSelRotSr = useCallback(() => {
    const selEnt = ppndSrcPtns.find((entry) => entry.value === rslvPpndSrcI)
    if (!selEnt) {
      return
    }

    ppndRotNdsTo(selEnt.items)
  }, [ppndRotNdsTo, ppndSrcPtns, rslvPpndSrcI])

  const mkDtrPaneCtx = (): MenuEntry[] => getRotEditCt({
    menu: menu.calculator.rotation,
    mode: currentMode,
    view: runtime.rotation.view,
    append: ppndSrcPtns,
    onAddFeat: addRootFeat,
    onAddCond: addRootCond,
    onAddBlock: addRootBlock,
    onLoopify: lpfyCurRot,
    onPreset: loadPrstRot,
    onSave: saveRotation,
    onClear: clrCurRot,
    onAppend: ppndRotNdsTo,
    edit: dtrPaneEditC,
  })

  const mkSvdPaneCtx = (): MenuEntry[] => getRotSvdPan({
    menu: menu.calculator.rotation,
    sort: svdSortRdr,
    auto,
    seedName: seed?.name ?? '',
    canClear: svdRotEnts.length > 0,
    pickImport: () => mprtFileNptR.current?.click(),
    onClear: () => confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message: 'This will delete all saved rotations. This cannot be undone.',
      confirmLabel: 'Clear All',
      variant: 'danger',
      onConfirm: clrInvRttn,
    }),
    onSortBy: (value) => setSvdRotPre((current) => ({ ...current, sortBy: value })),
    onSort: () => setSvdRotPre((current) => ({
      ...current,
      sortOrder: current.sortOrder === 'asc' ? 'desc' : 'asc',
    })),
    onFilter: (value) => setSvdRotPre((current) => ({
      ...current,
      filterMode:
        value === 'all'
          ? 'all'
          : current.filterMode === value
            ? 'all'
            : value,
    })),
    onAuto: () => {
      if (auto) {
        setSvdRotPre((current) => ({
          ...current,
          autoSearchActiveResonator: false,
        }))
        return
      }

      setSvdSrchNp(seed?.name ?? '')
      setSvdRotPre((current) => ({
        ...current,
        autoSearchActiveResonator: true,
      }))
    },
    edit: svdPaneEditC,
  })

  const dtrPaneEditC: EditConfig = {
    copy: {
      disabled: !selMode || !hasPndnSel,
      onSelect: () => {
        void copyCurSel()
      },
    },
    cut: {
      disabled: !selMode || !hasPndnSel,
      onSelect: () => {
        void cutCurSel()
      },
    },
    paste: {
      onSelect: () => {
        void pasteClipboard({ parentId: null, branch: 'root' })
      },
    },
    select: {
      onSelect: ntrPaneSelMo,
    },
  }

  const svdPaneEditC: EditConfig = {
    copy: {
      disabled: !selMode || !hasPndnSel,
      onSelect: () => {
        void copyCurSel()
      },
    },
    cut: {
      disabled: !selMode || !hasPndnSel,
      onSelect: () => {
        void cutCurSel()
      },
    },
    paste: {
      onSelect: () => {
        void pstClpbIntsf()
      },
    },
    select: {
      onSelect: ntrPaneSelMo,
    },
  }

  const getRotPaneCt = () => {
    return showEditor ? mkDtrPaneCtx() : mkSvdPaneCtx()
  }

  const mkRotItemCtx = useCallback((items: MenuEntry[]) => (
    menu.calculator.rotation.item({ items })
  ), [menu.calculator.rotation])

  const openSvdRotCt = useCallback((entry: InvRotEnt) => {
    ctnListMdl.show(entry)
  }, [ctnListMdl])

  const openSvdRotDt = useCallback((entry: InvRotEnt) => {
    svdRotDtrMdl.show({ kind: 'edit', rotation: entry })
  }, [svdRotDtrMdl])

  const openSvdRotLo = useCallback((entry: InvRotEnt) => {
    loadChcMdl.show(entry)
  }, [loadChcMdl])

  const cnfrDltSvdRo = useCallback((entry: InvRotEnt) => {
    confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message: `Delete "${entry.name}" from your saved rotations?`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => rmInvRot(entry.id),
    })
  }, [confirmation, rmInvRot])

  const mkSvdRotItem = useCallback((entry: InvRotEnt): EditConfig => ({
    copy: {
      onSelect: () => {
        void copySvdRotTo(entry)
      },
    },
    cut: {
      onSelect: () => {
        void cutSvdRotToC(entry)
      },
    },
    paste: {
      onSelect: () => {
        void pstClpbIntsf()
      },
    },
    select: {
      onSelect: () => {
        addSvdEntToS(entry.id)
      },
    },
  }), [addSvdEntToS, copySvdRotTo, cutSvdRotToC, pstClpbIntsf])

  if (!seed) {
    return (
      // even the empty state keeps the pane-level menu so workspace actions stay discoverable.
      <ContextTrigger
        asChild
        ariaLabel="Rotation pane actions"
        getItems={getRotPaneCt}
      >
        <section
          className="calc-pane rotation-pane"
          {...actSel.focusProps}
        >
          <div>
            <div className="panel-overline">Simulation</div>
            <h3>Rotations</h3>
          </div>
          <div className="soft-empty">No active resonator data is available.</div>
        </section>
      </ContextTrigger>
    )
  }

  const rootDropKey = `${runtime.rotation.view}:root:end`
  const emptyMessage =
    currentMode === 'team'
      ? 'Add features, conditions, or blocks to build a team rotation.'
      : 'Add features, conditions, or blocks to build a personal rotation.'
  const defFeatMemId = featMenuMdl.value?.actMemId ?? runtime.id
  const defShowFeatS =
    featMenuMdl.value?.mode === 'edit' && dtdFeatNode
      ? featMetaById[dtdFeatNode.featureId]?.variant === 'subHit'
      : false
  const ctnListSqnc = ctnListMdl.value
    ? mkSqnc({
        items: ctnListMdl.value.items,
        initialCombat: ctnListMdl.value.snapshot?.runtime.local.combat,
        resonatorId: ctnListMdl.value.resonatorId,
      })
    : null
  const ctnListLoopL = ctnListMdl.value
    ? new Map(
        cllcLoopNds(ctnListMdl.value.items)
          .filter((node) => node.kind === 'start')
          .map((node, index) => {
            const start = node as Extract<typeof node, { kind: 'start' }>
            return [start.loopId, start.label ?? `Loop ${index + 1}`] as const
          }),
      )
    : undefined
  const drggEntNode = isEntryNode(draggedNode) ? draggedNode : null
  const showDragPrvw =
    draggedNode != null &&
    dragPointer != null &&
    (dragPointer.x !== 0 || dragPointer.y !== 0)
  const dragPrvwPrtl = bodyPortal()

  return (
    // the pane trigger owns only the background/root menu; saved entry cards still provide their own overrides below.
    <ContextTrigger
      asChild
      ariaLabel="Rotation pane actions"
      getItems={getRotPaneCt}
    >
      <section
        className={`calc-pane rotation-pane${selMode ? ' selection-mode' : ''}`}
        {...actSel.focusProps}
      >
        <div className="echoes-pane-header rotation-pane-header">
          <div className="echoes-pane-title weapon-effect__bar">
            <span className="weapon-effect__sigil" aria-hidden="true" />
            <span className="weapon-effect__titles">
              <span className="weapon-effect__tag">Simulation</span>
              <span className="weapon-effect__name">Rotations</span>
            </span>
          </div>

          <div className="echoes-pane-summary">
            <div className="echo-toolbar pane-view-toggle" role="group" aria-label="Rotation view">
              <button
                type="button"
                className={runtime.rotation.view === 'personal' ? 'echo-tool pane-view-toggle__button is-active' : 'echo-tool pane-view-toggle__button'}
                aria-pressed={runtime.rotation.view === 'personal'}
                onClick={() => setRotView('personal')}
              >
                Personal
              </button>
              <button
                type="button"
                className={runtime.rotation.view === 'team' ? 'echo-tool pane-view-toggle__button is-active' : 'echo-tool pane-view-toggle__button'}
                aria-pressed={runtime.rotation.view === 'team'}
                onClick={() => setRotView('team')}
              >
                Team
              </button>
              <button
                type="button"
                className={runtime.rotation.view === 'saved' ? 'echo-tool pane-view-toggle__button is-active' : 'echo-tool pane-view-toggle__button'}
                aria-pressed={runtime.rotation.view === 'saved'}
                onClick={() => setRotView('saved')}
              >
                Saved
              </button>
            </div>
          </div>
        </div>

      {showEditor ? (
        <>
          <div className="pane-section rotation-pane-controls">
            <div className="rotation-toolbar">
              <div className="rotation-toolbar-group">
                <button
                  type="button"
                  className="rotation-button"
                  onClick={addRootFeat}
                >
                  <Plus size={14} />
                  Feature
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={addRootCond}
                >
                  <Plus size={14} />
                  Condition
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={addRootBlock}
                >
                  <Plus size={14} />
                  Block
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={addRootLoop}
                >
                  <Plus size={14} />
                  Loop
                </button>
              </div>

              <div className="rotation-toolbar-group">
                {currentMode === 'personal' && (
                  <button type="button" className="rotation-button" onClick={loadPrstRot}>
                    <RotateCcw size={14} />
                    Preset
                  </button>
                )}
                <button type="button" className="rotation-button" onClick={saveRotation}>
                  <Save size={14} />
                  Save
                </button>
                <button type="button" className="rotation-button clear" onClick={clrCurRot}>
                  Clear
                </button>
              </div>
            </div>

            {(runtime.rotation.view === 'team' && ppndSrcPtns.length > 0) ? (
              <div
                className={`rotation-toolbar rotation-toolbar--footer rotation-toolbar--append${selMode ? ' is-disabled' : ''}`}
                aria-disabled={selMode}
              >
                <div className="rotation-toolbar-group rotation-toolbar-group--append">
                  <div className="rotation-toolbar-field ui-inline-field ui-inline-field--wide">
                    <LiquidSelect
                      value={rslvPpndSrcI}
                      options={ppndSrcPtns}
                      onChange={setSelPpndSr}
                      disabled={ppndSrcPtns.length === 0}
                      placeholder="No eligible rotations"
                      ariaLabel="Rotation source"
                    />
                  </div>
                  <button
                    type="button"
                    className="rotation-button"
                    disabled={!rslvPpndSrcI}
                    onClick={ppndSelRotSr}
                  >
                    Append
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rotation-entries-list">
            <div
              className={`rotation-list-container ${dragOverKey === rootDropKey ? 'drag-over' : ''}`}
              {...(showEditor ? liveSel.scopeProps : {})}
              onDragOver={(event) => {
                event.preventDefault()
                onDragOverTg(rootDropKey, 'root')
              }}
              onDragLeave={() => {
                if (dragOverKey === rootDropKey) {
                  onDragOverTg(null, null)
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (!draggedId) {
                  return
                }
                onMoveNode(draggedId, {
                  parentId: null,
                  branch: 'root',
                  index: currentItems.length,
                  key: rootDropKey,
                })
              }}
            >
              {currentItems.length ? (
                currentItems.map((node, index) => (
                  <TreeNode
                    key={node.id}
                    portalTarget={portalTarget}
                    runtime={runtime}
                    runtimesById={runtimesById}
                    treeItems={currentItems}
                    node={node}
                    depth={0}
                    parentId={null}
                    branch="root"
                    index={index}
                    resultMap={resultMap}
                    featMetaById={featMetaById}
                    djcnFeatById={djcnFeatById}
                    prvsFeatById={prvsFeatById}
                    condChoices={condChoices}
                    loopInfoById={loopAnalysis.mrkrInfoByns}
                    loopLabelById={loopLabelById}
                    collapsedIds={collapsedIds}
                    defFeatMemId={defFeatMemId}
                    draggedId={draggedId}
                    draggedNode={draggedNode}
                    dragOverKey={dragOverKey}
                    dragOverArea={dragOverArea}
                    onDragStart={(nodeId) => {
                      setDraggedId(nodeId)
                      setDragOverK(null)
                      setDragOverA(null)
                    }}
                    onDragEnd={() => {
                      setDraggedId(null)
                      setDragOverK(null)
                      setDragOverA(null)
                      setDragPntr(null)
                    }}
                    onDragOverNode={onDragOverTg}
                    onMoveNode={onMoveNode}
                    onToggleClosed={(nodeId) =>
                      setCllpIds((prev) => ({
                        ...prev,
                        [nodeId]: !(prev[nodeId] ?? false),
                      }))
                    }
                    onDeleteNode={dltCurNode}
                    onOpenFeatMenu={featMenuMdl.show}
                    onOpenNegConfig={negFfctCnfgM.show}
                    onOpenCondition={condDtrMdl.show}
                    onOpenFeatCond={featCondDtrM.show}
                    onOpenBlock={(target) => blckPckrMdl.show({ target })}
                    onOpenLoop={(target) => loopDtrMdl.show({ target })}
                    onOpenWhen={(nodeId) => whenDtrMdl.show({ nodeId })}
                    buildCtxMenu={mkRotItemCtx}
                    getEditConfig={getNodeEditC}
                    onUpdateNode={updCurNode}
                    onNsrtNodeAt={(target, node) => updCurTms((items) => nsrtNodeAtTg(items, target, node))}
                    onLpfyNode={lpfyCurNode}
                    onBlckNode={blckCurNode}
                    selMode={selMode}
                    selectedIds={selLiveNodeI}
                    onAddSel={addLiveNodeT}
                    onRngSel={addLiveNodeS}
                    onTgglSel={tglLiveNodeS}
                  />
                ))
              ) : (
                <div className="soft-empty">{emptyMessage}</div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="pane-section rotation-pane-controls saved-rotations">
            <div className="rotation-toolbar">
              <div className="rotation-toolbar-group">
                <LiquidSelect
                  value={savedSortBy}
                  options={[
                    { value: 'date', label: 'Date' },
                    { value: 'name', label: 'Name' },
                    { value: 'avg', label: 'Avg DMG' },
                    { value: 'dps', label: 'DPS' },
                  ]}
                  onChange={(nextValue) =>
                    setSvdRotPre((current) => ({
                      ...current,
                      sortBy: nextValue as typeof current.sortBy,
                    }))
                  }
                  ariaLabel="Sort by"
                  portalTarget={portalTarget}
                />
                <button
                  type="button"
                  className="rotation-button"
                  onClick={() =>
                    setSvdRotPre((current) => ({
                      ...current,
                      sortOrder: current.sortOrder === 'asc' ? 'desc' : 'asc',
                    }))
                  }
                >
                  {svdSortRdr === 'desc' ? <RrwUpNrrwWid size={15} /> : <RrwDownNrrwW size={15} />}
                  {svdSortRdr !== 'desc' ? 'Descending' : 'Ascending'}
                </button>

              </div>
              <div className="rotation-toolbar-group">
                <button
                  type="button"
                  className="rotation-button"
                  onClick={() => mprtFileNptR.current?.click()}
                >
                  Import
                </button>
                <button
                  type="button"
                  className="rotation-button clear"
                  disabled={svdRotEnts.length === 0}
                  onClick={() => confirmation.confirm({
                    title: 'You sure about that? ( · ❛ ֊ ❛)',
                    message: 'This will delete all saved rotations. This cannot be undone.',
                    confirmLabel: 'Clear All',
                    variant: 'danger',
                    onConfirm: clrInvRttn,
                  })}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className={`rotation-toolbar rotation-toolbar--footer${selMode ? ' is-disabled' : ''}`} aria-disabled={selMode}>
              <div className="rotation-saved-filters">
                <span className="rotation-saved-filters__label">Filter:</span>
                <div className="rotation-saved-filters__toggles">
                  <button
                    type="button"
                    className={`rotation-saved-filters__toggle${svdFltrMode === 'personal' ? ' on' : ''}`}
                    onClick={() =>
                      setSvdRotPre((current) => ({
                        ...current,
                        filterMode: current.filterMode === 'personal' ? 'all' : 'personal',
                      }))
                    }
                  >
                    Personal
                  </button>
                  <button
                    type="button"
                    className={`rotation-saved-filters__toggle${svdFltrMode === 'team' ? ' on' : ''}`}
                    onClick={() =>
                      setSvdRotPre((current) => ({
                        ...current,
                        filterMode: current.filterMode === 'team' ? 'all' : 'team',
                      }))
                    }
                  >
                    Team
                  </button>
	                </div>
                <div className="rotation-saved-filters__search">
                  <Search size={13} className="rotation-saved-filters__search-icon" />
                  <input
                    type="text"
                    className="rotation-saved-filters__search-input"
                    placeholder="Search..."
                    value={svdSrchQry}
                    onChange={(e) => {
                      setSvdSrchNp(e.target.value)
                    }}
                  />
                </div>
                ⇠
                <button
                    type="button"
                    className={`rotation-saved-filters__toggle${auto ? ' on' : ''}`}
                    onClick={() => {
                      if (auto) {
                        setSvdRotPre((current) => ({
                          ...current,
                          autoSearchActiveResonator: false,
                        }))
                        return
                      }

                      setSvdSrchNp(seed.name)
                      setSvdRotPre((current) => ({
                        ...current,
                        autoSearchActiveResonator: true,
                      }))
                    }}
                >
                  Auto
                </button>
              </div>
            </div>
          </div>
          <div className="rotation-entries-list">
            <div
              className="rotation-saved-list"
              {...(!showEditor ? svdSel.scopeProps : {})}
            >
              {svdRotEnts.length ? (
                svdRotEnts.map((entry) => {
                  const svdRotDps = getSvdRotDps(entry)
                  const isSavedSelect = selSvdEntIds.has(entry.id)

                  return (
                    // saved entries extend the shared rotation-item builder with entry-specific edit/load actions.
                    <ContextTrigger
                      key={entry.id}
                      asChild
                      ariaLabel={`Saved rotation ${entry.name}`}
                      items={getRotSvdIte({
                        menu: menu.calculator.rotation,
                        entry,
                        edit: mkSvdRotItem(entry),
                        onActs: () => openSvdRotCt(entry),
                        onEdit: () => openSvdRotDt(entry),
                        onExport: () => onXprtRot(entry),
                        onLoad: () => openSvdRotLo(entry),
                        onDel: () => cnfrDltSvdRo(entry),
                      })}
                    >
                      <Expandable
                        as="div"
                        className={`rotation-saved-item${isSavedSelect ? ' focus-selected' : ''}${selMode ? ' selection-mode' : ''}`}
                        data-selection-focus-item="true"
                        aria-selected={isSavedSelect ? 'true' : 'false'}
                        onClickCapture={svdSel.buildClickCapture(entry.id, {
                          active: !showEditor,
                          onCapture: clrDragStt,
                        })}
                        chevWrapClass="rotation-button mini rotation-saved-chevron"
                        chevronSize={11}
                        header={
                          <div className="rotation-saved-item-header">
                              <div className="rotation-saved-copy">
                                <strong>{entry.name}</strong>
                                <span className="rotation-saved-summary-line">
                                  {entry.resonatorName} • {entry.mode === 'team' ? 'Team' : 'Personal'}
                                  {entry.summary ? (
                                    <>
                                      {' • '}
                                      <span className="value avg">
                                        {fmtSvdRotNtg(entry.summary.total.avg)}
                                      </span>{' '}
                                      {svdRotDps != null ? 'dpr' : 'avg'}
                                    </>
                                  ) : null}
                                  {svdRotDps != null ? (
                                    <>
                                      {' • '}
                                      <span className="value avg">
                                        {fmtSvdRotNtg(svdRotDps)}
                                      </span>{' '}
                                      dps
                                    </>
                                  ) : null}
                                  {entry.duration > 0 ? ` • ${fmtSvdRotDur(entry.duration)}` : ''}
                              </span>
                            </div>
                            <div className="rotation-saved-actions">
                              <button
                                type="button"
                                title="Actions"
                                className="rotation-button mini"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openSvdRotCt(entry)
                                }}
                              >
                                <CgListTree size={11} />
                              </button>
                              <button
                              type="button"
                              className="rotation-button mini"
                              onClick={(e) => {
                                e.stopPropagation()
                                openSvdRotDt(entry)
                              }}
                              title="Edit details"
                              >
                                <Pencil size={11} />
                              </button>
                              <button
                              type="button"
                              className="rotation-button mini"
                              title="Export"
                              onClick={(e) => {
                                e.stopPropagation()
                                onXprtRot(entry)
                              }}
                              >
                                <PiPldSmplBol size={11} />
                              </button>
                              <button
                              type="button"
                              className="rotation-button mini"
                              title="Load"
                              onClick={(e) => {
                                e.stopPropagation()
                                openSvdRotLo(entry)
                              }}
                              >
                                <PiDwnlSmplBo size={11} />
                              </button>
                              <button
                              type="button"
                              title="Delete"
                              className="rotation-button clear mini"
                              onClick={(e) => {
                                e.stopPropagation()
                                cnfrDltSvdRo(entry)
                              }}
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                        }
                      >
                        {entry ? (
                          <SavedSummary
                            entry={entry}
                            rslvResName={(id) => getResSeedBy(id)?.name ?? id}
                          />
                        ) : (
                          <div className="team-state-empty">
                            No saved rotation snapshot yet.
                          </div>
                        )}
                      </Expandable>
                    </ContextTrigger>
                  )
                })
              ) : (
                <div className="soft-empty">No saved rotations yet.</div>
              )}
            </div>
          </div>
        </>
      )}

      <RotSkllMenu
        key={featMenuMdl.value ? `${featMenuMdl.value.mode}:${featMenuMdl.value.nodeId ?? 'new'}` : 'skill-menu:closed'}
        visible={featMenuMdl.visible}
        open={featMenuMdl.open}
        closing={featMenuMdl.closing}
        portalTarget={portalTarget}
        members={dtblMmbr}
        actMemId={featMenuMdl.value?.actMemId ?? runtime.id}
        defShowSubwy={defShowFeatS}
        onActMemChng={(resonatorId) =>
          featMenuMdl.update((prev) => ({ ...prev, actMemId: resonatorId }))
        }
        onClose={featMenuMdl.hide}
        onSlctSkll={(entry) => {
          const memberSeed = seedRsntById[entry.resonatorId]
          if (memberSeed && entry.resonatorId !== runtime.id) {
            ensTeamMemRt(memberSeed)
          }

          if (featMenuMdl.value?.mode === 'edit' && featMenuMdl.value.nodeId) {
            updCurNode(featMenuMdl.value.nodeId, (current) =>
              current.type === 'feature'
                ? {
                    ...current,
                    featureId: entry.featureId,
                    resonatorId: entry.resonatorId,
                  }
                : current,
            )
          } else {
            nsrtCurNode(featMenuMdl.value?.target ?? { parentId: null, branch: 'root' }, {
              id: makeNodeId('rotation:feature'),
              type: 'feature',
              resonatorId: entry.resonatorId,
              featureId: entry.featureId,
              multiplier: 1,
              enabled: true,
            })
          }

          featMenuMdl.hide()
        }}
      />

      <Condition
        key={condDtrMdl.value ? `${condDtrMdl.value.mode}:${condDtrMdl.value.nodeId ?? 'new'}` : 'condition-editor:closed'}
        visible={condDtrMdl.visible}
        open={condDtrMdl.open}
        closing={condDtrMdl.closing}
        portalTarget={portalTarget}
        choices={condChoices}
        ntlChng={dtdCondNode?.changes ?? MPTYFEATCOND}
        featureLabel={condDtrMdl.value?.mode === 'edit' ? 'Edit Condition' : 'Add Conditions'}
        eyebrow="Rotation Conditions"
        emptyText="Select states from the picker to add a condition to the rotation list."
        onClose={condDtrMdl.hide}
        onSave={(changes) => {
          for (const change of changes) {
            const memberSeed = change.resonatorId ? seedRsntById[change.resonatorId] : null
            if (memberSeed && change.resonatorId !== runtime.id) {
              ensTeamMemRt(memberSeed)
            }
          }

          if (condDtrMdl.value?.mode === 'edit' && condDtrMdl.value.nodeId) {
            const nodeId = condDtrMdl.value.nodeId
            if (changes.length === 0) {
              dltCurNode(nodeId)
              condDtrMdl.hide()
              return
            }

            const rplcNds = changes.map((change, index) => mkRotCondNod(
              change,
              condChoices,
              makeNodeId,
              {
                id: index === 0 ? nodeId : undefined,
                enabled: dtdCondNode?.enabled ?? true,
                fallbackResId: dtdCondNode?.resonatorId,
              },
            ))

            updCurTms((items) => {
              const nextItems = updRotNode(items, nodeId, () => rplcNds[0])
              const location = findNodeLctn(nextItems, nodeId)
              if (!location) {
                return nextItems
              }

              return nsrtRotNds(
                nextItems,
                {
                  parentId: location.parentId,
                  branch: location.branch,
                  index: location.index + 1,
                },
                rplcNds.slice(1),
              )
            })
            condDtrMdl.hide()
            return
          }

          const nodes = changes.map((change) => mkRotCondNod(change, condChoices, makeNodeId))
          nsrtCurNds(condDtrMdl.value?.target ?? { parentId: null, branch: 'root' }, nodes)
          condDtrMdl.hide()
        }}
      />

      <Condition
        key={featCondDtrM.value?.nodeId ?? 'feature-condition-editor:closed'}
        visible={featCondDtrM.visible}
        open={featCondDtrM.open}
        closing={featCondDtrM.closing}
        portalTarget={portalTarget}
        choices={condChoices}
        ntlChng={dtdFeatCondN?.changes ?? MPTYFEATCOND}
        featureLabel={
          dtdFeatCondN
            ? featMetaById[dtdFeatCondN.featureId]?.label ?? dtdFeatCondN.featureId
            : 'Feature'
        }
        onClose={featCondDtrM.hide}
        onSave={(changes) => {
          if (!featCondDtrM.value?.nodeId) {
            return
          }

          for (const change of changes) {
            const memberSeed = change.resonatorId ? seedRsntById[change.resonatorId] : null
            if (memberSeed && change.resonatorId !== runtime.id) {
              ensTeamMemRt(memberSeed)
            }
          }

          updCurNode(featCondDtrM.value.nodeId, (current) =>
            current.type === 'feature'
              ? (() => {
                  const { changes: rmvdis, ...featureNode } = current
                  void rmvdis
                  return changes.length > 0 ? { ...featureNode, changes } : featureNode
                })()
              : current,
          )
          featCondDtrM.hide()
        }}
      />

      <NegFfct
        key={negFfctCnfgM.value?.nodeId ?? 'negative-effect-config:closed'}
        visible={negFfctCnfgM.visible}
        open={negFfctCnfgM.open}
        closing={negFfctCnfgM.closing}
        portalTarget={portalTarget}
        initialNode={dtdNegFfctFe}
        featureMeta={dtdNegFfctMe}
        onClose={negFfctCnfgM.hide}
        onSave={(config) => {
          if (!negFfctCnfgM.value?.nodeId) {
            return
          }

          updCurNode(negFfctCnfgM.value.nodeId, (current) =>
            current.type === 'feature'
              ? (() => {
                  const { negativeEffectStacks: rmvdsz, ...featureNode } = current
                  void rmvdsz
                  return {
                    ...featureNode,
                    ...config,
                  }
                })()
              : current,
          )
          negFfctCnfgM.hide()
        }}
      />

      <Block
        visible={blckPckrMdl.visible}
        open={blckPckrMdl.open}
        closing={blckPckrMdl.closing}
        portalTarget={portalTarget}
        onClose={blckPckrMdl.hide}
        onSelect={(type) => {
          nsrtCurNode(blckPckrMdl.value?.target ?? { parentId: null, branch: 'root' }, mkBlckNode(type))
          blckPckrMdl.hide()
        }}
      />

      <Loop
        visible={loopDtrMdl.visible}
        open={loopDtrMdl.open}
        closing={loopDtrMdl.closing}
        portalTarget={portalTarget}
        items={currentItems}
        loops={loopAnalysis.loops}
        onClose={loopDtrMdl.hide}
        onSave={(rows) => {
          updCurTms((items) =>
            applyLoopDrf(
              items,
              loopDtrMdl.value?.target ?? { parentId: null, branch: 'root' },
              rows,
            ),
          )
          loopDtrMdl.hide()
        }}
      />

      <When
        visible={whenDtrMdl.visible}
        open={whenDtrMdl.open}
        closing={whenDtrMdl.closing}
        portalTarget={portalTarget}
        node={dtdWhenNode}
        choices={condChoices}
        loops={dtdWhenLps}
        nspcRows={whenNspcRows}
        stateGroups={whenStateGroups}
        view={whenView}
        stateLoopId={whenStateLoopId}
        stateRun={whenStateRun}
        onViewChange={handleWhenViewChange}
        onStateLoopChange={setWhenStateLoopId}
        onStateRunChange={setWhenStateRun}
        onClose={whenDtrMdl.hide}
        onSave={(when) => {
          if (!whenDtrMdl.value?.nodeId) {
            return
          }

          updCurNode(whenDtrMdl.value.nodeId, (current) => {
            let nextNode: RotationNode = current
            if ('condition' in nextNode) {
              const { condition: rmvdfw, ...nodeWthtCndt } = nextNode
              void rmvdfw
              nextNode = nodeWthtCndt as RotationNode
            }
            if ('when' in nextNode) {
              const { when: _removedWhen, ...nodeWthtWhen } = nextNode
              void _removedWhen
              nextNode = nodeWthtWhen as RotationNode
            }
            return when ? { ...nextNode, when } : nextNode
          })
          whenDtrMdl.hide()
        }}
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

      <AppModal
        state={svdRotDtrMdl.dialogProps}
        variant="saved-rotation-editor"
        ariaLabel="Edit saved rotation"
        onClose={svdRotDtrMdl.hide}
      >
        <div className="saved-rotation-editor-modal__body">
          <div className="saved-rotation-editor-modal__head">
            <div className="saved-rotation-editor-modal__title-wrap">
              <span className="saved-rotation-editor-modal__eyebrow">Saved Rotation</span>
              <h2 className="saved-rotation-editor-modal__title">
                {svdRttnDtrDr.name || 'Saved Rotation'}
              </h2>
            </div>
            <MdlClsBttn onClick={svdRotDtrMdl.hide} />
          </div>

          <div className="saved-rotation-editor-modal__grid">
            <label className="saved-rotation-editor-modal__field saved-rotation-editor-modal__field--name">
              <span>Name</span>
              <input
                type="text"
                value={svdRttnDtrDr.name}
                onChange={(event) => {
                  const { value } = event.target
                  setSvdRttnDt((current) => ({ ...current, name: value }))
                }}
                autoFocus
              />
            </label>

            <label className="saved-rotation-editor-modal__field">
              <span>Duration</span>
              <div className="saved-rotation-editor-modal__duration-control">
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  inputMode="decimal"
                  value={svdRttnDtrDr.duration}
                  onChange={(event) => {
                    const { value } = event.target
                    setSvdRttnDt((current) => ({ ...current, duration: value }))
                  }}
                />
                <span>sec</span>
              </div>
            </label>

            <label className="saved-rotation-editor-modal__field saved-rotation-editor-modal__field--note">
              <span>Note</span>
              <textarea
                value={svdRttnDtrDr.note}
                onChange={(event) => {
                  const { value } = event.target
                  setSvdRttnDt((current) => ({ ...current, note: value }))
                }}
                rows={6}
                placeholder="If/When this is shared, the recipient(s) will see this too so please be nice..."
              />
            </label>
          </div>
        </div>

        <div className="saved-rotation-editor-modal__footer">
          <button
            type="button"
            className="saved-rotation-editor-modal__button saved-rotation-editor-modal__button--cancel"
            onClick={svdRotDtrMdl.hide}
          >
            Cancel
          </button>
          <button
            type="button"
            className="saved-rotation-editor-modal__button saved-rotation-editor-modal__button--save"
            onClick={() => {
              if (svdRotDtrMdl.value) {
                if (svdRotDtrMdl.value.kind === 'edit') {
                  updInvRot(svdRotDtrMdl.value.rotation.id, {
                    name: svdRttnDtrDr.name,
                    duration: Number(svdRttnDtrDr.duration),
                    note: svdRttnDtrDr.note,
                  })
                } else {
                  const nextEntry = addRotToInv({
                    ...svdRotDtrMdl.value.rotation,
                    resonatorName: svdRotDtrMdl.value.rotation.resName,
                    name: svdRttnDtrDr.name,
                    duration: Number(svdRttnDtrDr.duration),
                    note: svdRttnDtrDr.note,
                  })

                  showToast({
                    content: `Saved "${nextEntry?.name ?? svdRttnDtrDr.name}"`,
                    variant: 'success',
                    duration: 3000,
                  })
                }
              }
              svdRotDtrMdl.hide()
            }}
          >
            Save
          </button>
        </div>
      </AppModal>

      <AppModal
        state={ctnListMdl.dialogProps}
        variant="rotation-action-list"
        ariaLabel="Saved rotation action sequence"
        onClose={ctnListMdl.hide}
      >
        <div className="confirmation-modal__body rotation-action-list-modal__body">
          <div className="rotation-action-list-modal__head">
            <h2 className="confirmation-modal__title">{ctnListMdl.value?.name ?? 'Saved Rotation'}</h2>
            <MdlClsBttn onClick={ctnListMdl.hide} />
          </div>
          <div className="rotation-action-list-modal__list">
            {ctnListSqnc ? (
              <CtnSqnc
                actions={ctnListSqnc.actions}
                condChoices={condChoices}
                entries={ctnListSqnc.entries}
                loopLabelById={ctnListLoopL}
                spans={ctnListSqnc.spans}
              />
            ) : null}
          </div>
        </div>
      </AppModal>

      <AppModal
        state={loadChcMdl.dialogProps}
        variant="confirmation"
        tone="info"
        ariaLabel="Load rotation"
        onClose={loadChcMdl.hide}
      >
        <div className="confirmation-modal__body">
          <h2 className="confirmation-modal__title">
            Load "{loadChcMdl.value?.name}"
          </h2>
          <div className="confirmation-modal__message">
            Choose how to load this saved rotation.
          </div>
        </div>
        <div className="confirmation-modal__actions rotation-load-choice-actions">
          <button
            type="button"
            className="confirmation-modal__btn confirmation-modal__btn--cancel"
            onClick={loadChcMdl.hide}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirmation-modal__btn confirmation-modal__btn--confirm"
            onClick={() => {
              if (loadChcMdl.value) loadSvdRot(loadChcMdl.value)
              loadChcMdl.hide()
            }}
          >
            Rotation Only
          </button>
          <button
            type="button"
            className="confirmation-modal__btn confirmation-modal__btn--confirm"
            disabled={!loadChcMdl.value?.snapshot}
            title={loadChcMdl.value?.snapshot ? undefined : 'No build snapshot saved with this entry'}
            onClick={() => {
              if (loadChcMdl.value) loadSvdRot(loadChcMdl.value, true)
              loadChcMdl.hide()
            }}
          >
            Full Build
          </button>
        </div>
      </AppModal>

      {showDragPrvw && dragPrvwPrtl
        ? createPortal(
            <div
                className={`rotation-drag-overlay ${dragOverArea === 'block-items' || dragOverArea === 'block-setup' ? 'over-block' : ''}`}
                style={{
                  left: dragPointer.x + 18,
                  top: dragPointer.y + 12,
                }}
              >
                {drggEntNode ? (
                  <RotDragPrvw
                    runtime={runtime}
                    node={drggEntNode}
                    resultMap={resultMap}
                    featMetaById={featMetaById}
                    condChoices={condChoices}
                  />
                ) : draggedNode && (draggedNode.type === 'repeat' || draggedNode.type === 'uptime') ? (
                  <article className="rotation-item rotation-block rotation-drag-preview ui-surface-card ui-surface-card--inner">
                    <div className="block-header">
                      <div className="rotation-entry-main">
                        <h4 className="highlight">{draggedNode.type === 'repeat' ? 'Repeat' : 'Uptime'}</h4>
                        <span className="rotation-entry-sub">
                          {draggedNode.type === 'repeat'
                            ? `${typeof draggedNode.times === 'number' ? draggedNode.times : '?'}× · ${draggedNode.items.length} item${draggedNode.items.length !== 1 ? 's' : ''}`
                            : `${Math.round((typeof draggedNode.ratio === 'number' ? draggedNode.ratio : 1) * 100)}% · ${draggedNode.items.length} item${draggedNode.items.length !== 1 ? 's' : ''}`}
                        </span>
                      </div>
                    </div>
                  </article>
                ) : null}
              </div>,
            dragPrvwPrtl,
          )
        : null}

      <input
          ref={mprtFileNptR}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={onMprtRttn}
      />
      </section>
    </ContextTrigger>
  )
}
