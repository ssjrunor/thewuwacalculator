/*
  Author: Runor Ewhro
  Description: Reads the opening states the preamble is about to write and asks
               which resonator starts on field before it writes them.
*/

import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { ModalFrame } from '@/modules/simulation/features/rotation/program-editor/components/AuthoringModals.tsx'
import { withDefResMg } from '@/shared/lib/imageFallback.ts'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay.ts'
import type { EditorMember } from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import type { OpeningState } from '@/modules/simulation/features/rotation/program-editor/model/nodeAuthoring.ts'

interface StateGroup {
  member: EditorMember
  states: OpeningState[]
}

export function StartMemberModal({
  visible,
  open,
  closing = false,
  portalTarget,
  members,
  activeId,
  states,
  onClose,
  onConfirm,
}: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  members: EditorMember[]
  activeId: string
  states: OpeningState[]
  onClose: () => void
  onConfirm: (memberId: string) => void
}) {
  const [picked, setPicked] = useState(() => activeId || members[0]?.id || '')

  /*
    the rail stands every member, including one whose states are all already
    written, because it is also the control for who starts.
  */
  const groups = useMemo<StateGroup[]>(
    () => members.map((member) => ({
      member,
      states: states.filter((state) => state.resonatorId === member.id),
    })),
    [members, states],
  )

  if (!visible) {
    return null
  }

  const choice = members.some((member) => member.id === picked)
    ? picked
    : members[0]?.id ?? ''

  return (
    <ModalFrame
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      over="Preamble"
      title="Set the opening"
      onClose={onClose}
      bodyClssName="zmk"
      footer={(
        <footer className="amdl__foot">
          <span className="zmk__tally">
            {states.length} {states.length === 1 ? 'state' : 'states'}
            {' · '}
            {members.length} resonators
          </span>
          <span className="amdl__fill" />
          <button type="button" className="amdl__act" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button" className="amdl__act is-go"
            disabled={!choice}
            onClick={() => onConfirm(choice)}
          >
            Generate
          </button>
        </footer>
      )}
    >
      <div className="zmk__rail">
        {groups.map(({ member, states: owned }) => (
          <div
            key={member.id}
            className={member.id === choice ? 'zmk__grp is-on' : 'zmk__grp'}
            style={{ '--zmk-tone': ATTR_COLORS[member.attribute] } as CSSProperties}
          >
            <div className="zmk__who">
              <span className="zmk__mark">
                <img src={member.profile} alt="" onError={withDefResMg} />
              </span>
              <span className="zmk__name">{member.name}</span>
              <span className="zmk__count">
                {owned.length} {owned.length === 1 ? 'state' : 'states'}
              </span>
            </div>

            {owned.map((state) => (
              <div key={state.key} className="zmk__state">
                <span className="zmk__label" title={state.sourceName}>{state.label}</span>
                <span className="zmk__value">{state.value}</span>
              </div>
            ))}
          </div>
        ))}

        {/*
          the end of the rail sticks to the foot of the list: it is the one
          control the modal has, and a full team's opening states run well past
          the body's height.
        */}
        <div className="zmk__start">
          <span className="zmk__mark zmk__mark--start"><i /></span>
          <span className="zmk__lead">Starts on field</span>
          <div className="zmk__seats" role="radiogroup" aria-label="Starting resonator">
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                role="radio"
                aria-checked={member.id === choice}
                className={member.id === choice ? 'zmk__seat is-on' : 'zmk__seat'}
                onClick={() => setPicked(member.id)}
              >
                <img src={member.profile} alt="" onError={withDefResMg} />
                <span>{member.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}
