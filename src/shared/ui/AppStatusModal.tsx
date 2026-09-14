/*
  Author: Runor Ewhro
  Description: Owns app status modal behavior and state transitions for the ui module.
*/

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavX } from '@/app/nav/useNavX'
import { listResonators, listEchoes } from '@/domain/services/catalogService'
import { getWeapons } from '@/data/gameData/weapons/weaponDataStore'
import { SONATA_SETS } from '@/data/gameData/catalog/sonataSets'
import { loadEnemyCat } from '@/domain/services/enemyCatalogService'
import { AppModal } from '@/shared/ui/AppModal'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { Tooltip } from '@/shared/ui/Tooltip'
import { getLinkedWhatsNew, ltstCurChngE } from '@/data/content/changelogEntries'
import { STATE_LABELS, STATUS_DATA } from '@/data/content/appStatus'
import { whatsNewHref } from '@/shared/lib/appRoutes'

// kept re-exported so the head's stamp keeps its one import
export { APP_CONDITION } from '@/data/content/appStatus'

interface AppSttsMdlPr {
  visible: boolean
  open: boolean
  closing?: boolean
  onClose: () => void
}

export function AppSttsMdl({ visible, open, closing = false, onClose }: AppSttsMdlPr) {
  const navigate = useNavX()
  const linkedWhatsNew = getLinkedWhatsNew(ltstCurChngE)
  const latestRoute = linkedWhatsNew ? whatsNewHref() : '/changelog'
  const latestLabel = linkedWhatsNew ? "See What's New" : 'See Changelog'
  // the enemy catalog is fetched, so its count arrives after the rest
  const [enemyCount, setEnemyCount] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    void loadEnemyCat()
      .then((entries) => { if (live) setEnemyCount(entries.length) })
      .catch(() => { if (live) setEnemyCount(null) })
    return () => { live = false }
  }, [])

  const catalogSize: Record<string, number | null> = {
    resonators: listResonators().length,
    weapons: getWeapons().length,
    echoes: listEchoes().length,
    enemies: enemyCount,
  }

  const coveredCount = STATUS_DATA.coverage.filter((item) => item.status === 'ok').length
  const downDomains = STATUS_DATA.coverage.filter((item) => item.status !== 'ok').map((item) => item.title)

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="app-status"
      ariaLabel="Simulation Status"
      onClose={onClose}
    >
      <ModalHeader over="Simulation Status" title="System Report" onClose={onClose}>
        <span className={`amdl__tag${STATUS_DATA.overallState === 'stable' ? ' is-accent' : ''}`}>
          {STATE_LABELS[STATUS_DATA.overallState]}
        </span>
      </ModalHeader>

      <div className="dsp-wrap">
        {STATUS_DATA.wallpaper ? (
          <>
            <span className="dsp__art"
              style={{
                backgroundImage: `url("${STATUS_DATA.wallpaper.src}")`,
                backgroundPosition: STATUS_DATA.wallpaper.pos,
                '--dsp-art-dir': STATUS_DATA.wallpaper.dir,
              } as CSSProperties}
              aria-hidden="true"
            />
          </>
        ) : null}

        <div className="dsp">
          <div className="dsp__from">
            <span className={`amdl__dot${STATUS_DATA.overallState === 'stable' ? '' : ' is-warn'}`} aria-hidden="true" />
            From the dev · {STATUS_DATA.lastUpdated}
          </div>

          <div className="dsp__lines">
            {STATUS_DATA.notes.map((note, i) => (
              i === 0
                ? <p key={i} className="dsp__hey">{note}</p>
                : <p key={i} className="dsp__line">{note}</p>
            ))}
          </div>

          {STATUS_DATA.recentChanges.length > 0 ? (
            <div className="dsp__latest">
              <b>{STATUS_DATA.recentChanges.length === 1 ? 'Latest' : 'Lately'}</b>
              <ul className="dsp__latest-list">
                {STATUS_DATA.recentChanges.map((entry, i) => <li key={i}>{entry}</li>)}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="dsp__stamp">
          <span>PATCH <b>v{STATUS_DATA.patchVersion}</b></span>
          <span className="dsp__sep">·</span>

          <Tooltip
            placement="top"
            content={
              <div className="cov">
                <div className="cov__head">
                  <b>Coverage</b>
                  <i className={downDomains.length > 0 ? 'is-down' : undefined}>
                    {downDomains.length > 0
                      ? `${coveredCount} of ${STATUS_DATA.coverage.length}`
                      : 'all current'}
                  </i>
                </div>
                {STATUS_DATA.coverage.map((item) => {
                  const size = catalogSize[item.key]
                  return (
                    <div key={item.key} className="cov__row">
                    <span className="cov__k">
                      {item.title}
                      {item.status !== 'ok' && item.note ? <em>{item.note}</em> : null}
                    </span>
                      <span className={`cov__n${item.status === 'ok' ? '' : ' is-down'}`}>
                      {size === null ? '—' : size.toLocaleString()}
                        {item.key === 'echoes' ? <u>· {SONATA_SETS.length} sets</u> : null}
                    </span>
                    </div>
                  )
                })}
                <div className="cov__foot">
                  <span className={`amdl__dot${downDomains.length > 0 ? ' is-warn' : ''}`} aria-hidden="true" />
                  Patch {STATUS_DATA.patchVersion} · ingested {STATUS_DATA.lastUpdated}
                </div>
              </div>
            }
          >
          <span className="dsp__probe" tabIndex={0}>
            COVERAGE{' '}
            <b className={downDomains.length > 0 ? 'is-down' : undefined}>
              {coveredCount}/{STATUS_DATA.coverage.length}
            </b>
          </span>
          </Tooltip>

          <span className="dsp__sep">·</span>

          {STATUS_DATA.knownIssues.length > 0 ? (
            <Tooltip
              placement="top"
              content={
                <ul className="dsp__tip">
                  {STATUS_DATA.knownIssues.map((issue, i) => (
                    <li key={i}>
                      <span className="amdl__dot is-warn" aria-hidden="true" />
                      <span>{issue}</span>
                    </li>
                  ))}
                </ul>
              }
            >
            <span className="dsp__probe" tabIndex={0}>
              ISSUES <b className="is-down">{STATUS_DATA.knownIssues.length}</b>
            </span>
            </Tooltip>
          ) : (
            <span>ISSUES <b>0</b></span>
          )}

          <span className="dsp__sep">·</span>
          <span>
          VIA{' '}
            {STATUS_DATA.dataSources.map((source, i) => (
              <span key={source.label}>
              {i > 0 ? ', ' : ''}
                <a className="dsp__link" href={source.href} target="_blank" rel="noopener noreferrer">
                {source.label}
              </a>
            </span>
            ))}
        </span>
        </div>

      </div>

      <div className="amdl__foot">
        <button
          type="button" className="amdl__act"
          onClick={onClose}
        >
          Close
        </button>
        <button
          type="button" className="amdl__act"
          onClick={() => { navigate(latestRoute); onClose() }}
        >
          {latestLabel}
        </button>
      </div>
    </AppModal>
  )
}
