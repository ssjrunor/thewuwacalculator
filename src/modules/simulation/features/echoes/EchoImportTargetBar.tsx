/*
  Author: Runor Ewhro
  Description: Displays standalone context builds and active-team instances as
               separate import destinations. The same resonator can appear in
               both groups without collapsing its two runtimes together.
*/

import type { CSSProperties } from 'react'
import { Plus } from 'lucide-react'
import type { ResView } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display.ts'
import { withDefResMg } from '@/shared/lib/imageFallback.ts'

interface TeamDestination {
  member: ResView
  slotIndex: number
}

interface EchoImportTargetBarProps {
  contexts: ResView[]
  selectedContextId: string | null
  team: TeamDestination[]
  selectedTeamSlot: number | null
  canAddTeammate: boolean
  onSelectContext: (resonatorId: string) => void
  onSelectTeam: (slotIndex: number, resonatorId: string) => void
  onAddContext: () => void
  onAddTeammate: () => void
}

export function EchoImportTargetBar({
  contexts,
  selectedContextId,
  team,
  selectedTeamSlot,
  canAddTeammate,
  onSelectContext,
  onSelectTeam,
  onAddContext,
  onAddTeammate,
}: EchoImportTargetBarProps) {
  return (
    <div className="echo-import-targets">
      <div className="echo-import-target-group">
        <div className="mcc-switch" role="group" aria-label="Context import destination">
          {contexts.map((member) => {
            const selected = member.id === selectedContextId
            const label = selected
              ? `${member.name} context (import destination)`
              : `Import to ${member.name} context`

            return (
              <button
                key={member.id}
                type="button"
                className={`mcc-switch-chip${selected ? ' active' : ''}`}
                style={{ '--mcc-switch-accent': ATTR_COLORS[member.attribute] } as CSSProperties}
                aria-pressed={selected}
                aria-label={label}
                title={label}
                onClick={() => onSelectContext(member.id)}
              >
                <img src={member.profile} alt="" onError={withDefResMg} />
              </button>
            )
          })}
          <button
            type="button" className="mcc-switch-chip is-empty"
            aria-label="Add context import destination"
            title="Choose another resonator context"
            onClick={onAddContext}
          >
            <Plus size="0.9rem" aria-hidden="true" />
          </button>
        </div>
      </div>

      {team.length > 0 ? (
        <div className="echo-import-target-group">
          <div className="mcc-switch" role="group" aria-label="Team import destination">
            {team.map(({ member, slotIndex }) => {
              const selected = slotIndex === selectedTeamSlot
              const label = selected
                ? `${member.name} team instance (import destination)`
                : `Import to ${member.name} team instance`

              return (
                <button
                  key={`${slotIndex}:${member.id}`}
                  type="button"
                  className={`mcc-switch-chip${selected ? ' active' : ''}`}
                  style={{ '--mcc-switch-accent': ATTR_COLORS[member.attribute] } as CSSProperties}
                  aria-pressed={selected}
                  aria-label={label}
                  title={label}
                  onClick={() => onSelectTeam(slotIndex, member.id)}
                >
                  <img src={member.profile} alt="" onError={withDefResMg} />
                </button>
              )
            })}
            {canAddTeammate ? (
              <button
                type="button" className="mcc-switch-chip is-empty"
                aria-label="Add teammate import destination"
                title="Add a teammate and import to that team instance"
                onClick={onAddTeammate}
              >
                <Plus size="0.9rem" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
