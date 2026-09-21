/*
  Author: Runor Ewhro
  Description: Owns the review step for a read build card: what the card says,
               beside what the build holds, one band at a time.
*/

import type { ReactNode } from 'react'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { ParsedBuildScreenshot } from '@/engine/echoParser/ocrParsing.ts'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { getWpnById } from '@/data/catalog/weaponCatalogService.ts'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay.ts'
import { cntImprtVls, type ImportBands } from '@/modules/simulation/features/echoes/lib/importApply.ts'
import type { CSSProperties } from 'react'

const SKILL_LABELS: Array<[key: 'normalAttack' | 'resonanceSkill' | 'forteCircuit' | 'resonanceLiberation' | 'introSkill', label: string]> = [
  ['normalAttack', 'NA'],
  ['resonanceSkill', 'Skill'],
  ['resonanceLiberation', 'Lib'],
  ['forteCircuit', 'Forte'],
  ['introSkill', 'Intro'],
]

interface RowPrps {
  label: string
  was: string
  now: ReactNode
  same?: boolean
}

function Row({ label, was, now, same = false }: RowPrps) {
  return (
    <div className={`imp-row${same ? ' is-same' : ''}`}>
      <span className="imp-row__k">{label}</span>
      <span className="imp-row__was">{was}</span>
      <span className="imp-row__new">{now}</span>
    </div>
  )
}

interface BandPrps {
  name: string
  count: string
  on: boolean
  locked?: string
  onToggle: () => void
  children: ReactNode
}

