/*
  Author: Runor Ewhro
  Description: Owns the build-card import strip: the three moves that produce a
               card, and the group inspector that shows what gets read from it.
*/

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, DragEvent as RctDrgEvt } from 'react'
import type { ReactNode } from 'react'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { hideBrknMg } from '@/shared/lib/imageFallback'
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  getCardReadAreas,
  type CardReadGroup,
} from '@/engine/echoParser/cardRegions'
import {
  getReadFraction,
  type ReadProgress,
  type ReadStage,
} from '@/engine/echoParser/readProgress'

const SAMPLE_CARD = '/assets/app/samples/sample-import-image.png'
const DISCORD_HOME = 'https://discord.gg/wNaauhE4uH'
const DISCORD_OFFICIAL = 'https://discord.gg/wutheringwaves'

const READ_GROUPS: Array<{ id: CardReadGroup; label: string }> = [
  { id: 'resonator', label: 'Resonator' },
  { id: 'echoes', label: 'Echoes' },
  { id: 'weapon', label: 'Weapon' },
  { id: 'player', label: 'Player ID & UID' },
]

const READ_AREAS = getCardReadAreas().map((area) => ({
  group: area.group,
  label: area.slot ? `${area.label} \u00b7 slot ${area.slot}` : area.label,
  style: {
    left: `${(area.region.x / CARD_WIDTH) * 100}%`,
    top: `${(area.region.y / CARD_HEIGHT) * 100}%`,
    width: `${(area.region.width / CARD_WIDTH) * 100}%`,
    height: `${(area.region.height / CARD_HEIGHT) * 100}%`,
  } as CSSProperties,
}))

const WARMING: Partial<Record<ReadStage, string>> = {
  catalog: 'Loading the catalogue',
  worker: 'Starting the reader',
  match: 'Matching the portrait',
}

// what the reader is looking at right now, in the parser's own words
function readNote(progress: ReadProgress | null): string {
  if (!progress) return 'Opening the image'
  const warming = WARMING[progress.stage]
  if (warming) {
    if (progress.stage === 'catalog') {
      return `${progress.note ?? warming} \u00b7 ${progress.done} of ${progress.total}`
    }
    return progress.note ?? warming
  }
  const area = progress.area != null ? READ_AREAS[progress.area] : null
  return area ? `Reading ${area.label}` : 'Reading the card'
}

type StripStep = 1 | 2 | 3

interface CmdChpPrps {
  command: string
}

function CommandChip({ command }: CmdChpPrps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
    } catch {
      return
    }
    setCopied(true)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button
      type="button"
      className={`fls-cmd${copied ? ' is-copied' : ''}`}
      onClick={copy}
      title={`Copy ${command}`}
    >
      <span>{command}</span>
      <small>{copied ? 'copied' : 'copy'}</small>
    </button>
  )
}

interface ImprtStrpPrps {
  error: string | null
  loading: boolean
  progress: ReadProgress | null
  readSrc: string | null
  onFile: (file: File) => void
  onCancel: () => void
  onChoose: () => void
  headerExtra?: ReactNode
  onClose: () => void
}

