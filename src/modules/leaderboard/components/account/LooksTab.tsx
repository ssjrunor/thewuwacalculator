/*
  Author: Runor Ewhro
  description: the Looks tab of the viewer's profile: the card look per resonator.
*/

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import type { MediaItem } from '@/domain/leaderboard/api'
import type { CardDoc } from '@/domain/leaderboard/documents'
import { DEF_SHOWCASE_CARD_STYLE, DEF_SHOWCASE_HIDE, type ShowcaseCardHidden, type ShowcaseCardStyle } from '@/domain/entities/preferences'
import { DEFAULT_PORTRAIT_SURFACE, inkForSurface } from '@/modules/simulation/surfaces/showcase/portraitSurface'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
import { queryClient } from '@/shared/lib/queryClient'
import { mainPortal } from '@/shared/lib/portalTarget'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal'
import { useConfirm } from '@/shared/hooks/useConfirmation'
import { lbApi } from '../../api/client'
import { lbKeys, lbq } from '../../api/queries'
import { errorText } from '../../model/cardTrack'
import { dayText, resFace, resName, score1 } from '../../model/format'
import type { Row } from '../../model/listed'
import { PrepareError, prepareImage } from '../../lib/prepareImage'
import { useScope } from '../../state/ctx'
import { loadCard, useAsync } from '../build/BuildDetail'
import { LbCard, lookHidden, lookImage, lookStyle } from '../build/LbCard'

const ShowcaseCustomizePanel = lazy(async () => ({ default: (await import('@/modules/simulation/surfaces/showcase/Customize')).ShowcaseCustomizePanel }))

const DEFAULT_LOOK = { style: { ...DEF_SHOWCASE_CARD_STYLE }, hidden: { ...DEF_SHOWCASE_HIDE } } as CardDoc
const STATUS: Record<MediaItem['status'], string> = { pending: 'In review', approved: 'Approved', rejected: 'Rejected' }

// a stored look, as the leaderboard stores it: no custom css
const docOf = (style: ShowcaseCardStyle, hidden: ShowcaseCardHidden): CardDoc => ({ style: { ...style, customCss: null }, hidden } as CardDoc)

// each resonator once, by its best build: ranked by score, then the newest
function resonatorsOf(rows: Row[]): Row[] {
  const best = new Map<string, Row>()
  for (const x of rows) {
    const held = best.get(x.resonatorId)
    if (!held || (x.score ?? -1) > (held.score ?? -1) || ((x.score ?? -1) === (held.score ?? -1) && x.at > held.at)) best.set(x.resonatorId, x)
  }
  return [...best.values()].sort((a, b) => resName(a.resonatorId).localeCompare(resName(b.resonatorId)))
}

// the card at its natural 992x720, zoomed to the column
function useFit(): [RefObject<HTMLDivElement | null>, number] {
  const box = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.6)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setZoom(Math.min(1, el.clientWidth / 992))
    const watch = new ResizeObserver(fit)
    watch.observe(el)
    fit()
    return () => watch.disconnect()
  }, [])
  return [box, zoom]
}

