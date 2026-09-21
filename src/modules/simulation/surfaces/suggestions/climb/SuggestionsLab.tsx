/*
  Author: Runor Ewhro
  Description: Coordinates suggestion search state, candidate previews, and
               application of selected Echo, set-plan, or weapon results.
*/

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/application/state'
import { selEnemyProf, selVrvwDrvd, selWorkDrvd } from '@/application/state'
import { selLiveRun } from '@/modules/simulation/model/selectors.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { DEF_SET_COND } from '@/domain/entities/sonataSetConditionals.ts'
import { cloneEchoLoadout } from '@/domain/entities/inventoryStorage.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import type { PickFreqWeapon } from '@/domain/entities/appState.ts'
import { getResonator, WPNTYPETOKEY } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { LoadoutHead } from '@/modules/simulation/workspace/LoadoutHead.tsx'
import { EchoCard } from '@/modules/simulation/workspace/ui.tsx'
import { makeEchoSlot } from '@/modules/simulation/workspace/echoSlot.ts'
import { useEchoScores } from '@/engine/evaluation/useEchoScoringRevision.ts'
import { useEchoSrfcM } from '@/modules/simulation/features/echoes/lib/useEchoSurfaceMenu.tsx'
import { useSuggRuns } from '@/modules/simulation/surfaces/suggestions/lib/useSuggRuns.ts'
import { smmrCurSetPl } from '@/modules/simulation/surfaces/suggestions/lib/suggestions.ts'
import { Climb } from '@/modules/simulation/surfaces/suggestions/climb/Climb.tsx'
import {
  climbRows,
  isClimbKind,
  materializeWeaponSuggestion,
  wornMainStats,
  type ClimbKind,
  type ClimbRow,
} from '@/modules/simulation/surfaces/suggestions/climb/model.ts'
import { WpnCfgMdl } from '@/modules/simulation/surfaces/suggestions/WeaponConfig.tsx'
import { SetCond } from '@/modules/simulation/features/controls/SetConditional.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'

const EMPTY_ECHOES: Array<EchoInstance | null> = []