function Band({ name, count, on, locked, onToggle, children }: BandPrps) {
  return (
    <section className={`imp-band${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}>
      <button
        type="button" className="imp-band__head"
        onClick={locked ? undefined : onToggle}
        disabled={Boolean(locked)}
        title={locked}
      >
        <span className="imp-tog" />
        <span className="imp-band__name">{name}</span>
        <span className="imp-band__n">{locked ?? count}</span>
      </button>
      {children}
    </section>
  )
}

interface ImprtRcptPrps {
  read: ParsedBuildScreenshot
  runtime: ResRuntime | null
  bands: ImportBands
  echoRows: ReactNode
  onToggleBand: (band: keyof ImportBands) => void
  onApply: () => void
  onBagAll: () => void
  onDiscard: () => void
  allowDetectedDestination?: boolean
  headerExtra?: ReactNode
  onClose: () => void
}

export function ImportReceipt({
  read,
  runtime,
  bands,
  echoRows,
  onToggleBand,
  onApply,
  onBagAll,
  onDiscard,
  allowDetectedDestination = false,
  headerExtra,
  onClose,
}: ImprtRcptPrps) {
  const openSeed = runtime ? getResSeedBy(runtime.id) : null
  const cardSeed = read.resonator.id ? getResSeedBy(read.resonator.id) : null
  const canUseDetected = !runtime && Boolean(cardSeed) && allowDetectedDestination
  const cardName = cardSeed?.name ?? read.resonator.name ?? 'not recognised'

  const weaponDef = read.weapon.id ? getWpnById(read.weapon.id) : null
  const heldWeapon = runtime?.build.weapon.id ? getWpnById(runtime.build.weapon.id) : null
  const destinationSeed = runtime ? getResSeedBy(runtime.id) : cardSeed
  const weaponMatches = Boolean(weaponDef && destinationSeed && weaponDef.weaponType === destinationSeed.weaponType)

  const onBands: ImportBands = {
    resonator: bands.resonator && Boolean(runtime || canUseDetected),
    weapon: bands.weapon && weaponMatches,
    echoes: bands.echoes,
  }
  const liveCount = [onBands.resonator, onBands.weapon, onBands.echoes].filter(Boolean).length
  const values = cntImprtVls(read, onBands)
  const player = [read.player.id, read.player.uid].filter(Boolean).join(' · ')

  const accent = cardSeed ? ATTR_COLORS[cardSeed.attribute] : undefined
  const dotStyle = accent ? ({ '--imp-dot': accent } as CSSProperties) : undefined

  return (
    <div className="amdl imp">
      <ModalHeader over="Import" title={<h2>What i found</h2>} onClose={onClose}>
        {player ? <span className="amdl__tag">{player}</span> : null}
        {headerExtra}
      </ModalHeader>

      <div className="imp-dest">
        <span className="imp-who">
          <span className="imp-dot" style={dotStyle} />
          <b>{cardName}</b>
          {cardSeed ? <span>{cardSeed.attribute}</span> : null}
        </span>
        <span className="imp-arrow">into</span>
        <span className="imp-who">
          <b>{openSeed?.name ?? (canUseDetected ? 'detected resonator' : 'no destination')}</b>
          <span>{runtime ? 'open build' : 'optional build import'}</span>
        </span>
      </div>

      <div className="imp-body">
        <Band
          name="Resonator"
          count={`${cntImprtVls(read, { resonator: true, weapon: false, echoes: false })} values`}
          on={onBands.resonator}
          locked={!runtime && !canUseDetected ? 'choose a resonator first' : undefined}
          onToggle={() => onToggleBand('resonator')}
        >
          <div className="imp-rows">
            <Row
              label="Level"
              was={runtime ? `now ${runtime.base.level}` : 'not selected'}
              now={read.resonator.level ?? '—'}
              same={Boolean(runtime && read.resonator.level === runtime.base.level)}
            />
            <Row
              label="Sequence"
              was={runtime ? `now S${runtime.base.sequence}` : 'not selected'}
              now={`S${read.resonator.sequence}`}
              same={Boolean(runtime && read.resonator.sequence === runtime.base.sequence)}
            />
            <div className="imp-row">
              <span className="imp-row__k">Forte levels</span>
              <span className="imp-row__was" />
              <span className="imp-skills">
                {SKILL_LABELS.map(([key, label]) => {
                  const value = read.resonator.skillLevels[key]
                  const changed = value !== null && (!runtime || value !== runtime.base.skillLevels[key])
                  return (
                    <span key={key} className={`imp-sk${changed ? ' is-chg' : ''}`}>
                      {label} <b>{value ?? '—'}</b>
                    </span>
                  )
                })}
              </span>
            </div>
          </div>
        </Band>

        <Band
          name="Weapon"
          count={`${cntImprtVls(read, { resonator: false, weapon: true, echoes: false })} values`}
          on={onBands.weapon}
          locked={!weaponDef
            ? 'weapon not recognised'
            : !weaponMatches
              ? 'weapon type does not match the selected resonator'
              : undefined}
          onToggle={() => onToggleBand('weapon')}
        >
          <div className="imp-rows">
            <Row
              label="Weapon"
              was={runtime ? (heldWeapon ? `now ${heldWeapon.name}` : 'nothing equipped') : 'not selected'}
              now={weaponDef?.name ?? read.weapon.name ?? '—'}
              same={Boolean(runtime && weaponDef && weaponDef.id === runtime.build.weapon.id)}
            />
            <Row
              label="Level"
              was={runtime ? `now ${runtime.build.weapon.level}` : 'not selected'}
              now={read.weapon.level ?? '—'}
              same={Boolean(runtime && read.weapon.level === runtime.build.weapon.level)}
            />
          </div>
        </Band>

        <Band
          name="Echoes"
          count="5 read"
          on={onBands.echoes}
          onToggle={() => onToggleBand('echoes')}
        >
          <div className="imp-echoes">{echoRows}</div>
        </Band>
      </div>

      <footer className="amdl__foot">
        <span className="imp-tally">
          {liveCount === 0
            ? 'Nothing selected'
            : `${liveCount} band${liveCount === 1 ? '' : 's'} · ${values} value${values === 1 ? '' : 's'}`}
        </span>
        <span className="amdl__fill" />
        <button type="button" className="amdl__act" onClick={onDiscard}>Discard</button>
        <button type="button" className="amdl__act" onClick={onBagAll}>Save All</button>
        <button
          type="button" className="amdl__act is-go"
          onClick={onApply}
          disabled={liveCount === 0}
        >
          {runtime ? `Apply to ${openSeed?.name ?? 'this build'}` : 'Load selected bands'}
        </button>
      </footer>
    </div>
  )
}