export function LooksTab({ rows, initial }: { rows: Row[]; initial: string | null }) {
  const { toast } = useScope()
  const list = useMemo(() => resonatorsOf(rows), [rows])
  const [pick, setPick] = useState<string | null>(initial)
  const row = list.find((x) => x.resonatorId === pick) ?? list[0] ?? null
  const resId = row?.resonatorId ?? null

  const detailRead = useQuery({ ...lbq.build(row?.buildId ?? ''), enabled: Boolean(row) })
  const d = detailRead.data?.buildId === row?.buildId ? detailRead.data ?? null : null
  const card = useAsync(d ? `${d.buildId}:look` : null, () => loadCard(d!, d!.best))

  // the look as stored, a save made here (the build's detail leaves out images still in review), and edits not saved
  const [saved, setSaved] = useState<Record<string, CardDoc | null>>({})
  const [drafts, setDrafts] = useState<Record<string, CardDoc>>({})
  const stored = resId && resId in saved ? saved[resId] : d?.card ?? null
  const draft = (resId ? drafts[resId] : undefined) ?? stored ?? DEFAULT_LOOK
  const dirty = Boolean(resId && drafts[resId])
  const style = lookStyle(draft)
  const hidden = lookHidden(draft)
  const edit = (next: CardDoc) => { if (resId) setDrafts((all) => ({ ...all, [resId]: next })) }
  const patchStyle = (patch: Partial<ShowcaseCardStyle>) => edit(docOf({ ...style, ...patch }, hidden))
  const patchHidden = (patch: Partial<ShowcaseCardHidden>) => edit(docOf(style, { ...hidden, ...patch }))
  const revert = () => { if (resId) setDrafts((all) => { const rest = { ...all }; delete rest[resId]; return rest }) }

  const [editMode, setEditMode] = useState<'portrait' | 'backdrop' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [surface, setSurface] = useState(DEFAULT_PORTRAIT_SURFACE)
  const shownSurface = style.surface ?? surface
  const [fitBox, zoom] = useFit()
  const confirmation = useConfirm()

  const presetsRead = useQuery(lbq.presets())
  const presets = presetsRead.data?.presets ?? null
  const mediaRead = useQuery(lbq.media())
  const uploads = mediaRead.data?.media.filter((m) => m.purpose === 'card') ?? null
  const [presetName, setPresetName] = useState('')

  const save = () => {
    if (!resId || !d) return
    setBusy('save')
    const doc = docOf(style, hidden)
    lbApi.putCard(resId, doc).then(() => {
      setSaved((all) => ({ ...all, [resId]: doc }))
      revert()
      void queryClient.invalidateQueries({ queryKey: ['lb', 'build'] })
      toast(`look saved! every ${resName(resId)} build of yours wears it now :P`)
    }, (e: unknown) => toast(errorText(e), true)).finally(() => setBusy(null))
  }

  // one hidden file input for both images
  const picker = useRef<HTMLInputElement>(null)
  const picking = useRef<'portrait' | 'backdrop'>('portrait')
  const wear = (target: 'portrait' | 'backdrop', id: string) =>
    patchStyle(target === 'portrait' ? { portraitImage: `media:${id}` } : { backdropImage: `media:${id}` })
  const upload = (file: File) => {
    const target = picking.current
    setBusy(target)
    prepareImage(file, 'card').then((image) => lbApi.upload('card', image)).then((m) => {
      queryClient.setQueryData(lbKeys.media(), (r: { media: MediaItem[] } | undefined) => r ? { media: [m, ...r.media] } : r)
      wear(target, m.id)
      toast('uploaded! others see it once staff approve it :P')
    }, (e: unknown) => toast(e instanceof PrepareError ? e.message : errorText(e), true)).finally(() => setBusy(null))
  }
  const dropUpload = (m: MediaItem) => confirmation.confirm({
    title: 'Delete this upload?',
    message: 'Looks and presets using it go back to the resonator\'s own art.',
    confirmLabel: 'Delete upload',
    variant: 'danger',
    onConfirm: () => {
      lbApi.deleteMedia(m.id).then(() => {
        queryClient.setQueryData(lbKeys.media(), (r: { media: MediaItem[] } | undefined) => r ? { media: r.media.filter((x) => x.id !== m.id) } : r)
        toast('upload deleted.')
      }, (e: unknown) => toast(errorText(e), true))
    },
  })

  const savePreset = () => {
    const name = presetName.trim()
    if (!name) return
    setBusy('preset')
    lbApi.createPreset({ name, style: docOf(style, hidden).style }).then(() => {
      setPresetName('')
      void queryClient.invalidateQueries({ queryKey: lbKeys.presets() })
      toast(`preset "${name}" saved.`)
    }, (e: unknown) => toast(errorText(e), true)).finally(() => setBusy(null))
  }
  const dropPreset = (id: string) => {
    lbApi.deletePreset(id).then(() => void queryClient.invalidateQueries({ queryKey: lbKeys.presets() }), (e: unknown) => toast(errorText(e), true))
  }

  if (!list.length) return <div className="empty">submit a build first! a look belongs to a resonator you have on the boards.</div>

  const resetGroup = (group: 'portrait' | 'backdrop') => group === 'portrait'
    ? edit(docOf({ ...style, portraitImage: null, portraitCredit: null, portraitX: null, portraitY: null, portraitScale: null, maskTop: null, maskRight: null,
      maskBottom: null, maskLeft: null, maskTopSharp: null, maskRightSharp: null, maskBottomSharp: null, maskLeftSharp: null }, { ...hidden, portraitCredit: false }))
    : edit(docOf({ ...style, backdropImage: null, backdropCredit: null, backdropX: null, backdropY: null, backdropScale: null, backdropBlur: null, backdropOpacity: null },
      { ...hidden, backdropCredit: false }))
  const resetSection = (section: 'show' | 'color' | 'type') => section === 'show'
    ? edit(docOf({ ...style, statsColumn: null, portraitCredit: null, backdropCredit: null }, { ...DEF_SHOWCASE_HIDE }))
    : patchStyle(section === 'color' ? { accent: null, surface: null, opacity: null } : { displayFont: null, monoFont: null, text: null })
  const noop = () => undefined
  const portrait = lookImage(style.portraitImage)
  const backdrop = lookImage(style.backdropImage)

  return (
    <div className="lks">
      <nav className="lks-res" aria-label="Resonators">
        {list.map((x) => {
          const on = x.resonatorId === resId
          return (
            <button key={x.resonatorId} type="button" className={on ? 'on' : ''} aria-current={on ? 'true' : undefined} onClick={() => { setPick(x.resonatorId); setEditMode(null) }}>
              <img src={resFace(x.resonatorId)} alt="" /><span><b>{resName(x.resonatorId)}</b><small>{x.score != null ? score1(x.score) : 'unranked'}{drafts[x.resonatorId] ? ', unsaved' : ''}</small></span>
            </button>
          )
        })}
      </nav>

      <div className="lks-prev" ref={fitBox}>
        <div className="fcard lks-card" style={{ zoom } as CSSProperties}>
          {detailRead.error && !d ? <span className="fcard-err">{errorText(detailRead.error)}</span>
            : !d || !card.value ? card.error ? <span className="fcard-err">{card.error}</span> : <AppLdrVrly mode="inline" text="putting the card together... :P" />
            : <LbCard build={card.value} score={d.best?.score ?? null} damage={d.best?.dpr ?? null} holder={{ name: d.name, uid: d.uid }} look={draft} onSurface={setSurface} />}
        </div>
        <p className="lks-cap">{dirty ? 'Unsaved changes. Others still see the saved look.' : stored ? 'This is the look others see.' : 'The default look. Change anything to make it yours.'}</p>
      </div>

      <div className="lks-side">
        {d && card.value ? (
          <Suspense fallback={<AppLdrVrly mode="inline" text="Loading controls..." />}>
            <ShowcaseCustomizePanel
              layout="seal" onLayoutChange={noop}
              accent={style.accent ?? card.value.rail.accent} surface={shownSurface} text={style.text ?? inkForSurface(shownSurface)}
              cardOpacity={style.opacity ?? 82}
              portraitX={style.portraitX ?? 50} portraitY={style.portraitY ?? 50} portraitScale={style.portraitScale ?? 50}
              maskTop={style.maskTop ?? 0} maskRight={style.maskRight ?? 0} maskBottom={style.maskBottom ?? 45} maskLeft={style.maskLeft ?? 0}
              maskTopSharp={style.maskTopSharp ?? 0} maskRightSharp={style.maskRightSharp ?? 0} maskBottomSharp={style.maskBottomSharp ?? 0} maskLeftSharp={style.maskLeftSharp ?? 0}
              portraitImage={portrait} backdropImage={backdrop} resId={resId} fallbackArt={card.value.rail.portraitSrc}
              displayFont={style.displayFont ?? null}
              backdropX={style.backdropX ?? (style.backdropY == null ? 20 : 50)} backdropY={style.backdropY ?? (style.backdropX == null ? 50 : 28)}
              backdropScale={style.backdropScale ?? 67} backdropBlur={style.backdropBlur ?? 30} backdropOpacity={style.backdropOpacity ?? 67}
              statsColumn={style.statsColumn ?? 'build'} portraitCredit={style.portraitCredit ?? ''} backdropCredit={style.backdropCredit ?? ''}
              textSlots={style.textSlots ?? {}} customCss=""
              editMode={editMode} onEdit={(group) => setEditMode((now) => now === group ? null : group)}
              hidden={hidden} onToggleHidden={(key) => patchHidden({ [key]: !hidden[key] })}
              onStyleChange={patchStyle} onResetSection={resetSection} onResetGroup={resetGroup}
              onPickImage={(target) => { picking.current = target; picker.current?.click() }}
              onReset={() => edit(DEFAULT_LOOK)}
              onCapture={noop} captureAction={null} capturing={false} onExport={noop} onImportFile={noop}
              docked={false} drawerOpen={false} onToggleDrawer={noop} onExpandCss={noop}
              board={<>
                <button type="button" className="ctz-key" disabled={!dirty || busy != null} onClick={save}>{busy === 'save' ? 'Saving' : 'Save look'}</button>
                <button type="button" className="ctz-tag" disabled={!dirty || busy != null} onClick={revert}>Revert</button>
              </>}
            />
          </Suspense>
        ) : null}

        <section className="lks-grp">
          <h4>Presets</h4>
          {presets?.length ? presets.map((p) => (
            <div key={p.id} className="lks-pre">
              <i style={{ '--a': p.style.accent ?? 'var(--res)', '--s': p.style.surface ?? 'var(--head)' } as CSSProperties} aria-hidden="true" />
              <span><b>{p.name}</b><small>{p.shared ? 'shared' : dayText(p.updatedAt)}</small></span>
              <button type="button" className="act" onClick={() => edit(docOf(lookStyle({ style: p.style, hidden } as CardDoc), hidden))}>Apply</button>
              {p.own ? <button type="button" className="k-tool ibs" aria-label={`Delete ${p.name}`} data-l="Delete" onClick={() => dropPreset(p.id)}><X className="lu" aria-hidden="true" /></button> : null}
            </div>
          )) : <p className="lks-q">{presetsRead.isError ? errorText(presetsRead.error) : presets ? 'no presets yet.' : 'loading...'}</p>}
          <form className="lks-new" onSubmit={(event) => { event.preventDefault(); savePreset() }}>
            <label className="fld"><input value={presetName} maxLength={32} onChange={(event) => setPresetName(event.target.value)} placeholder="Name this look" aria-label="Preset name" /></label>
            <button type="submit" className="act" disabled={!presetName.trim() || busy != null}>Save preset</button>
          </form>
        </section>

        <section className="lks-grp">
          <h4>Uploads</h4>
          {uploads?.length ? <div className="lks-ups">{uploads.map((m) => (
            <div key={m.id} className="lks-up">
              <img src={lbApi.mediaUrl(m.id)} alt="" loading="lazy" />
              <span className={`lks-st ${m.status}`}>{STATUS[m.status]}</span>
              <span className="lks-up-acts">
                {m.status !== 'rejected' ? <>
                  <button type="button" className="lk" onClick={() => wear('portrait', m.id)}>Portrait</button>
                  <button type="button" className="lk" onClick={() => wear('backdrop', m.id)}>Backdrop</button>
                </> : null}
                <button type="button" className="k-tool ibs" aria-label="Delete upload" data-l="Delete" onClick={() => dropUpload(m)}><X className="lu" aria-hidden="true" /></button>
              </span>
            </div>
          ))}</div> : <p className="lks-q">{mediaRead.isError ? errorText(mediaRead.error) : uploads ? 'pick an image in Portrait or Backdrop to upload one.' : 'loading...'}</p>}
        </section>
      </div>

      <input ref={picker} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = '' }} />
      <ConfirmHost control={confirmation} portalTarget={mainPortal()} />
    </div>
  )
}
