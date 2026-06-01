/*
  Author: Runor Ewhro
  Description: Displays authored resonator skill and trace-node reference data
               inside the calculator's skill-data modal.
*/

import { useMemo, useState } from 'react'
import type { SkillTabKey } from '@/domain/entities/resonator'
import type { ResRuntime } from '@/domain/entities/runtime'
import { AppModal } from '@/shared/ui/AppModal'
import { RichDscr } from '@/shared/ui/RichDescription'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton'
import { getResonator, getResDtls } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { ATTR_COLORS } from '@/modules/calculator/model/display.ts'
import {
  fmtSkllKey,
  mrgDscrKywr,
  skllLblMap,
} from '@/modules/calculator/features/resonator/lib/panel.ts'

interface ResSkllDataM {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  resonatorId: string | null
  runtime: ResRuntime | null
  requestedTab?: SkillTabKey | null
  onClose: () => void
}

export function SkillData({
  visible,
  open,
  closing = false,
  resonatorId,
  runtime,
  requestedTab = null,
  onClose,
}: ResSkllDataM) {
  const resonator = useMemo(() => (resonatorId ? getResonator(resonatorId) : null), [resonatorId])
  const details = useMemo(() => (resonatorId ? getResDtls(resonatorId) : null), [resonatorId])
  const curSldrClr = ATTR_COLORS[resonator?.attribute ?? 'physical'] ?? '#888'
  const [actSkllTab, setActSkllTa] = useState<SkillTabKey>(() => (
    requestedTab ?? 'normalAttack'
  ))

  const rslvActSkllT =
    details?.skillsByTab[actSkllTab]
      ? actSkllTab
      : requestedTab && details?.skillsByTab[requestedTab]
        ? requestedTab
        : (details?.skillTabs[0] ?? actSkllTab)

  const modalSkill = details?.skillsByTab[rslvActSkllT] ?? null
  const tabLevel =
    runtime && rslvActSkllT !== 'outroSkill'
      ? runtime.base.skillLevels[rslvActSkllT]
      : null
  const mltpNdx = typeof tabLevel === 'number' ? tabLevel - 1 : -1

  if (!visible || !resonatorId) {
    return null
  }

  return (
    <AppModal
      state={{ visible, open, closing: closing ?? false }}
      variant="skills"
      ariaLabel="Skill data"
      onClose={onClose}
    >
      <div onClick={(event) => event.stopPropagation()}>
        <div className="app-modal-header">
          <div className="app-modal-header-top">
            <div>
              <div className="panel-overline">Skill Data</div>
              <h3 className="panel-heading-title">{resonator?.name ?? resonatorId}</h3>
            </div>
            <MdlClsBttn onClick={onClose} />
          </div>
        </div>

        <div className="rotation-view-toggle">
          {(details?.skillTabs ?? []).map((tab) => (
            <button
              key={tab}
              type="button"
              className={rslvActSkllT === tab ? 'view-toggle-button active' : 'view-toggle-button'}
              onClick={() => setActSkllTa(tab)}
            >
              {skllLblMap[tab] ?? fmtSkllKey(tab)}
            </button>
          ))}
        </div>

        <div className="skills-modal-content-area">
          {modalSkill ? (
            <>
              <h4>{modalSkill.name}</h4>
              <RichDscr
                description={modalSkill.desc}
                params={modalSkill.param}
                accentColor={curSldrClr}
                xtrKywr={mrgDscrKywr(details?.descriptionKeywords, modalSkill.keywords)}
              />
              {modalSkill.multipliers.length > 0 ? (
                <table className="multipliers-table">
                  <tbody>
                    {modalSkill.multipliers.map((multiplier) => (
                      <tr key={multiplier.id} className="multiplier-row">
                        <td className="multiplier-label">{multiplier.label}</td>
                        <td className="multiplier-value">
                          {mltpNdx >= 0 ? multiplier.values[mltpNdx] ?? 'N/A' : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </>
          ) : (
            <p className="pane-hint">No skill data is available for this tab.</p>
          )}
        </div>
      </div>
    </AppModal>
  )
}