export function SuggestionsLab() {
  const enemyProfile = useAppStore(selEnemyProf)
  const { prepWork } = useAppStore(useShallow(selWorkDrvd))
  const { actRt: runtime, partRtsById } = useAppStore(useShallow(selVrvwDrvd))
  const simulation = useMemo(() => selLiveRun(prepWork), [prepWork])
  const setConds = useAppStore((state) => (
    selectedCombatScenario(state.combat).team.members.find(
      (member) => member.resonatorId === runtime?.id,
    )?.local.setConditionals ?? DEF_SET_COND
  ))
  const updActResRt = useAppStore((state) => state.updActRt)
  const updActResSug = useAppStore((state) => state.updActSuggs)
  const updResSetCon = useAppStore((state) => state.updActConds)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const storedMode = useAppStore((state) => state.ui.suggsViewMode)
  const setSugView = useAppStore((state) => state.setSugView)
  const kind: ClimbKind = isClimbKind(storedMode) ? storedMode : 'mainStats'

  const [held, setHeld] = useState(0)
  const setCondsMdl = useAppModal()
  const wpnCondMdl = useAppModal()
  const portalTarget = mainPortal()

  const subject = runtime ? getResonator(runtime.id) : null

  const search = useSuggRuns({
    runtime: runtime!,
    simulation,
    enemyProfile,
    prtcRntmById: partRtsById,
    setConds,
    mode: kind,
  })

  const onSelectResults = search.onSelectResults
  const resetHeld = useCallback(() => setHeld(0), [])
  useEffect(() => {
    onSelectResults(resetHeld)
    return () => onSelectResults(null)
  }, [onSelectResults, resetHeld])

  const echoes = runtime?.build.echoes ?? EMPTY_ECHOES
  const worn = useMemo(() => wornMainStats(echoes), [echoes])
  const wornSetPlan = useMemo(() => smmrCurSetPl(echoes), [echoes])
  const rows = useMemo<ClimbRow[]>(() => climbRows({
    kind,
    mainStatRslt: search.mainStatRslt,
    setPlanRslt: search.setPlanRslt,
    wpnRslt: search.wpnRslt,
    base: search.baseDamage,
    echoes,
    worn,
    wornSetPlan,
    runtime: runtime!,
  }), [
    echoes,
    kind,
    runtime,
    search.baseDamage,
    search.mainStatRslt,
    search.setPlanRslt,
    search.wpnRslt,
    worn,
    wornSetPlan,
  ])

  const heldRow = rows[held] ?? null
  const preview = heldRow && !heldRow.now ? heldRow.echoes : null
  const stripEchoes = preview ?? echoes
  const echoScores = useEchoScores(runtime?.id ?? null, stripEchoes)
  const loadoutSlots = useMemo(
    () => stripEchoes.map((echo) => (echo ? makeEchoSlot(echo) : null)),
    [stripEchoes],
  )

  const applyRow = useCallback((row: ClimbRow) => {
    if (row.weapon) {
      const plan = row.weapon
      const wpnKey = (
        WPNTYPETOKEY[subject?.weaponType ?? 4] ?? 'gauntlets'
      ) as PickFreqWeapon

      updActResRt((curRt) => materializeWeaponSuggestion(curRt, plan))

      bumpPickerFreq({ bucket: 'weapon', weaponType: wpnKey, ids: [plan.weaponId] })
      return
    }

    if (!row.echoes) return
    const next: Array<EchoInstance | null> = cloneEchoLoadout(row.echoes)
    updActResRt((curRt) => ({
      ...curRt,
      build: { ...curRt.build, echoes: next },
    }))
  }, [bumpPickerFreq, subject?.weaponType, updActResRt])

  const writeEchoes = useCallback((next: Array<EchoInstance | null>) => {
    updActResRt((curRt) => ({
      ...curRt,
      build: { ...curRt.build, echoes: cloneEchoLoadout(next) },
    }))
  }, [updActResRt])

  const echoSurface = useEchoSrfcM({
    clpbSrcResId: runtime?.id ?? '',
    clipSourceName: subject?.name ?? "",
    currentEchoes: echoes,
    onQpEchoAtjg: () => undefined,
  })

  const onTarget = useCallback((value: string) => {
    updActResSug((state) => ({
      ...state,
      settings: {
        ...state.settings,
        rotationMode: value === 'rotation',
        targetFeatureId: value === 'rotation' ? state.settings.targetFeatureId : value,
      },
    }))
  }, [updActResSug])

  if (!runtime) return null

  return (
    <main className="workspace-main" data-phase="idle">
      <section className="workspace-section workspace-span workspace-ink">
        <LoadoutHead
          title="Echo Loadout"
          runtime={runtime}
          resonatorName={subject?.name ?? null}
          echoes={stripEchoes}
          proposal={preview != null}
          editable={preview == null}
          canSaveEcho={echoSurface.canSaveEcho}
          onEchoes={preview == null ? writeEchoes : undefined}
          onEquip={preview && heldRow ? () => applyRow(heldRow) : undefined}
        />
        <div className="workspace-echoes sgl-strip" data-preview={preview ? '' : undefined}>
          {Array.from({ length: 5 }, (_, index) => {
            const proposed = preview?.[index] ?? null
            const worn = echoes[index] ?? null
            const moved = preview != null && (
              proposed?.mainStats.primary.key !== worn?.mainStats.primary.key
              || proposed?.set !== worn?.set
            )

            return (
              <div
                key={index} className="sgl-slot"
                data-moved={moved ? '' : undefined}
                data-quiet={preview != null && !moved ? '' : undefined}
              >
                <EchoCard
                  echo={loadoutSlots[index] ?? null}
                  sourceEcho={stripEchoes[index] ?? null}
                  index={index}
                  score={echoScores?.[index] ?? null}
                  unpainted={Boolean(moved)}
                />
              </div>
            )
          })}
        </div>
      </section>

      <section className="workspace-section workspace-span workspace-ink sgl-run">
        <Climb
          kind={kind}
          onKind={(next) => {
            setHeld(0)
            setSugView(next)
          }}
          counts={{
            mainStats: search.mainStatRslt.length,
            setPlans: search.setPlanRslt.length,
            weapons: new Set(search.wpnRslt.map((plan) => plan.weaponId)).size,
          }}
          rows={rows}
          base={search.baseDamage}
          held={held}
          onHeld={setHeld}
          onApply={applyRow}
          running={
            kind === 'mainStats' ? search.rnnnMainStat
              : kind === 'setPlans' ? search.rnnnSetPlns
                : search.rnnnWpns
          }
          targetValue={search.selTgtVl}
          targetGroups={search.targetSkillGroups}
          onTarget={onTarget}
          wpnSets={search.wpnSets}
          setConds={setConds}
          onOpenConfig={() => (kind === 'weapons' ? wpnCondMdl.show() : setCondsMdl.show())}
        />
      </section>

      <SetCond
        {...setCondsMdl}
        portalTarget={portalTarget}
        onClose={setCondsMdl.hide}
        title="Sonata Set Config"
        setConds={setConds}
        onSetCondsrx={updResSetCon}
      />

      <WpnCfgMdl
        {...wpnCondMdl}
        title="Config - Weapon Search"
        onClose={wpnCondMdl.hide}
        runtime={runtime}
        seed={search.activeSeed}
      />
    </main>
  )
}
