/*
  Author: Runor Ewhro
  Description: Summarizes an echo's stat rolls into a compact preview row used
               by menus and comparison popovers.
*/

import { useMemo } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import { cmptEchoCrit, getCvBdgClss, getScrBdgCls } from '@/modules/calculator/features/echoes/lib/metric'
import { getEchoScrPr, getMaxEchoSc } from '@/data/scoring/echoScoring'
import { fmtStatKeyLb, fmtStatKeyVl } from '@/modules/calculator/features/overview/lib/stats'

interface EchoStatProps {
  echo: EchoInstance
  resonatorId: string
}

export function EchoStatPreview({ echo, resonatorId }: EchoStatProps) {
  const { score, scoreShown } = useMemo(() => {
    const hasWeights = getMaxEchoSc(resonatorId) > 0
    return {
      scoreShown: hasWeights,
      score: hasWeights ? getEchoScrPr(resonatorId, echo) : 0,
    }
  }, [resonatorId, echo])

  const cv = useMemo(() => cmptEchoCrit(echo.substats), [echo.substats])

  const substats = useMemo(
    () => Object.entries(echo.substats).filter(([, value]) => Number.isFinite(value) && value !== 0),
    [echo.substats],
  )

  return (
    <div className="echo-stat-preview">
      <div className="echo-stat-preview__head">
        {scoreShown ? (
          <span className={`echo-stat-preview__badge ${getScrBdgCls(score)}`}>
            <span className="echo-stat-preview__badge-key">Score</span>
            <span className="echo-stat-preview__badge-value">{score.toFixed(1)}%</span>
          </span>
        ) : null}
        <span className={`echo-stat-preview__badge ${getCvBdgClss(cv)}`}>
          <span className="echo-stat-preview__badge-key">CV</span>
          <span className="echo-stat-preview__badge-value">{cv.toFixed(1)}</span>
        </span>
      </div>

      <div className="echo-stat-preview__group">
        <span className="echo-stat-preview__group-label">Primary</span>
        <div className="echo-stat-preview__row">
          <span className="echo-stat-preview__row-label">{fmtStatKeyLb(echo.mainStats.primary.key)}</span>
          <span className="echo-stat-preview__row-value">
            {fmtStatKeyVl(echo.mainStats.primary.key, echo.mainStats.primary.value)}
          </span>
        </div>
      </div>

      <div className="echo-stat-preview__group">
        <span className="echo-stat-preview__group-label">Secondary</span>
        <div className="echo-stat-preview__row">
          <span className="echo-stat-preview__row-label">{fmtStatKeyLb(echo.mainStats.secondary.key)}</span>
          <span className="echo-stat-preview__row-value">
            {fmtStatKeyVl(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}
          </span>
        </div>
      </div>

      {substats.length > 0 ? (
        <div className="echo-stat-preview__group">
          <span className="echo-stat-preview__group-label">Substats</span>
          <div className="echo-stat-preview__substats">
            {substats.map(([key, value]) => (
              <div key={key} className="echo-stat-preview__row">
                <span className="echo-stat-preview__row-label">{fmtStatKeyLb(key)}</span>
                <span className="echo-stat-preview__row-value">{fmtStatKeyVl(key, value)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