export function ImportStrip({
  error,
  loading,
  progress,
  readSrc,
  onFile,
  onCancel,
  onChoose,
  headerExtra,
  onClose,
}: ImprtStrpPrps) {
  const [step, setStep] = useState<StripStep | null>(2)
  const [skipped, setSkipped] = useState(false)
  const [group, setGroup] = useState<CardReadGroup | null>(null)
  const [dragging, setDragging] = useState(false)

  // a read only ever reports into the last step, so keep it open while it speaks
  const openStep = loading || error ? 3 : step

  function toggleStep(next: StripStep) {
    setStep((current) => (current === next ? null : next))
  }

  function onDrop(event: RctDrgEvt<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) onFile(file)
  }

  // areas already sampled, so the card fills in behind the reader
  const readCount = loading && progress?.area != null ? progress.area : -1
  const readPct = loading ? Math.round(getReadFraction(progress ?? {
    stage: 'catalog',
    done: 0,
    total: 1,
  }) * 100) : 0

  const status = loading
    ? `${readPct}% \u00b7 this takes about half a minute`
    : error
      ? 'Nothing read'
      : step
        ? `Step ${step} of 3`
        : 'All steps folded'

  return (
    <div className="amdl fls">
      <ModalHeader over="Echoes" title={<h2>Import from a build card</h2>} onClose={onClose}>
        {headerExtra}
      </ModalHeader>

      <div className="fls__body">
        <section className={`fls-step${openStep === 1 ? ' is-open' : ''}${skipped ? ' is-done' : ''}`}>
          <button type="button" className="fls-step__head" onClick={() => toggleStep(1)}>
            <span className="fls-step__n">{skipped ? '✓' : '1'}</span>
            <span className="fls-step__k">
              Bind your account
              <small>Send /bind to the wuwa bot, once</small>
            </span>
            <span className="fls-step__v">{skipped ? 'skipped' : 'once only'}</span>
          </button>
          <div className="fls-step__body">
            <p>
              Send this to the wuwa bot in{' '}
              <a className="fls-link" href={DISCORD_HOME} target="_blank" rel="noopener noreferrer">our Discord</a>
              {' '}or the{' '}
              <a className="fls-link" href={DISCORD_OFFICIAL} target="_blank" rel="noopener noreferrer">official server</a>
              {' '}and follow its reply. You only ever do this once, and nothing about it reaches this site... unfortunately.
            </p>
            <div className="fls-row">
              <CommandChip command="/bind" />
              <button
                type="button" className="amdl__act"
                onClick={() => {
                  setSkipped(true)
                  setStep(2)
                }}
              >
                Already bound
              </button>
            </div>
          </div>
        </section>

        <section className={`fls-step${openStep === 2 ? ' is-open' : ''}`}>
          <button type="button" className="fls-step__head" onClick={() => toggleStep(2)}>
            <span className="fls-step__n">2</span>
            <span className="fls-step__k">
              Make the card
              <small>Send /create and pick a resonator</small>
            </span>
            <span className="fls-step__v">waiting</span>
          </button>
          <div className="fls-step__body">
            <div className="fls-row">
              <CommandChip command="/create" />
              <span className="fls-hint">pick a resonator, save the card at full size</span>
            </div>
            <div className="fls-two">
              <ul className="fls-grp">
                {READ_GROUPS.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={`fls-grp__key${group === entry.id ? ' is-on' : ''}`}
                      onMouseEnter={() => setGroup(entry.id)}
                      onMouseLeave={() => setGroup(null)}
                      onFocus={() => setGroup(entry.id)}
                      onBlur={() => setGroup(null)}
                      onClick={() => setGroup((current) => (current === entry.id ? null : entry.id))}
                    >
                      {entry.label}
                    </button>
                  </li>
                ))}
              </ul>
              <div className={`fls-card${group ? ' is-lit' : ''}`}>
                <img src={SAMPLE_CARD} alt="A build card from the wuwa bot" onError={hideBrknMg} />
                {READ_AREAS.map((area, index) => (
                  <span
                    key={index}
                    className={`fls-card__rg${group === area.group ? ' is-hl' : ''}`}
                    style={area.style}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={`fls-step${openStep === 3 ? ' is-open' : ''}`}>
          <button type="button" className="fls-step__head" onClick={() => toggleStep(3)}>
            <span className="fls-step__n">3</span>
            <span className="fls-step__k">
              {loading ? 'Reading the card' : 'Drop it in'}
              <small>1920 × 1080, uncropped, English</small>
            </span>
            <span className="fls-step__v">{loading ? `${readCount + 1} / ${READ_AREAS.length}` : ''}</span>
          </button>
          <div className="fls-step__body">
            {error ? <p className="echo-parser-error">{error}</p> : null}
            {loading ? (
              <>
                <div className="fls-card is-work">
                  <img src={readSrc ?? SAMPLE_CARD} alt="" onError={hideBrknMg} />
                  {READ_AREAS.map((area, index) => (
                    <span
                      key={index}
                      className={`fls-card__rg${index < readCount ? ' is-read' : ''}${index === readCount ? ' is-now' : ''}`}
                      style={area.style}
                    />
                  ))}
                </div>
                <p className="fls-read" aria-live="polite">{readNote(progress)}</p>
                <div className="fls-meter"><i style={{ width: `${readPct}%` }} /></div>
              </>
            ) : (
            <div
              className={`fls-bay${dragging ? ' is-over' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Drop the card image here"
              onClick={onChoose}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onChoose()
                }
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <div className="fls-bay__in">
                <strong>Drop the card here</strong>
                <span className="fls-hint">paste · or choose a file</span>
              </div>
            </div>
            )}
            {loading ? null : <p className="fls-hint">1920 × 1080 · uncropped · English</p>}
          </div>
        </section>
      </div>

      <footer className="amdl__foot">
        <span className="fls-hint">{status}</span>
        <span className="amdl__fill" />
        {loading ? (
          <button
            type="button" className="amdl__act"
            onClick={() => {
              setStep(3)
              onCancel()
            }}
          >
            Stop reading
          </button>
        ) : (
          <button type="button" className="amdl__act is-go" onClick={onChoose}>Choose file</button>
        )}
      </footer>
    </div>
  )
}
