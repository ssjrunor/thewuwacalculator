/*
  Author: Runor Ewhro
  Description: Resolves requested scenario members, lazily loads their editor,
               and retains the console session through close completion.
*/

import { Suspense, lazy, useCallback, useEffect, type CSSProperties } from 'react'
import { useTeamCnsl } from '@/modules/simulation/features/teams/lib/teamConsoleStore.ts'
import { useMemberModel } from '@/modules/simulation/features/teams/lib/useMemberModel.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { ATTR_COLORS } from '@/modules/simulation/model/display.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import type { CombatScenario } from '@/domain/entities/combatScenario.ts'
import { useAppStore } from '@/application/state'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'
import { useInventoryLease } from '@/application/hooks/useInventoryLease.ts'
import { holdResonatorData } from '@/data/gameData'
import { useResonatorData } from '@/application/hooks/useResonatorData'

// Defer the member-editor module while keeping modal lifecycle state in this host.
const MemberStage = lazy(async () => ({
  default: (await import('@/modules/simulation/features/teams/stage/MemberStage.tsx')).MemberStage,
}))

// Load the console only after a request and retain it until close completion.
export function TeamConsoleHost() {
  const target = useTeamCnsl((state) => state.target)
  useInventoryLease(Boolean(target))
  const scenario = useAppStore((state) => target
    ? state.combat.scenariosById[target.scenarioId ?? state.combat.selectedScenarioId]
    : null)
  const ready = useResonatorData(scenario?.team.members.map((member) => member.resonatorId) ?? [])

  if (!target || !ready) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <ConsoleView
        resonatorId={target.resonatorId}
        scenarioId={target.scenarioId}
      />
    </Suspense>
  )
}

function ConsoleView({
  resonatorId,
  scenarioId,
}: {
  resonatorId: string
  scenarioId?: CombatScenarioId | null
}) {
  const channel = useTeamCnsl((state) => state.target?.channel ?? 'loadout')
  const switchMember = useTeamCnsl((state) => state.switchMember)
  const setChannel = useTeamCnsl((state) => state.setChannel)
  const closeRequest = useTeamCnsl((state) => state.close)
  const selectedScenarioId = useAppStore((state) => state.combat.selectedScenarioId)
  const resolvedScenarioId = scenarioId ?? selectedScenarioId
  const sourceScenario = useAppStore((state) => state.combat.scenariosById[resolvedScenarioId] ?? null)
  const commitScenarioConfig = useAppStore((state) => state.commitScenarioConfig)
  const session = useConfigurationSession<CombatScenario | null>({
    source: sourceScenario,
    commit: (reducer) => commitScenarioConfig(
      resolvedScenarioId,
      (current) => reducer(current) ?? current,
      'Updated Team Configuration',
    ),
  })
  const draftMembers = session.draft?.team.members
  useEffect(() => draftMembers
    ? holdResonatorData(draftMembers.map((member) => member.resonatorId))
    : undefined, [draftMembers])
  const model = useMemberModel(
    resonatorId,
    resolvedScenarioId,
    session.draft
      ? { scenario: session.draft, updateScenario: session.update as (updater: (scenario: CombatScenario) => CombatScenario) => void }
      : undefined,
  )
  const { member, memberRt, actRt } = model

  const { closing, hide, open, show, visible } = useAppModal()

  useEffect(() => {
    show()
  }, [show])

  const closeConsole = useCallback(() => {
    hide(() => {
      session.finish()
      closeRequest()
    })
  }, [closeRequest, hide, session])

  // A removed teammate may still be the requested view for one render. Follow
  // the surviving context resonator instead of treating that as a close.
  useEffect(() => {
    if (!visible || closing) return
    if (!actRt) {
      closeConsole()
    } else if (!member || !memberRt) {
      if (resonatorId === actRt.id) closeConsole()
      else switchMember(actRt.id)
    }
  }, [actRt, closeConsole, closing, member, memberRt, resonatorId, switchMember, visible])

  if (!member || !memberRt || !actRt || !visible) {
    return null
  }

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="team-config"
      ariaLabelBy="teammate-config-title"
      style={{
        '--modal-accent': ATTR_COLORS[member.attribute],
        '--mcc-accent': ATTR_COLORS[member.attribute],
        '--resonator-accent': ATTR_COLORS[member.attribute],
      } as CSSProperties}
      onClose={closeConsole}
    >
      <MemberStage
        portalTarget={mainPortal()}
        member={member}
        roster={model.roster}
        runtime={memberRt}
        actRt={actRt}
        isActive={model.isActive}
        invBlds={model.invBlds}
        sttDefs={model.sttDefs}
        cmbtSttsView={model.cmbtSttsView}
        channel={channel}
        onSwitchMember={switchMember}
        onSetTeamMember={model.setTeamMember}
        onSetTeam={model.setTeam}
        onChannelChange={setChannel}
        onSqncChng={model.onSqncChng}
        onRtPdt={model.onRtPdt}
        getSelTgt={model.getSelTgt}
        setSelTgt={model.setSelTgt}
        onClose={closeConsole}
      />
    </AppModal>
  )
}
