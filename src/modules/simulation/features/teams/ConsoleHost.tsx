/*
  Author: Runor Ewhro
  Description: Owns console host behavior and state transitions for the teams module.
*/

import { Suspense, lazy, useCallback, useEffect, type CSSProperties } from 'react'
import { useTeamCnsl } from '@/modules/simulation/features/teams/lib/teamConsoleStore.ts'
import { useMemberModel } from '@/modules/simulation/features/teams/lib/useMemberModel.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { ATTR_COLORS } from '@/modules/simulation/model/display.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'

/*
  the console is the stage in a frame. the stage is the heavy half, so it is the
  half that loads late; the frame is drawn here, where the modal's own state
  already lives.
*/
const MemberStage = lazy(async () => ({
  default: (await import('@/modules/simulation/features/teams/stage/MemberStage.tsx')).MemberStage,
}))

// Load the console only after a request and retain it until close completion.
export function TeamConsoleHost() {
  const target = useTeamCnsl((state) => state.target)

  if (!target) {
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
  const model = useMemberModel(resonatorId, scenarioId)
  const { member, memberRt, actRt } = model

  const { closing, hide, open, show, visible } = useAppModal()

  useEffect(() => {
    show()
  }, [show])

  const closeConsole = useCallback(() => {
    hide(() => {
      closeRequest()
    })
  }, [closeRequest, hide])

  // Close if the requested member leaves the current runtime graph.
  useEffect(() => {
    if (visible && !closing && (!member || !memberRt || !actRt)) {
      closeConsole()
    }
  }, [actRt, closeConsole, closing, member, memberRt, visible])

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
