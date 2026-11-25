/*
  Author: Runor Ewhro
  description: one scenario's rotation as a waterfall. each attack has its own
               row starting where the previous one ended, so the bars sum to the
               whole DPR. rows are grouped by skill type, largest first, each in
               its fixed colour.
*/

import { useMemo, type CSSProperties } from 'react'
import type { ScoredContribution } from '@/domain/leaderboard/api'
import { makeFeatureGroups } from '@/engine/evaluation/echoDiscovery'
import { getPrimarySkill, getSkillType } from '@/domain/gameData/skillTypes'
import { RES_NODE_KEYS, resNodeIcon, type ResNodeKey } from '@/shared/lib/gameAssets'
import { groupRotationFeatureRows } from '@/modules/simulation/surfaces/modulation/evaluationFeatureDisplay'
import { grp, pct1 } from '../../model/format'
import { skillTypeColor } from '../../lib/skillColors'

const isNode = (tab: string): tab is ResNodeKey => (RES_NODE_KEYS as readonly string[]).includes(tab)

interface Fall { id: string; label: string; share: number; damage: number; x: number; glyph: string | null }
interface Group { key: string; label: string; color: string; share: number; damage: number; rows: Fall[] }

export function AttackFall({ resonatorId, contribution }: { resonatorId: string; contribution: ScoredContribution }) {
  const groups = useMemo<Group[]>(() => {
    const ranked = groupRotationFeatureRows(contribution.features)
    const total = contribution.damage
    const out: Group[] = []
    let x = 0
    for (const type of makeFeatureGroups(ranked).skillTypes) {
      const label = getSkillType(type.skillType ?? type.key).label
      const rows: Fall[] = []
      for (const row of ranked) {
        if ((getPrimarySkill(row.skillType) ?? 'feature') !== type.key) continue
        rows.push({
          id: row.skillId, share: row.sharePct, damage: total * row.sharePct / 100, x,
          // the group names the type, so strip the repeated "Basic Attack - " from its rows
          label: row.label.startsWith(`${label} - `) ? row.label.slice(label.length + 3) : row.label,
          glyph: isNode(row.tab) ? resNodeIcon(resonatorId, row.tab) : null,
        })
        x += row.sharePct
      }
      out.push({ key: type.key, label, color: skillTypeColor(type.key), share: type.sharePct, damage: total * type.sharePct / 100, rows })
    }
    return out
  }, [contribution, resonatorId])

  if (!groups.length) return <p className="afl-none">hmm... no attack breakdown is available for this team and weapon yet.</p>
  return (
    <div className="afl">
      {groups.map((group) => (
        <div key={group.key} className="afl-g" style={{ '--c': group.color } as CSSProperties}>
          <div className="afl-k"><b><i />{group.label}</b><span>{pct1(group.share)}<em>{grp(group.damage)}</em></span></div>
          <div className="afl-rows">
            {group.rows.map((row) => (
              <div key={row.id} className="afl-r" style={{ '--x': `${row.x}%`, '--w': `${row.share}%` } as CSSProperties}
                title={`${row.label}: ${grp(row.damage)} DPR, ${pct1(row.share)}`}>
                <span className="afl-sg">{row.glyph && row.share > 2.2 ? <i style={{ '--g': `url(${row.glyph})` } as CSSProperties} /> : null}</span>
                {/* a label takes the side of its bar with more room. */}
                <span className={`afl-lb ${100 - row.x - row.share >= row.x ? 'r' : 'l'}`}><span>{row.label}</span><em>{pct1(row.share)}</em><b>{grp(row.damage)}</b></span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="afl-axis"><span>0</span><span style={{ left: '50%' }}>{grp(contribution.damage / 2)}</span><span style={{ left: '100%' }}>{grp(contribution.damage)} DPR</span></div>
    </div>
  )
}
