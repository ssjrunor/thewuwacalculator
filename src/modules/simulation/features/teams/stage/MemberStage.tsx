/*
  Author: Runor Ewhro
  Description: The member stage: one resonator's five channels, the weapon rack
               that takes the body over, and everything that drives them. It is
               not a modal and does not know about one. The teammate console
               stands it in a modal frame; Modulation stands it on a
               page and writes its own loadout channel, so neither surface has
               to suppress the other's blocks to get its own.
*/

import {
  type CSSProperties as CssProps,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ArrowRightLeft, Clipboard, Copy, Gem, Layers, Network, Package, Pencil, Save, Scissors, Sparkles, Trash2, X, Zap } from 'lucide-react'
import { isNoWeaponId, type EchoInstance, type ResRuntime } from '@/domain/entities/runtime.ts'
import type { GenWpn } from '@/domain/entities/weapon.ts'
import { equalEchoes, equalBuildSnapshots, cloneEchoFor, cloneEchoLoadout, sameEchoUid, saveEchoSlots, type SavedBuild, type SavedEcho } from '@/domain/entities/inventoryStorage.ts'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import { getResStateControls } from '@/domain/gameData/resonatorStateGraph'
import { initWpnStts } from '@/domain/state/sourceStateInit.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { selInvSg } from '@/domain/state/selectors.ts'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService.ts'
import { getOwnForKey, listStatesFor, listOwnersFor } from '@/domain/services/gameDataService.ts'
import { getMainEchoS } from '@/domain/services/runtimeSourceService.ts'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService.ts'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { fmtEchoStatL, fmtEchoStatV, getEchoStatI, mkDefEchoNst } from '@/modules/simulation/features/echoes/lib/echoPane.ts'
import { isStateVisible } from '@/domain/services/sourceStateService.ts'
import { buildSonataPlan } from '@/modules/simulation/workspace/ui.tsx'
import {
  applyCscdRst,
  getStateTeamTag,
  getTeamTgtPt,
  isSourceVisible,
} from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import { readRtPath, writeRtPath } from '@/domain/gameData/runtimePath.ts'
import { mkCntrPath } from '@/domain/gameData/stateKeys.ts'
import { getSrcSttNct } from '@/domain/gameData/controlOptions.ts'
import type { RtUpdHnd } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import { TeammateManualBuffs } from '@/modules/simulation/features/teams/TeammateManualBuffs.tsx'
import {
  STAT_ICON_MAP,
  formatStatKeyLabel,
  formatStatValue,
  type StatsView,
} from '@/modules/simulation/model/statsView.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { ATTR_COLORS, getWpnTypeLb, rarityVars } from '@/modules/simulation/model/display.ts'
import {
  getWeapon,
  weaponStatsAt,
  resPssvPrms,
  fmtWpnStatDs,
  WPNSTATLBLS,
  WPN_STAT_CNS,
} from '@/modules/simulation/features/weapons/lib/weapon.ts'
import { scopedTargetOwnerKey } from '@/domain/gameData/targetRouting.ts'
import { Edit } from '@/modules/simulation/features/echoes/Edit.tsx'
import { EchoPicker } from '@/modules/simulation/features/echoes/Picker.tsx'
import { Parser } from '@/modules/simulation/features/echoes/Parser.tsx'
import { QuickSetup } from '@/modules/simulation/features/echoes/QuickSetup.tsx'
import { listActiveSets } from '@/modules/simulation/model/activeEchoSets.ts'
import { InvMdl } from '@/modules/simulation/features/inventory/InventoryModal.tsx'
import { useEchoClipboard } from '@/modules/simulation/model/useEchoClipboard.ts'
import { getEchoMptyC, getEchoPaneC, getEchoSlotC } from '@/modules/simulation/features/echoes/lib/ctx.tsx'
import { readBuildClpb, writeBuildClpb } from '@/modules/simulation/features/inventory/lib/buildClipboard.ts'
import { useSel } from '@/modules/simulation/lib/sel.tsx'
import { useAppModal, useAppModalValue } from '@/shared/ui/useAppModal.ts'
import { ResPckr } from '@/modules/simulation/features/resonator/Picker.tsx'
import { eligibleForSlot, useTeamSlots } from '@/modules/simulation/features/teams/lib/teamSlots.ts'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal.tsx'
import { useConfirm } from '@/app/hooks/useConfirmation.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { useCtxBuilder } from '@/shared/context-menu/useCtxBuilder.ts'
import { SourceStateCtrl } from '@/modules/simulation/features/controls/SourceStateControl.tsx'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { Expandable } from '@/shared/ui/Expandable.tsx'
import { getResonator, spriteVars, type ResView } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import {
  mkForteDock,
  mkForteMode,
  mkForteTree,
  type ForteBranch,
  type ForteDock,
} from '@/modules/simulation/features/resonator/lib/forteTree.ts'
import { ForteTree } from '@/modules/simulation/features/resonator/ForteTree.tsx'
import {
  ASCENSION_STOPS,
  RES_LVL_MAX,
  RES_LVL_MIN,
  setResLvl,
  setSkllLvl,
  setWpnLvl,
  tglTrcNd,
} from '@/modules/simulation/features/resonator/lib/buildEdits.ts'
import { withDefIconM, withDefResMg, withDefWpnMg } from '@/shared/lib/imageFallback.ts'

export type ChannelId = 'loadout' | 'skills' | 'effects' | 'echoes' | 'buffs'
const MAX_ECHO_COST = 12
const TEAM_ECHO_SEL_SURFACE = 'teammate-config-echo-selection'

/* what the stage itself needs. it is not a modal and does not take a modal's
   state: a surface that wants one wraps this in `ConfigModalProps` below. */
export interface MemberStageProps {
  /* where the stage's OWN dialogs go (the echo editor, the picker, the parser,
     quick setup, the inventory). it is not the stage's own frame; a surface
     that does not care resolves the app shell by default. */
  portalTarget?: HTMLElement | null
  member: ResView
  roster: ResView[]
  runtime: ResRuntime
  actRt: ResRuntime
  // the active resonator owns progression the team slots resolve at runtime, so
  // only its view offers level, skill, and trace editing.
  isActive: boolean
  invBlds: SavedBuild[]
  sttDefs: SourceState[]
  cmbtSttsView: StatsView | null
  initChannel?: ChannelId
  /* a surface that draws its own channel switch drives the channel from outside
     instead of seeding it once */
  channel?: ChannelId
  /* the weapon rack takes over the stage body. a surface whose own trim owns the
     weapon chip opens it from there, so the rack can be driven from outside too */
  rackOpen?: boolean
  onRackOpenChange?: (open: boolean) => void
  /* in the modal you are reading a teammate, so only the active resonator gets
     the skills channel. a surface whose subject is a resonator being built gets
     all of them, whoever is in front */
  allChannels?: boolean
  onSwitchMember: (resonatorId: string) => void
  onChannelChange?: (channel: ChannelId) => void
  onSqncChng: (value: number) => void
  onRtPdt: RtUpdHnd
  getSelTgt: (ownerKey: string) => string | null
  setSelTgt: (ownerKey: string, tgtResId: string | null) => void
  /* the head's close button, which only a modal frame draws */
  onClose?: () => void
  /* `bare` drops the spine and the head: a page that carries the trim and the
     channel switch in its own frame already says who this is about, and wants
     no plinth, no pills and no close button */
  frame?: 'modal' | 'bare'
}

/* the stage plus the frame's own state, for the teammate console's modal */
export interface ConfigModalProps extends MemberStageProps {
  visible: boolean
  open: boolean
  closing?: boolean
  onClose: () => void
}

function ChainDial({
  label,
  prefix,
  min,
  max,
  value,
  compact = false,
  onChange,
}: {
  label: string
  prefix: string
  min: number
  max: number
  value: number
  compact?: boolean
  onChange: (next: number) => void
}) {
  const steps = useMemo(
    () => Array.from({ length: max - min + 1 }, (_, index) => min + index),
    [min, max],
  )

  return (
    <div className="mcc-chain">
      {!compact ? (
        <div className="mcc-chain-head">
          <span className="mcc-chain-label">{label}</span>
          <span className="mcc-chain-readout">{prefix}{value}</span>
        </div>
      ) : null}
      <div className="mcc-chain-track" role="radiogroup" aria-label={label}>
        {steps.map((step, index) => (
          <span key={step} style={{ display: 'contents' }}>
            {index > 0 ? (
              <span className={`mcc-chain-link${step <= value ? ' lit' : ''}`} aria-hidden="true" />
            ) : null}
            <button
              type="button"
              role="radio"
              aria-checked={step === value}
              aria-label={`${prefix}${step}`}
              className={[
                'mcc-chain-node',
                step <= value ? 'lit' : '',
                step === value ? 'current' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onChange(step)}
            >
              {step}
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

/*
  a level rail with the ascension levels marked on it, so the spine can show
  where a resonator sits between breakpoints and not just its number.
*/
function LevelRail({
  label,
  value,
  min,
  max,
  stops,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  stops: readonly number[]
  onChange: (next: number) => void
}) {
  const frac = (level: number) => ((level - min) / (max - min)) * 100

  return (
    <div className="mcc-lvl">
      <div className="mcc-lvl-head">
        <span className="mcc-chain-label">{label}</span>
        <span className="mcc-lvl-value">{value}<i>/{max}</i></span>
      </div>
      <div className="mcc-lvl-rail">
        <input
          type="range" className="mcc-lvl-input"
          min={min}
          max={max}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="mcc-lvl-track" aria-hidden="true">
          <span className="mcc-lvl-fill" style={{ width: `${frac(value)}%` }} />
          {stops.filter((stop) => stop < max).map((stop) => (
            <span
              key={stop}
              className={`mcc-lvl-stop${value >= stop ? ' lit' : ''}`}
              style={{ left: `${frac(stop)}%` }}
            />
          ))}
          <span className="mcc-lvl-knob" style={{ left: `${frac(value)}%` }} />
        </span>
      </div>
    </div>
  )
}

function BuildCard({
  entry,
  member,
  index,
  onApply,
}: {
  entry: SavedBuild
  member: ResView
  index: number
  onApply: () => void
}) {
  const mainEcho = entry.build.echoes[0]
  const mainEchoDef = mainEcho ? getEchoById(mainEcho.id) : null
  const bldWpnId = entry.build.weapon.id
  const bldWpnDef = bldWpnId && !isNoWeaponId(bldWpnId) ? getWeapon(bldWpnId) : null
  const sonataPlan = buildSonataPlan(entry.build.echoes)

  return (
    <button
      type="button" className="mcc-build-card"
      style={{ '--mcc-card-index': Math.min(index, 6) } as CssProps}
      title={`Apply ${entry.name} (${entry.resonatorName})`}
      onClick={onApply}
    >
      <span className="mcc-build-card-art" aria-hidden="true">
        <img
          src={member.sprite || member.profile}
          alt=""
          loading="lazy"
          style={spriteVars(member)}
          onError={withDefResMg}
        />
      </span>
      <span className="mcc-build-card-port" aria-hidden="true" />
      <span className="mcc-build-card-name">{entry.name}</span>
      <span className="mcc-build-card-props">
        {bldWpnDef ? (
          <>
            <span className="mcc-build-card-weapon"
              style={rarityVars(bldWpnDef.rarity, false, '--mcc-accent') as CssProps}
              title={bldWpnDef.name}
            >
              <img src={bldWpnDef.icon} alt="" loading="lazy" onError={withDefWpnMg} />
              <i>R{entry.build.weapon.rank}</i>
            </span>
            <span className="mcc-build-card-gap" aria-hidden="true" />
          </>
        ) : null}
        <span className="mcc-build-card-echo" title={mainEchoDef?.name}>
          {mainEchoDef?.icon ? (
            <img src={mainEchoDef.icon} alt="" loading="lazy" onError={withDefIconM} />
          ) : null}
        </span>
        <span className="mcc-build-card-gap" aria-hidden="true" />
        <span className="mcc-build-card-sets">
          {sonataPlan.map((set) => (
            <span key={set.id} className="mcc-build-card-set">
              {set.icon ? (
                <img src={set.icon} alt="" loading="lazy" onError={withDefIconM} />
              ) : (
                <span className="mcc-build-card-set-fallback" />
              )}
              <i>{set.count}</i>
            </span>
          ))}
        </span>
      </span>
    </button>
  )
}

function WeaponCard({
  def,
  equipped,
  index,
  onPick,
}: {
  def: GenWpn
  equipped: boolean
  index: number
  onPick: () => void
}) {
  const stats = weaponStatsAt(def, 90)

  return (
    <button
      type="button"
      className={`mcc-wpn-card${equipped ? ' active' : ''}`}
      style={{
        ...rarityVars(def.rarity, false, '--mcc-accent'),
        '--mcc-card-index': Math.min(index, 6),
      } as CssProps}
      aria-pressed={equipped}
      title={equipped ? `${def.name} (equipped)` : `Equip ${def.name}`}
      onClick={onPick}
    >
      <span className="mcc-wpn-card-art" aria-hidden="true">
        <img src={def.icon} alt="" loading="lazy" onError={withDefWpnMg} />
      </span>
      <span className="mcc-wpn-card-port" aria-hidden="true" />
      <span className="mcc-wpn-card-name">{def.name}</span>
      <span className="mcc-wpn-card-stats">
        <span className="mcc-wpn-card-stat" title="Base ATK at Lv 90">
          <span className="mcc-stat-glyph"
            aria-hidden="true"
            style={{
              WebkitMaskImage: `url(${WPN_STAT_CNS.atk})`,
              maskImage: `url(${WPN_STAT_CNS.atk})`,
            } as CssProps}
          />
          <i>{Math.round(stats.atk)}</i>
        </span>
        <span className="mcc-build-card-gap" aria-hidden="true" />
        <span className="mcc-wpn-card-stat" title={`${WPNSTATLBLS[def.statKey] ?? def.statKey} at Lv 90`}>
          {WPN_STAT_CNS[def.statKey] ? (
            <span className="mcc-stat-glyph"
              aria-hidden="true"
              style={{
                WebkitMaskImage: `url(${WPN_STAT_CNS[def.statKey]})`,
                maskImage: `url(${WPN_STAT_CNS[def.statKey]})`,
              } as CssProps}
            />
          ) : null}
          <i>{fmtWpnStatDs(def.statKey, stats.scndStatVl)}</i>
        </span>
      </span>
    </button>
  )
}

// read the stored control value rather than visibility when marking linked
// teammate states in the modal.
function stateIsLive(rt: ResRuntime, state: SourceState, actRt: ResRuntime): boolean {
  const resolved = readRtPath(rt, state.path) ?? getSrcSttNct(rt, rt, state, actRt)
  if (state.kind === 'toggle') {
    if (typeof resolved === 'boolean') return resolved
    if (typeof resolved === 'string') return resolved === 'true'
    if (typeof resolved === 'number') return resolved > 0
    return false
  }
  const num = typeof resolved === 'number' ? resolved : Number(resolved)
  if (!Number.isFinite(num)) return false
  if (state.kind === 'select') return num > 0
  return num > (state.min ?? 0)
}

function StateCell({ active, children }: { active?: boolean; children: ReactNode }) {
  return (
    <div className={`mcc-cell${active ? ' is-linked' : ''}`}>
      <span className="mcc-cell-port" aria-hidden="true" />
      {children}
    </div>
  )
}

function EchoStatGlyph({ statKey }: { statKey: string }) {
  const icon = getEchoStatI(statKey)
  if (!icon) {
    return <span className="mcc-echo-stat-glyph is-blank" aria-hidden="true" />
  }

  return (
    <span className="mcc-echo-stat-glyph"
      aria-hidden="true"
      style={{ WebkitMaskImage: `url(${icon})`, maskImage: `url(${icon})` } as CssProps}
    />
  )
}

function EchoReadout({
  echo,
}: {
  echo: NonNullable<ResRuntime['build']['echoes'][number]>
}) {
  const substats = Object.entries(echo.substats).filter(([, value]) => value !== 0)

  return (
    <div className="mcc-echo-readout">
      <div className="mcc-echo-lead">
        <EchoStatGlyph statKey={echo.mainStats.primary.key} />
        <span className="mcc-echo-lead-value">
          {fmtEchoStatV(echo.mainStats.primary.key, echo.mainStats.primary.value)}
        </span>
        <span className="mcc-echo-lead-label">{fmtEchoStatL(echo.mainStats.primary.key)}</span>
      </div>
      <div className="mcc-echo-stat-list">
        <div className="mcc-echo-stat-row is-secondary">
          <EchoStatGlyph statKey={echo.mainStats.secondary.key} />
          <span className="mcc-echo-stat-name">{fmtEchoStatL(echo.mainStats.secondary.key)}</span>
          <span className="mcc-echo-stat-value">
            {fmtEchoStatV(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}
          </span>
        </div>
        {substats.length > 0 ? (
          substats.map(([key, value]) => (
            <div key={key} className="mcc-echo-stat-row">
              <EchoStatGlyph statKey={key} />
              <span className="mcc-echo-stat-name">{fmtEchoStatL(key)}</span>
              <span className="mcc-echo-stat-value">{fmtEchoStatV(key, value)}</span>
            </div>
          ))
        ) : (
          <div className="mcc-echo-stat-row is-muted">
            <span className="mcc-echo-stat-name">No substats rolled</span>
          </div>
        )}
      </div>
    </div>
  )
}

function EchoActions({
  echo,
  isMain,
  canSave,
  onSetMain,
  onSave,
  onEdit,
  onChange,
  onUnequip,
}: {
  echo: NonNullable<ResRuntime['build']['echoes'][number]>
  isMain: boolean
  canSave: boolean
  onSetMain: (uid: string) => void
  onSave: () => void
  onEdit: (uid: string) => void
  onChange: () => void
  onUnequip: (uid: string) => void
}) {
  return (
    <div className="mcc-echo-actions" role="group" aria-label="Echo actions">
      <button
        type="button"
        role="radio"
        aria-checked={isMain}
        className={`mcc-echo-action mcc-echo-action--main${isMain ? ' is-on' : ''}`}
        aria-label={isMain ? 'Main echo' : 'Set as main echo'}
        title={isMain ? 'Main echo' : 'Set as main echo'}
        onClick={() => {
          if (!isMain) {
            onSetMain(echo.uid)
          }
        }}
      >
        <span className="mcc-echo-radio-dot" aria-hidden="true" />
        Main
      </button>
      <button
        type="button" className="mcc-echo-action"
        disabled={!canSave}
        aria-label="Save echo to inventory"
        title="Save echo to inventory"
        onClick={onSave}
      >
        <Save size="1em" aria-hidden="true" />
      </button>
      <button
        type="button" className="mcc-echo-action"
        aria-label="Edit echo"
        title="Edit echo"
        onClick={() => onEdit(echo.uid)}
      >
        <Pencil size="1em" aria-hidden="true" />
      </button>
      <button
        type="button" className="mcc-echo-action"
        aria-label="Change echo"
        title="Change echo"
        onClick={onChange}
      >
        <ArrowRightLeft size="1em" aria-hidden="true" />
      </button>
      <button
        type="button" className="mcc-echo-action is-remove"
        aria-label="Unequip echo"
        title="Unequip echo"
        onClick={() => onUnequip(echo.uid)}
      >
        <X size="1em" />
      </button>
    </div>
  )
}

function StatGlyph({ label, color, small }: { label: string; color?: string | null; small?: boolean }) {
  const icon = STAT_ICON_MAP[label]
  if (!icon) {
    return null
  }

  return (
    <span className="mcc-stat-glyph"
      aria-hidden="true"
      style={{
        '--stat-color': color ?? 'currentColor',
        WebkitMaskImage: `url(${icon})`,
        maskImage: `url(${icon})`,
        ...(small ? { width: '0.78rem', height: '0.78rem' } : null),
      } as CssProps}
    />
  )
}

function SpecRow({
  label,
  displayLabel,
  total,
  color,
  dimZero,
}: {
  label: string
  displayLabel?: string
  total: number
  color?: string | null
  dimZero?: boolean
}) {
  return (
    <div className={`mcc-spec-row${dimZero && total === 0 ? ' is-zero' : ''}`}>
      <span className="mcc-spec-name">
        <StatGlyph label={label} color={color} small />
        {displayLabel ?? label}
      </span>
      <span className="mcc-spec-leader" aria-hidden="true" />
      <span className="mcc-spec-value"
        style={color ? ({ color } as CssProps) : undefined}
      >
        {formatStatValue(label, total)}
      </span>
    </div>
  )
}

const ATTR_STAT_KEYS = new Set(['aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc'])

function TelemetryBoard({ statsView }: { statsView: StatsView | null }) {
  if (!statsView) {
    return <div className="mcc-empty">Combat stats are unavailable for this teammate.</div>
  }

  const attrStats = statsView.dmgMdfrStts.filter((stat) => ATTR_STAT_KEYS.has(stat.key))
  const skillStats = statsView.dmgMdfrStts.filter((stat) => !ATTR_STAT_KEYS.has(stat.key))

  const groups = [
    {
      id: 'core',
      label: 'Core',
      rows: [
        ...statsView.mainStats.map((stat) => ({ stat, dimZero: false })),
        ...statsView.secondaryStats.map((stat) => ({ stat, dimZero: true })),
      ],
    },
    { id: 'attribute', label: 'Attribute', rows: attrStats.map((stat) => ({ stat, dimZero: true })) },
    { id: 'skill', label: 'Skill', rows: skillStats.map((stat) => ({ stat, dimZero: true })) },
  ].filter((group) => group.rows.length > 0)

  return (
    <div className="mcc-spec">
      {groups.map((group) => (
        <section key={group.id} className="mcc-spec-group">
          <span className="mcc-spec-spine" aria-hidden="true">{group.label}</span>
          <div className="mcc-spec-list" role="group" aria-label={`${group.label} stats`}>
            {group.rows.map(({ stat, dimZero }) => (
              <SpecRow
                key={stat.label}
                label={stat.label}
                displayLabel={formatStatKeyLabel(stat.key)}
                total={stat.total}
                color={stat.color}
                dimZero={dimZero}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export const CHANNELS: Array<{
  id: ChannelId
  label: string
  icon: ReactNode
  activeOnly?: boolean
}> = [
  { id: 'loadout', label: 'Loadout', icon: <Package size="1em" /> },
  { id: 'skills', label: 'Skills', icon: <Network size="1em" />, activeOnly: true },
  { id: 'effects', label: 'Effects', icon: <Zap size="1em" /> },
  { id: 'echoes', label: 'Echoes', icon: <Gem size="1em" /> },
  { id: 'buffs', label: 'Buffs', icon: <Sparkles size="1em" /> },
]

function ResonatorView({
  portalTarget,
  member,
  roster,
  runtime,
  actRt,
  isActive,
  invBlds,
  sttDefs,
  cmbtSttsView,
  initChannel = 'loadout',
  channel: channelProp,
  rackOpen: rackOpenProp,
  onRackOpenChange,
  allChannels = false,
  onSwitchMember,
  onChannelChange,
  onSqncChng,
  onRtPdt,
  getSelTgt,
  setSelTgt,
  onClose,
  frame = 'modal',
}: MemberStageProps) {
  const onBare = frame === 'bare'
  /* the stage's dialogs need somewhere to land whether or not the surface
     around it cared to say where */
  const dialogHost = portalTarget ?? mainPortal()
  const maxWpnOnInit = useAppStore((state) => state.ui.preferences.maxResOnInit)
  const invChs = useAppStore((state) => state.library.echoes)
  const invSg = useAppStore(selInvSg)
  const addEchoToInv = useAppStore((state) => state.addInvEcho)
  const addEchoesToInv = useAppStore((state) => state.addInvEchoes)
  const updEchoInInv = useAppStore((state) => state.updInvEcho)
  const rmEchoFromInv = useAppStore((state) => state.rmInvEcho)
  const clrInvEchoes = useAppStore((state) => state.clrInvEcho)
  const addMkToInv = useAppStore((state) => state.addInvBuild)
  const updInvBuild = useAppStore((state) => state.updInvBuild)
  const rmInvBuild = useAppStore((state) => state.rmInvBuild)
  const clrInvBuilds = useAppStore((state) => state.clrInvBuild)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const showToast = useTstStr((state) => state.show)
  const confirmation = useConfirm()
  const menu = useCtxBuilder()
  const [ownChannel, setOwnChannel] = useState<ChannelId>(initChannel)
  const channel = channelProp ?? ownChannel
  const setChannel = channelProp == null ? setOwnChannel : () => undefined
  const [showAllBlds, setShowAllBlds] = useState(false)
  const [ownRackOpen, setOwnRackOpen] = useState(false)
  const wpnRackOpen = rackOpenProp ?? ownRackOpen
  const setWpnRackOpen = useCallback((next: boolean) => {
    if (onRackOpenChange) onRackOpenChange(next)
    if (rackOpenProp == null) setOwnRackOpen(next)
  }, [onRackOpenChange, rackOpenProp])
  const [pvwUid, setPvwUid] = useState<string | null>(null)
  const [briefOpen, setBriefOpen] = useState(false)
  const [briefClamped, setBriefClamped] = useState(false)
  const briefBodyRef = useRef<HTMLDivElement>(null)
  const echoEditModal = useAppModalValue<number>()
  const echoPickerModal = useAppModalValue<number>()
  const parserModal = useAppModal()
  const quickSetupModal = useAppModal()
  const invModal = useAppModal()
  const invEchoEditModal = useAppModalValue<string>()
  const seatPicker = useAppModal()
  const [invEchoSearch, setInvEchoSearch] = useState('')
  const allEchoes = useMemo(() => listEchoes(), [])

  const isDarkMode = useAppStore((state) => state.ui.theme === 'dark')

  const vlblCntr = useMemo(() => [...getResStateControls(member)], [member])

  const showsForte = allChannels || isActive
  const skillTree = useMemo(
    () => (showsForte ? mkForteTree(member, isDarkMode) : []),
    [showsForte, isDarkMode, member],
  )
  const forteDock = useMemo(
    () => (showsForte ? mkForteDock(member) : []),
    [showsForte, member],
  )
  const forteMode = useMemo(
    () => (showsForte ? mkForteMode(member) : null),
    [showsForte, member],
  )
  const trcNodesOn = useMemo(
    () => (member.traceNodes ?? []).filter((node) => runtime.base.traceNodes.activeNodes[node.id]).length,
    [member.traceNodes, runtime.base.traceNodes.activeNodes],
  )

  const onLvlChng = useCallback((next: number) => {
    onRtPdt((prev) => setResLvl(prev, next))
  }, [onRtPdt])

  const onSkllChng = useCallback((key: ForteBranch['key'], next: number) => {
    onRtPdt((prev) => setSkllLvl(prev, key, next))
  }, [onRtPdt])

  const onTrcTgl = useCallback((nodeId: string) => {
    onRtPdt((prev) => tglTrcNd(prev, nodeId, member))
  }, [member, onRtPdt])

  /*
    the docked skills write the same levels the columns do, and the outro skill
    reaches here only when it carries one, which today it never does.
  */
  const onDockChng = useCallback((entry: ForteDock, next: number) => {
    const key = entry.key
    if (!entry.levelled || key === 'outroSkill') {
      return
    }

    onRtPdt((prev) => setSkllLvl(prev, key, next))
  }, [onRtPdt])

  /* the sigil writes the mode group's control, the same path its selector does */
  const onModeChng = useCallback((controlKey: string, next: string) => {
    onRtPdt((prev) => writeRtPath(prev, mkCntrPath(controlKey), next))
  }, [onRtPdt])

  const cscdRtUpd: RtUpdHnd = useCallback((updater) => {
    // cascade resets run against the visible teammate controls so mutually
    // exclusive state groups stay normalized after local edits.
    onRtPdt((prev) => {
      const next = updater(prev)
      const cscdCntr = applyCscdRst(
        next,
        prev.state.controls,
        next.state.controls,
        vlblCntr,
      )
      return {
        ...next,
        state: { ...next.state, controls: cscdCntr },
      }
    })
  }, [onRtPdt, vlblCntr])

  const mkRouting = useCallback((state: SourceState): ReactNode => {
    const targetMode = getStateTeamTag(state)
    if (!targetMode) {
      return undefined
    }

    const options = getTeamTgtPt(actRt, member.id, targetMode)
    const routeKey = scopedTargetOwnerKey(member.id, state.ownerKey)
    const currentValue = getSelTgt(routeKey) ?? getSelTgt(state.ownerKey)
    const fallback = options[0]?.value ?? ''
    const selected =
      typeof currentValue === 'string' && options.some((option) => option.value === currentValue)
        ? currentValue
        : fallback

    return (
      <label className="team-state-target">
        Routes to
        <LiquidSelect
          value={selected}
          options={options}
          disabled={options.length <= 1}
          onChange={(nextValue) => setSelTgt(routeKey, nextValue || null)}
        />
      </label>
    )
  }, [actRt, member.id, getSelTgt, setSelTgt])

  const weapons = useMemo(() => listWpnsByTy(member.weaponType), [member.weaponType])
  const weaponId = runtime.build.weapon.id
  const weaponDef = useMemo(() => getWeapon(weaponId), [weaponId])
  const currentRank = runtime.build.weapon.rank

  const pssvPrms = useMemo(
    () => (weaponDef ? resPssvPrms(weaponDef.passive.params, currentRank) : []),
    [weaponDef, currentRank],
  )

  const wpnStats = useMemo(
    () => (weaponDef ? weaponStatsAt(weaponDef, 90) : null),
    [weaponDef],
  )

  const weaponOwner = useMemo(() => {
    if (!weaponId || isNoWeaponId(weaponId)) return null
    const owners = listOwnersFor('weapon', weaponId)
    return owners[0] ?? null
  }, [weaponId])

  const weaponStates = useMemo(() => {
    if (!weaponId || isNoWeaponId(weaponId)) return []
    return listStatesFor('weapon', weaponId).filter((state) =>
      isSourceVisible(runtime, runtime, state, actRt),
    )
  }, [actRt, weaponId, runtime])

  const effectSections = useMemo(() => {
    const inherent: SourceState[] = []
    const sequence: SourceState[] = []
    const outro: SourceState[] = []
    const passives: SourceState[] = []
    for (const state of sttDefs) {
      const kind = getOwnForKey(state.ownerKey)?.kind
      if (kind === 'inherent') {
        inherent.push(state)
      } else if (kind === 'sequence') {
        sequence.push(state)
      } else if (kind === 'outroSkill') {
        outro.push(state)
      } else {
        passives.push(state)
      }
    }

    return [
      { id: 'inherent', label: 'Inherent', states: inherent },
      { id: 'passives', label: 'Passives', states: passives },
      { id: 'sequence', label: 'Sequence', states: sequence },
      { id: 'outro', label: 'Outro Skill', states: outro },
      { id: 'weapon', label: 'Weapon', states: weaponStates },
    ].filter((section) =>
      section.states.length > 0
      || (section.id === 'weapon' && Boolean(weaponOwner?.description)),
    )
  }, [sttDefs, weaponStates, weaponOwner])

  const myBlds = useMemo(
    () => invBlds.filter((entry) => entry.resonatorId === member.id),
    [invBlds, member.id],
  )

  const vsblBlds = useMemo(
    () => (showAllBlds
      ? [...myBlds, ...invBlds.filter((entry) => entry.resonatorId !== member.id)]
      : myBlds),
    [showAllBlds, myBlds, invBlds, member.id],
  )

  const activeSets = useMemo(
    () => listActiveSets(runtime.build.echoes),
    [runtime.build.echoes],
  )

  // main echo selection is explicit. a partial build may have no main echo, so
  // later derived panels must not promote another slot implicitly.
  const mainEcho = runtime.build.echoes.find((echo) => echo?.mainEcho) ?? null
  const mainEchoDef = mainEcho ? getEchoById(mainEcho.id) : null
  const equippedEchoes = runtime.build.echoes
  const presentEchoes = equippedEchoes.filter(
    (echo): echo is NonNullable<typeof echo> => echo != null,
  )
  const hasEchoes = presentEchoes.length > 0
  const previewEcho =
    (pvwUid ? equippedEchoes.find((echo) => echo?.uid === pvwUid) : null) ??
    mainEcho ??
    presentEchoes[0] ??
    null
  const previewDef = previewEcho ? getEchoById(previewEcho.id) : null
  const qppdEchoSlots = useMemo(() => runtime.build.echoes.reduce<number[]>((result, echo, index) => {
    if (echo) {
      result.push(index)
    }
    return result
  }, []), [runtime.build.echoes])
  const qppdCnt = qppdEchoSlots.length
  const selTms = useMemo(
    () => runtime.build.echoes.flatMap((echo, index) => (
      echo ? [{ id: index, val: echo }] : []
    )),
    [runtime.build.echoes],
  )
  const currentSaved = useMemo(
    () => invBlds.some((entry) =>
      equalBuildSnapshots(entry.build, {
        weapon: runtime.build.weapon,
        echoes: runtime.build.echoes,
      }),
    ),
    [invBlds, runtime.build.echoes, runtime.build.weapon],
  )
  const canSaveEcho = useCallback((echo: EchoInstance | null | undefined) => (
    Boolean(echo) && !invChs.some((entry) => equalEchoes(entry.echo, echo))
  ), [invChs])
  const svblQppdChs = useMemo(() => (
    runtime.build.echoes.filter((echo): echo is EchoInstance => canSaveEcho(echo))
  ), [canSaveEcho, runtime.build.echoes])
  const selection = useSel({
    active: channel === 'echoes' && !wpnRackOpen,
    surfaceId: TEAM_ECHO_SEL_SURFACE,
    ariaLabel: 'Teammate echo selection actions',
    noun: { one: 'echo', many: 'echoes' },
    items: selTms,
    ord: qppdEchoSlots,
    av: qppdEchoSlots,
    bar: true,
    // Modal selection actions take precedence over Simulation page actions.
    pri: 40,
    acts: [
      {
        id: 'teammate-echo:copy',
        key: 'copy',
        needsSel: true,
        icon: <Copy size="1em" />,
        label: ({ count }) => `Copy (${count})`,
        title: 'Copy selected echoes (Ctrl/Cmd+C)',
        run: async ({ vals }) => {
          const wrote = await copyChsToClp(vals)
          if (wrote) {
            showToast({
              content: `Copied ${vals.length} echo${vals.length === 1 ? '' : 'es'}.`,
              variant: 'success',
              duration: 2200,
            })
          }
        },
      },
      {
        id: 'teammate-echo:cut',
        key: 'cut',
        needsSel: true,
        icon: <Scissors size="1em" />,
        label: ({ count }) => `Cut (${count})`,
        title: 'Cut selected echoes (Ctrl/Cmd+X)',
        run: async ({ ids, vals }) => {
          const wrote = await copyChsToClp(vals)
          if (!wrote) {
            return
          }

          rmEchoSlts(ids)
          showToast({
            content: `Cut ${vals.length} echo${vals.length === 1 ? '' : 'es'}.`,
            variant: 'success',
            duration: 2200,
          })
        },
      },
      {
        id: 'teammate-echo:paste',
        key: 'paste',
        icon: <Clipboard size="1em" />,
        label: 'Paste',
        title: 'Paste echoes (Ctrl/Cmd+V)',
        float: false,
        run: async () => {
          await pasteEchoClipboardDefault()
        },
      },
      {
        id: 'teammate-echo:delete',
        key: 'delete',
        needsSel: true,
        danger: true,
        icon: <Trash2 size="1em" />,
        label: ({ count }) => `Remove (${count})`,
        title: 'Remove selected echoes (Delete / Backspace)',
        run: ({ ids }) => {
          rmEchoSlts(ids)
        },
      },
    ],
  })
  const selMode = selection.selectionMode
  const selEchoSlotL = selection.selectedIdsInOrder
  const selectedEchoSlots = useMemo(() => new Set(selEchoSlotL), [selEchoSlotL])

  // preview changes reset the expandable skill text to the compact state.
  const pickPreview = useCallback((uid: string) => {
    setPvwUid(uid)
    setBriefOpen(false)
  }, [])

  // main-echo writes are persisted as build flags; runtime materialization then
  // resolves the main echo source states from the updated build.
  const setMainEcho = useCallback((uid: string) => {
    onRtPdt((prev) => ({
      ...prev,
      build: {
        ...prev.build,
        echoes: prev.build.echoes.map((echo) =>
          echo ? { ...echo, mainEcho: echo.uid === uid } : echo,
        ),
      },
    }))
  }, [onRtPdt])

  // unequipping preserves explicit main-echo state by leaving the build without
  // a main echo when the removed entry was flagged.
  const unequipEcho = useCallback((uid: string) => {
    onRtPdt((prev) => ({
      ...prev,
      build: {
        ...prev.build,
        echoes: prev.build.echoes.map((echo) => (echo?.uid === uid ? null : echo)),
      },
    }))
  }, [onRtPdt])

  const rmEchoSlts = useCallback((slotIndexes: number[]) => {
    if (slotIndexes.length === 0) {
      return
    }

    onRtPdt((prev) => {
      const nextEchoes = [...prev.build.echoes]
      for (const slotIndex of slotIndexes) {
        nextEchoes[slotIndex] = null
      }
      return { ...prev, build: { ...prev.build, echoes: nextEchoes } }
    })
  }, [onRtPdt])

  const saveSlotsToInv = useCallback((slotIndexes: number[]) => {
    const result = saveEchoSlots(runtime.build.echoes, slotIndexes, addEchoToInv)
    const nextEchoes = result.nextEchoes
    if (nextEchoes) {
      onRtPdt((prev) => {
        return { ...prev, build: { ...prev.build, echoes: nextEchoes } }
      })
    }
    return result.savedCount
  }, [addEchoToInv, onRtPdt, runtime.build.echoes])

  const {
    copyEchoes: copyChsToClp,
    defaultPasteSlot: resolveDefaultPasteSlot,
    pasteIntoSlot: pasteEchoClipboardIntoSlot,
  } = useEchoClipboard({
    runtime,
    resonatorName: member.name,
    selectedSlots: selEchoSlotL,
    updateRuntime: onRtPdt,
    showToast,
  })

  const pasteEchoClipboardDefault = useCallback(async () => {
    await pasteEchoClipboardIntoSlot(resolveDefaultPasteSlot())
  }, [pasteEchoClipboardIntoSlot, resolveDefaultPasteSlot])

  const saveEchoAtSl = useCallback((slotIndex: number) => {
    const echo = runtime.build.echoes[slotIndex]
    if (!echo) {
      return
    }

    const savedCount = saveSlotsToInv([slotIndex])
    showToast({
      content: savedCount === 0 ? 'This echo is already saved.' : 'Saved 1 echo to bag.',
      variant: savedCount === 0 ? 'warning' : 'success',
      duration: savedCount === 0 ? 2600 : 2400,
    })
  }, [runtime.build.echoes, saveSlotsToInv, showToast])

  const saveAllEchoes = useCallback(() => {
    if (svblQppdChs.length === 0) {
      return
    }

    const slotIndexes = runtime.build.echoes.reduce<number[]>((result, echo, slotIndex) => {
      if (echo && canSaveEcho(echo)) {
        result.push(slotIndex)
      }
      return result
    }, [])
    const savedCount = saveSlotsToInv(slotIndexes)
    showToast({
      content: `Saved ${savedCount} echo${savedCount === 1 ? '' : 'es'} to bag.`,
      variant: 'success',
      duration: 3000,
    })
  }, [canSaveEcho, runtime.build.echoes, saveSlotsToInv, svblQppdChs.length, showToast])

  const copyEchoAtSl = useCallback(async (slotIndex: number) => {
    const echo = runtime.build.echoes[slotIndex]
    if (!echo) {
      return
    }

    const wrote = await copyChsToClp([echo])
    if (wrote) {
      showToast({
        content: 'Copied 1 echo.',
        variant: 'success',
        duration: 2200,
      })
    }
  }, [copyChsToClp, runtime.build.echoes, showToast])

  const cutEchoAtSl = useCallback(async (slotIndex: number) => {
    const echo = runtime.build.echoes[slotIndex]
    if (!echo) {
      return
    }

    const wrote = await copyChsToClp([echo])
    if (!wrote) {
      return
    }

    rmEchoSlts([slotIndex])
    showToast({
      content: 'Cut 1 echo.',
      variant: 'success',
      duration: 2200,
    })
  }, [copyChsToClp, rmEchoSlts, runtime.build.echoes, showToast])

  const openEchoPicker = useCallback((slotIndex: number) => {
    echoPickerModal.show(slotIndex)
  }, [echoPickerModal])

  const closeEchoPicker = useCallback(() => {
    echoPickerModal.hide()
  }, [echoPickerModal])

  const totalEchoCost = useMemo(() => runtime.build.echoes.reduce(
    (sum, echo) => sum + (echo ? getEchoById(echo.id)?.cost ?? 0 : 0),
    0,
  ), [runtime.build.echoes])

  const pickerSlot = echoPickerModal.value
  const pickerSlotCost = useMemo(() => {
    if (pickerSlot == null) return 0
    const echo = runtime.build.echoes[pickerSlot]
    return echo ? getEchoById(echo.id)?.cost ?? 0 : 0
  }, [pickerSlot, runtime.build.echoes])
  const maxCostForPickerSlot = MAX_ECHO_COST - totalEchoCost + pickerSlotCost

  const onPickerSelect = useCallback((echoId: string) => {
    if (pickerSlot == null) return
    const echoDef = getEchoById(echoId)
    if (!echoDef || echoDef.cost > maxCostForPickerSlot) return

    const previous = runtime.build.echoes[pickerSlot]
    const instance = mkDefEchoNst(echoId, pickerSlot, previous)
    if (!instance) return

    onRtPdt((prev) => {
      const next = [...prev.build.echoes]
      next[pickerSlot] = instance
      return { ...prev, build: { ...prev.build, echoes: next } }
    })
    bumpPickerFreq({
      bucket: 'echo',
      ids: [instance.id],
    })
  }, [bumpPickerFreq, maxCostForPickerSlot, onRtPdt, pickerSlot, runtime.build.echoes])

  const onPickerClear = useCallback(() => {
    if (pickerSlot == null) return
    rmEchoSlts([pickerSlot])
  }, [pickerSlot, rmEchoSlts])

  /* the seat this member sits in, and the two writes that own it. the team is
     stored on the profile in front, so only a support seat is re-cast here: the
     resonator in front is switched from the roster, never from its own console. */
  const { setMember: setTeamMember } = useTeamSlots()
  const seatIndex = actRt.build.team.indexOf(member.id)
  const canManageSeat = !isActive && seatIndex > 0

  const onSeatSelect = useCallback((resonatorId: string) => {
    if (!canManageSeat) return
    setTeamMember(seatIndex, resonatorId)
    seatPicker.hide()
    // the console follows the seat, so it now reads the member just placed
    onSwitchMember(resonatorId)
  }, [canManageSeat, onSwitchMember, seatIndex, seatPicker, setTeamMember])

  const onSeatRemove = useCallback(() => {
    if (!canManageSeat) return
    setTeamMember(seatIndex, null)
    onClose?.()
  }, [canManageSeat, onClose, seatIndex, setTeamMember])

  // the editor can re-cast its own slot, so it carries that slot's budget
  const editSlotCost = useMemo(() => {
    const slot = echoEditModal.value
    if (slot == null) return 0
    const echo = runtime.build.echoes[slot]
    return echo ? getEchoById(echo.id)?.cost ?? 0 : 0
  }, [echoEditModal.value, runtime.build.echoes])

  const maxCostForEditSlot = MAX_ECHO_COST - totalEchoCost + editSlotCost

  const onEditClear = useCallback(() => {
    const slot = echoEditModal.value
    if (slot == null) return
    rmEchoSlts([slot])
    echoEditModal.hide()
  }, [echoEditModal, rmEchoSlts])

  const saveBuild = useCallback(() => {
    if (currentSaved) {
      return
    }

    addMkToInv({
      resonatorId: runtime.id,
      resonatorName: member.name,
      build: {
        weapon: { ...runtime.build.weapon },
        echoes: cloneEchoLoadout(runtime.build.echoes),
      },
    })
    showToast({
      content: 'Saved build.',
      variant: 'success',
      duration: 2600,
    })
  }, [addMkToInv, currentSaved, member.name, runtime.build.echoes, runtime.build.weapon, runtime.id, showToast])

  const unequipAllEchoes = useCallback(() => {
    confirmation.confirm({
      title: 'You sure about that? ( · ❛ ֊ ❛)',
      message: 'This will remove all echoes from this teammate loadout.',
      confirmLabel: 'Unequip All',
      variant: 'danger',
      onConfirm: () => onRtPdt((prev) => ({
        ...prev,
        build: { ...prev.build, echoes: [null, null, null, null, null] },
      })),
    })
  }, [confirmation, onRtPdt])

  const openTeammateInventory = useCallback((search = '') => {
    setInvEchoSearch(search)
    invModal.show()
  }, [invModal])

  const findEchoInInv = useCallback((echo: EchoInstance) => {
    const savedEntry = invChs.find((entry) => sameEchoUid(entry.echo, echo))
    openTeammateInventory(savedEntry?.echo.uid ?? echo.uid)
  }, [invChs, openTeammateInventory])

  const equipInvEcho = useCallback((entry: SavedEcho, slotIndex: number) => {
    onRtPdt((prev) => {
      const nextEchoes = [...prev.build.echoes]
      nextEchoes[slotIndex] = cloneEchoFor(entry.echo, slotIndex)
      return {
        ...prev,
        build: {
          ...prev.build,
          echoes: nextEchoes,
        },
      }
    })
  }, [onRtPdt])

  const saveTeammateEquippedToInv = useCallback(() => {
    const echoes = runtime.build.echoes.filter((echo): echo is EchoInstance => Boolean(echo && getEchoById(echo.id)))
    if (echoes.length === 0) {
      showToast({
        content: 'This teammate has no valid equipped echoes to save.',
        variant: 'warning',
        duration: 2800,
      })
      return
    }

    const added = addEchoesToInv(echoes)
    showToast({
      content: added.length > 0
        ? `Saved ${added.length} teammate echo${added.length === 1 ? '' : 'es'} to inventory.`
        : 'All teammate echoes are already in inventory.',
      variant: added.length > 0 ? 'success' : 'warning',
      duration: 2800,
    })
  }, [addEchoesToInv, runtime.build.echoes, showToast])

  const editSlot = echoEditModal.value
  const editEcho = editSlot != null ? runtime.build.echoes[editSlot] : null
  const openEchoEdit = useCallback((uid: string) => {
    const slot = runtime.build.echoes.findIndex((echo) => echo?.uid === uid)
    if (slot >= 0) {
      echoEditModal.show(slot)
    }
  }, [echoEditModal, runtime.build.echoes])

  const onEchoEditSave = useCallback((updated: EchoInstance) => {
    if (editSlot == null) {
      return
    }
    onRtPdt((prev) => {
      const next = [...prev.build.echoes]
      next[editSlot] = updated
      return { ...prev, build: { ...prev.build, echoes: next } }
    })
    echoEditModal.hide()
  }, [editSlot, echoEditModal, onRtPdt])

  const selectEchoSlot = selection.addToSelection
  const toggleEchoSlot = selection.toggleSelection
  const selectEchoRange = selection.addRangeToSelection
  const selectAllEchoes = selection.selectAll
  const deselectAllEchoes = selection.deselectAll

  const makeEchoSlotMenu = useCallback((slotIndex: number, echo: EchoInstance) => (
    getEchoSlotC({
      menu: menu.simulation.echo,
      slotIndex,
      echo,
      canSave: canSaveEcho(echo),
      descVisible: false,
      hasDesc: false,
      onSave: () => saveEchoAtSl(slotIndex),
      onRemove: () => rmEchoSlts([slotIndex]),
      onEdit: () => openEchoEdit(echo.uid),
      onChange: () => openEchoPicker(slotIndex),
      onCopy: () => {
        void copyEchoAtSl(slotIndex)
      },
      onCut: () => {
        void cutEchoAtSl(slotIndex)
      },
      onPaste: () => {
        void pasteEchoClipboardIntoSlot(slotIndex)
      },
      onSel: () => selectEchoSlot(slotIndex),
      onFind: () => findEchoInInv(echo),
      onToggleDesc: () => {},
    })
  ), [
    canSaveEcho,
    copyEchoAtSl,
    cutEchoAtSl,
    findEchoInInv,
    menu.simulation.echo,
    openEchoEdit,
    openEchoPicker,
    pasteEchoClipboardIntoSlot,
    rmEchoSlts,
    saveEchoAtSl,
    selectEchoSlot,
  ])

  const makeEmptyEchoSlotMenu = useCallback((slotIndex: number) => (
    getEchoMptyC({
      menu: menu.simulation.echo,
      slotIndex,
      canSel: qppdEchoSlots.length > 0,
      mode: selMode,
      onPick: () => openEchoPicker(slotIndex),
      onOpenInv: openTeammateInventory,
      onPaste: () => {
        void pasteEchoClipboardIntoSlot(slotIndex)
      },
      onAll: selectAllEchoes,
      onNone: deselectAllEchoes,
    })
  ), [
    deselectAllEchoes,
    menu.simulation.echo,
    openEchoPicker,
    openTeammateInventory,
    pasteEchoClipboardIntoSlot,
    qppdEchoSlots.length,
    selectAllEchoes,
    selMode,
  ])

  const makeEchoPaneMenu = useCallback(() => (
    getEchoPaneC({
      menu: menu.simulation.echo,
      saved: currentSaved,
      canSaveAll: svblQppdChs.length > 0,
      canNqpAll: qppdCnt > 0,
      canSel: qppdEchoSlots.length > 0,
      mode: selMode,
      onOpenInv: openTeammateInventory,
      onImport: parserModal.show,
      onSaveBuild: saveBuild,
      onSaveAll: saveAllEchoes,
      onUnequipAll: unequipAllEchoes,
      onPaste: () => {
        void pasteEchoClipboardDefault()
      },
      onAll: selectAllEchoes,
      onNone: deselectAllEchoes,
    })
  ), [
    currentSaved,
    deselectAllEchoes,
    menu.simulation.echo,
    openTeammateInventory,
    parserModal.show,
    pasteEchoClipboardDefault,
    qppdCnt,
    qppdEchoSlots.length,
    saveAllEchoes,
    saveBuild,
    selectAllEchoes,
    selMode,
    svblQppdChs.length,
    unequipAllEchoes,
  ])

  const makeEchoSlotClick = useCallback((slotIndex: number, selectable: boolean) => (
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.defaultPrevented) {
        return
      }

      if (selMode && !selectable) {
        event.preventDefault()
        event.stopPropagation()
        return
      }

      if (selectable && event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        selectEchoRange(slotIndex)
        return
      }

      if (!selectable || (!selMode && !(event.metaKey || event.ctrlKey))) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      if (selMode) {
        toggleEchoSlot(slotIndex)
      } else {
        selectEchoSlot(slotIndex)
      }
    }
  ), [selectEchoRange, selectEchoSlot, selMode, toggleEchoSlot])

  // the detail expander is available only when the rendered description is
  // actually clamped by layout.
  useLayoutEffect(() => {
    const measure = () => {
      const el = briefBodyRef.current
      setBriefClamped(el ? el.scrollHeight - el.clientHeight > 2 : false)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [previewEcho?.uid, previewDef?.skillDesc, briefOpen, channel, wpnRackOpen])

  const echoCostTotal = equippedEchoes.reduce(
    (sum, echo) => sum + (echo ? getEchoById(echo.id)?.cost ?? 0 : 0),
    0,
  )
  // support echo positions exclude the explicit main echo; when no main exists,
  // present echoes fill the available support positions.
  const orbitEchoes = mainEcho
    ? equippedEchoes.filter((echo) => !echo || echo.uid !== mainEcho.uid)
    : [...presentEchoes, null, null, null, null].slice(0, 4)
  // one size value feeds both CSS and node geometry so the echo layout scales
  // without recalculating individual constants.
  const orbitSize = 25
  const orbitScale = orbitSize / 20
  // support echo geometry is authored per position; empty and equipped slots
  // share the same coordinate data.
  const orbitLayout = [
    { r: 5.7, a: 34, size: 3.2 },
    { r: 4.2, a: 126, size: 2.2 },
    { r: 6.2, a: 214, size: 2.7 },
    { r: 4.7, a: 308, size: 1.8 },
  ]
  const mainEchoSrc = useMemo(() => getMainEchoS(runtime), [runtime])
  const mainEchoStates = useMemo(() => {
    if (!mainEchoSrc) {
      return []
    }

    return listStatesFor(mainEchoSrc.type, mainEchoSrc.id).filter((state) =>
      isStateVisible(runtime, runtime, state, actRt),
    )
  }, [actRt, mainEchoSrc, runtime])

  const onWpnChng = useCallback((nextWeaponId: string) => {
    const selected = weapons.find((w) => w.id === nextWeaponId)
    if (!selected) return
    const stats = weaponStatsAt(selected, 90)

    onRtPdt((prev) => {
      const nextRuntime = {
        ...prev,
        build: {
          ...prev.build,
          weapon: { id: selected.id, level: 90, rank: 1, baseAtk: stats.atk },
        },
      }

      return initWpnStts(nextRuntime, {
        weaponId: selected.id,
        prevWpnId: prev.build.weapon.id,
        maxed: maxWpnOnInit,
      })
    })
  }, [maxWpnOnInit, weapons, onRtPdt])

  const onRackPick = useCallback((nextWeaponId: string) => {
    // picking the current weapon closes the rack without changing rank state.
    if (nextWeaponId !== weaponId) {
      onWpnChng(nextWeaponId)
    }
    setWpnRackOpen(false)
  }, [onWpnChng, setWpnRackOpen, weaponId])

  const onRankChng = useCallback((rank: number) => {
    const nextRank = Math.max(1, Math.min(5, Math.round(rank)))
    onRtPdt((prev) => ({
      ...prev,
      build: { ...prev.build, weapon: { ...prev.build.weapon, rank: nextRank } },
    }))
  }, [onRtPdt])

  const onWpnLvlChng = useCallback((level: number) => {
    onRtPdt((prev) => setWpnLvl(prev, level, weaponDef))
  }, [onRtPdt, weaponDef])

  const applyBldNow = useCallback((entry: SavedBuild) => {
    onRtPdt((prev) => {
      const bldWpnId = entry.build.weapon.id
      const bldWeapon = bldWpnId && !isNoWeaponId(bldWpnId) ? getWeapon(bldWpnId) : null
      const wpnMtchType = bldWeapon?.weaponType === member.weaponType
      const bldWpnStts = wpnMtchType && bldWeapon
        ? weaponStatsAt(bldWeapon, 90)
        : null

      const nextRuntime = {
        ...prev,
        build: {
          ...prev.build,
          weapon: wpnMtchType
            ? {
                ...prev.build.weapon,
                id: entry.build.weapon.id,
                level: 90,
                rank: entry.build.weapon.rank,
                baseAtk: bldWpnStts?.atk ?? prev.build.weapon.baseAtk,
              }
            : prev.build.weapon,
          echoes: cloneEchoLoadout(entry.build.echoes),
        },
      }

      return wpnMtchType && bldWpnId
        ? initWpnStts(nextRuntime, {
          weaponId: bldWpnId,
          prevWpnId: prev.build.weapon.id,
          maxed: maxWpnOnInit,
        })
        : nextRuntime
    })
  }, [maxWpnOnInit, member.weaponType, onRtPdt])

  const confirmApplyBld = useCallback((entry: SavedBuild, options?: { pasted?: boolean }) => {
    confirmation.confirm({
      title: 'Load build?',
      message: options?.pasted
        ? `Paste and load "${entry.name}" from ${entry.resonatorName}? This replaces this teammate's echoes and may replace the weapon if the type matches.`
        : `Load "${entry.name}" from ${entry.resonatorName}? This replaces this teammate's echoes and may replace the weapon if the type matches.`,
      confirmLabel: 'Load Build',
      onConfirm: () => {
        applyBldNow(entry)
        showToast({
          content: `Loaded ${entry.name}.`,
          variant: 'success',
          duration: 2400,
        })
      },
    })
  }, [applyBldNow, confirmation, showToast])

  const copyBuildToClipboard = useCallback(async (entry: SavedBuild) => {
    const wrote = await writeBuildClpb({
      kind: 'build-clipboard',
      version: 1,
      builds: [entry],
    })
    showToast({
      content: wrote ? `Copied ${entry.name}.` : 'Clipboard write failed.',
      variant: wrote ? 'success' : 'error',
      duration: wrote ? 2200 : 3000,
    })
  }, [showToast])

  const pasteBuildClipboard = useCallback(async () => {
    const payload = await readBuildClpb()
    const entry = payload?.builds[0] ?? null
    if (!entry) {
      showToast({
        content: 'Clipboard does not contain a saved build.',
        variant: 'warning',
        duration: 3200,
      })
      return
    }

    confirmApplyBld(entry, { pasted: true })
  }, [confirmApplyBld, showToast])

  const buildPaneMenu = useMemo(() => [
    {
      id: 'member-builds:paste',
      label: 'Paste Build',
      icon: <Clipboard size="1em" />,
      onSelect: () => {
        void pasteBuildClipboard()
      },
    },
  ], [pasteBuildClipboard])

  const navBadges: Partial<Record<ChannelId, number>> = {
    skills: trcNodesOn,
    effects: sttDefs.length + weaponStates.length,
    echoes: activeSets.length,
  }

  const channels = CHANNELS.filter((entry) => allChannels || !entry.activeOnly || isActive)
  // switching from the active resonator to a teammate can leave the console on
  // a channel that member does not have, so the view falls back rather than
  // rendering an empty stage.
  const actChannel = channels.some((entry) => entry.id === channel) ? channel : 'loadout'

  /* the channel bodies are the stage. a modal frame stands them in a spine
     and a head; a page stands them on their own, so the frame is what the
     branch below adds rather than something a page has to undo. */
  const stageBody = (
          <div className="mcc-stage-body" key={wpnRackOpen ? 'weapon-rack' : actChannel}>
            {wpnRackOpen ? (
              <div className="mcc-block">
                <div className="mcc-block-head">
                  <span className="mcc-block-label">{getWpnTypeLb(member.weaponType)}s</span>
                  <span className="mcc-block-meta">{weapons.length}</span>
                </div>
                <div className="mcc-rack-grid">
                  {weapons.map((def, index) => (
                    <WeaponCard
                      key={def.id}
                      def={def}
                      equipped={def.id === weaponId}
                      index={index}
                      onPick={() => onRackPick(def.id)}
                    />
                  ))}
                </div>
                <p className="mcc-applicator-note">
                  Tap a weapon to equip it. Values shown at Lv 90.
                </p>
              </div>
            ) : null}

            {!wpnRackOpen && actChannel === 'loadout' ? (
              <>
                <div className="mcc-block">
                  <div className="mcc-block-head">
                    <span className="mcc-block-label">
                      {showAllBlds ? 'All saved builds' : 'Saved builds'}
                    </span>
                    <span className="mcc-block-meta">{vsblBlds.length}</span>
                  </div>
                  <div className="mcc-build-grid">
                    {vsblBlds.map((entry, index) => (
                      <ContextTrigger
                        key={entry.id}
                        asChild
                        ariaLabel={`${entry.name} build actions`}
                        items={[
                          {
                            id: `member-build:${entry.id}:load`,
                            label: 'Load Build',
                            icon: <Layers size="1em" />,
                            onSelect: () => confirmApplyBld(entry),
                          },
                          {
                            id: `member-build:${entry.id}:copy`,
                            label: 'Copy',
                            icon: <Copy size="1em" />,
                            onSelect: () => {
                              void copyBuildToClipboard(entry)
                            },
                          },
                          {
                            id: `member-build:${entry.id}:paste`,
                            label: 'Paste Build',
                            icon: <Clipboard size="1em" />,
                            onSelect: () => {
                              void pasteBuildClipboard()
                            },
                          },
                        ]}
                      >
                        <span className="mcc-build-card-wrap">
                          <BuildCard
                            entry={entry}
                            member={
                              entry.resonatorId === member.id
                                ? member
                                : (getResonator(entry.resonatorId) ?? member)
                            }
                            index={index}
                            onApply={() => confirmApplyBld(entry)}
                          />
                        </span>
                      </ContextTrigger>
                    ))}
                    <button
                      type="button"
                      className={`mcc-build-card mcc-build-card--ghost${showAllBlds ? ' active' : ''}`}
                      style={{ '--mcc-card-index': Math.min(vsblBlds.length, 6) } as CssProps}
                      aria-pressed={showAllBlds}
                      onClick={() => setShowAllBlds((prev) => !prev)}
                    >
                      <Layers size="0.875rem" aria-hidden="true" />
                      All builds
                    </button>
                  </div>
                  <p className="mcc-applicator-note">
                    {showAllBlds
                      ? "Tap a build to apply it."
                      : myBlds.length > 0
                        ? 'Tap a build to apply its weapon and echoes.'
                        : `No saved builds for ${member.name} yet. Save one from the echo inventory.`}
                  </p>
                </div>

                {!showAllBlds ? (
                  <div className="mcc-block">
                    <div className="mcc-block-head">
                      <span className="mcc-block-label">Combat Stats</span>
                      <span className="mcc-block-meta">Live</span>
                    </div>
                    <TelemetryBoard statsView={cmbtSttsView} />
                  </div>
                ) : null}
              </>
            ) : null}

            {!wpnRackOpen && actChannel === 'skills' ? (
              /*
                the tree brings its own skin per surface, and the frame already
                says which one this is: a modal panel, or bare on a page.
              */
              <ForteTree
                surface={onBare ? 'page' : 'console'}
                branches={skillTree}
                dock={forteDock}
                mode={forteMode}
                modeValue={forteMode
                  ? String(
                    readRtPath(runtime, mkCntrPath(forteMode.controlKey))
                      ?? forteMode.defaultValue,
                  )
                  : ''}
                skillLevel={(branch) => runtime.base.skillLevels[branch.key]}
                dockLevel={(entry) => (
                  entry.key === 'outroSkill' ? 0 : runtime.base.skillLevels[entry.key]
                )}
                activeNodes={runtime.base.traceNodes.activeNodes}
                onSkillChange={(branch, next) => onSkllChng(branch.key, next)}
                onDockChange={onDockChng}
                onModeChange={(next) => forteMode && onModeChng(forteMode.controlKey, next)}
                onTraceToggle={onTrcTgl}
              />
            ) : null}

            {!wpnRackOpen && actChannel === 'effects' ? (
              effectSections.length > 0 ? (
                effectSections.map((section) => {
                  const isWpnSection = section.id === 'weapon'
                  return (
                    <Expandable
                      key={section.id} className="mcc-block"
                      style={
                        isWpnSection && weaponDef
                          ? rarityVars(weaponDef.rarity, false, '--mcc-accent') as CssProps
                          : undefined
                      }
                      defaultOpen
                      plainTrigger
                      noHeaderWrap
                      TriggerTag="button"
                      triggerClass="mcc-block-head mcc-block-head--fold"
                      chevWrapClass="mcc-block-chev"
                      chevronSize={13}
                      innerClass="mcc-block-fold"
                      header={(
                        <>
                          <span className="mcc-block-label">{section.label}</span>
                          <span className="mcc-block-meta">
                            {isWpnSection && weaponDef?.passive.name
                              ? weaponDef.passive.name
                              : section.states.length}
                          </span>
                        </>
                      )}
                    >
                      {isWpnSection && weaponOwner?.description ? (
                        <div className="mcc-passive-desc">
                          <RichDscr description={weaponOwner.description} params={pssvPrms} />
                        </div>
                      ) : null}

                      {section.states.length > 0 ? (
                        <div className="mcc-state-gallery">
                          {section.states.map((state) => (
                            <StateCell key={state.controlKey} active={stateIsLive(runtime, state, actRt)}>
                              <SourceStateCtrl
                                srcRt={runtime}
                                tgtRt={runtime}
                                actRt={actRt}
                                state={state}
                                onRtPdt={cscdRtUpd}
                                teamTgtSlct={mkRouting(state)}
                                dscrPrms={isWpnSection ? pssvPrms : undefined}
                              />
                            </StateCell>
                          ))}
                        </div>
                      ) : null}
                    </Expandable>
                  )
                })
              ) : (
                <div className="mcc-empty">
                  No effects to drive right now. They appear as this kit unlocks them.
                </div>
              )
            ) : null}

            {!wpnRackOpen && actChannel === 'echoes' ? (
              <>
                <ContextTrigger asChild ariaLabel="Teammate echo actions" items={makeEchoPaneMenu()}>
                  <div
                    className={`mcc-block${selMode ? ' selection-mode' : ''}`}
                    {...selection.surfaceProps}
                  >
                    <div className="mcc-block-head">
                      <span className="mcc-block-label">Equipped echoes</span>
                      <span className="mcc-block-meta">{echoCostTotal} cost</span>
                      <span className="mcc-block-actions" role="group" aria-label="Echo build actions">
                        <button type="button" className="mcc-block-action" onClick={quickSetupModal.show}>
                          Forge
                        </button>
                        <button type="button" className="mcc-block-action" onClick={parserModal.show}>
                          Import
                        </button>
                        <button type="button" className="mcc-block-action" onClick={() => openTeammateInventory()}>
                          Inventory
                        </button>
                        <button type="button" className="mcc-block-action" disabled={currentSaved} onClick={saveBuild}>
                          {currentSaved ? 'Saved' : 'Save build'}
                        </button>
                        <button type="button" className="mcc-block-action" disabled={svblQppdChs.length === 0} onClick={saveAllEchoes}>
                          Save all
                        </button>
                        <button type="button" className="mcc-block-action is-danger" disabled={qppdCnt === 0} onClick={unequipAllEchoes}>
                          Unequip all
                        </button>
                      </span>
                    </div>

                  {hasEchoes ? (
                    <>
                      <div className="mcc-echo-orbit-wrap"
                        style={{ '--orbit-size': `${orbitSize}rem` } as CssProps}
                      >
                        <div className="mcc-orbit" role="radiogroup" aria-label="Equipped echoes">
                          <span className="mcc-orbit-field" aria-hidden="true" />
                          {orbitLayout.map((cfg, index) => (
                            <span
                              key={`path-${index}`}
                              className={`mcc-orbit-path${index % 2 === 1 ? ' is-dashed' : ''}`}
                              style={{
                                width: `${(cfg.r * 3 * orbitScale).toFixed(2)}rem`,
                                height: `${(cfg.r * 3 * orbitScale).toFixed(2)}rem`,
                              }}
                              aria-hidden="true"
                            />
                          ))}

                          {mainEcho ? (
                            (() => {
                              const slotIndex = equippedEchoes.findIndex((echo) => echo?.uid === mainEcho.uid)
                              const isSelected = selectedEchoSlots.has(slotIndex)
                              return (
                                <ContextTrigger
                                  key={mainEcho.uid}
                                  asChild
                                  ariaLabel={`${mainEchoDef?.name ?? 'Echo'} actions`}
                                  items={makeEchoSlotMenu(slotIndex, mainEcho)}
                                >
                                  <button
                                    type="button"
                                    role="radio"
                                    aria-checked={previewEcho?.uid === mainEcho.uid}
                                    className={[
                                      'mcc-orbit-core',
                                      previewEcho?.uid === mainEcho.uid ? 'is-active' : '',
                                      isSelected ? 'focus-selected' : '',
                                      selMode ? 'selection-mode' : '',
                                    ].filter(Boolean).join(' ')}
                                    data-selection-focus-item="true"
                                    aria-selected={isSelected ? 'true' : 'false'}
                                    title={`${mainEchoDef?.name ?? 'Echo'} (main echo)`}
                                    onClickCapture={makeEchoSlotClick(slotIndex, slotIndex >= 0)}
                                    onClick={() => pickPreview(mainEcho.uid)}
                                  >
                                    <span className="mcc-orbit-face">
                                      {mainEchoDef?.icon ? (
                                        <img src={mainEchoDef.icon} alt="" loading="lazy" onError={withDefIconM} />
                                      ) : (
                                        <span className="mcc-echo-slot-void" />
                                      )}
                                    </span>
                                    <span className="mcc-orbit-sat is-cost">{mainEchoDef?.cost ?? 0}</span>
                                    {getSntSetIco(mainEcho.set) ? (
                                      <span className="mcc-orbit-sat is-set" title={getSntSetNam(mainEcho.set)}>
                                        <img src={getSntSetIco(mainEcho.set) ?? ''} alt="" onError={withDefIconM} />
                                      </span>
                                    ) : null}
                                  </button>
                                </ContextTrigger>
                              )
                            })()
                          ) : (
                            <span className="mcc-orbit-core is-empty" title="No main echo" aria-hidden="true">
                              <span className="mcc-orbit-face">
                                <span className="mcc-echo-slot-void" />
                              </span>
                            </span>
                          )}

                          {orbitEchoes.map((echo, index) => {
                            const cfg = orbitLayout[index] ?? orbitLayout[0]
                            const rad = (cfg.a * Math.PI) / 180
                            const style = {
                              '--orbit-x': `${(cfg.r * 1.4 * orbitScale * Math.sin(rad)).toFixed(2)}rem`,
                              '--orbit-y': `${(-cfg.r * 1.4 * orbitScale * Math.cos(rad)).toFixed(2)}rem`,
                              width: `${(cfg.size * orbitScale).toFixed(2)}rem`,
                              height: `${(cfg.size * orbitScale).toFixed(2)}rem`,
                            } as CssProps

                            if (!echo) {
                              const emptySlot = equippedEchoes.findIndex((entry) => entry == null)
                              return (
                                <ContextTrigger
                                  key={`empty-${index}`}
                                  asChild
                                  ariaLabel="Empty echo slot actions"
                                  items={emptySlot >= 0 ? makeEmptyEchoSlotMenu(emptySlot) : []}
                                >
                                  <span className="mcc-orbit-node is-empty"
                                    style={style}
                                    aria-hidden="true"
                                  >
                                    <span className="mcc-orbit-face">
                                      <span className="mcc-echo-slot-void" />
                                    </span>
                                  </span>
                                </ContextTrigger>
                              )
                            }

                            const def = getEchoById(echo.id)
                            const setIcon = getSntSetIco(echo.set)
                            const isActive = echo.uid === (previewEcho?.uid ?? null)
                            const slotIndex = equippedEchoes.findIndex((entry) => entry?.uid === echo.uid)
                            const isSelected = selectedEchoSlots.has(slotIndex)
                            return (
                              <ContextTrigger
                                key={echo.uid}
                                asChild
                                ariaLabel={`${def?.name ?? 'Echo'} actions`}
                                items={makeEchoSlotMenu(slotIndex, echo)}
                              >
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={isActive}
                                  className={[
                                    'mcc-orbit-node',
                                    isActive ? 'is-active' : '',
                                    isSelected ? 'focus-selected' : '',
                                    selMode ? 'selection-mode' : '',
                                  ].filter(Boolean).join(' ')}
                                  data-selection-focus-item="true"
                                  aria-selected={isSelected ? 'true' : 'false'}
                                  style={style}
                                  title={def?.name ?? 'Echo'}
                                  onClickCapture={makeEchoSlotClick(slotIndex, slotIndex >= 0)}
                                  onClick={() => pickPreview(echo.uid)}
                                >
                                  <span className="mcc-orbit-face">
                                    {def?.icon ? (
                                      <img src={def.icon} alt="" loading="lazy" onError={withDefIconM} />
                                    ) : (
                                      <span className="mcc-echo-slot-void" />
                                    )}
                                  </span>
                                  <span className="mcc-orbit-sat is-cost">{def?.cost ?? 0}</span>
                                  {setIcon ? (
                                    <span className="mcc-orbit-sat is-set" title={getSntSetNam(echo.set)}>
                                      <img src={setIcon} alt="" onError={withDefIconM} />
                                    </span>
                                  ) : null}
                                </button>
                              </ContextTrigger>
                            )
                          })}
                        </div>

                        {previewEcho && previewDef ? (
                          <div className={`mcc-echo-preview${briefOpen ? ' is-brief-open' : ''}`}>
                            <EchoReadout
                              echo={previewEcho}
                            />
                            {(() => {
                              const slotIndex = equippedEchoes.findIndex((echo) => echo?.uid === previewEcho.uid)
                              return slotIndex >= 0 ? (
                                <EchoActions
                                  echo={previewEcho}
                                  isMain={mainEcho != null && previewEcho.uid === mainEcho.uid}
                                  canSave={canSaveEcho(previewEcho)}
                                  onSetMain={setMainEcho}
                                  onSave={() => saveEchoAtSl(slotIndex)}
                                  onEdit={openEchoEdit}
                                  onChange={() => openEchoPicker(slotIndex)}
                                  onUnequip={unequipEcho}
                                />
                              ) : null
                            })()}
                            <div className="mcc-echo-brief">
                              <div className="mcc-echo-brief-head">
                                <span className="mcc-echo-brief-name">{previewDef.name}</span>
                                <span className="mcc-echo-brief-tags">
                                  {getSntSetIco(previewEcho.set) ? (
                                    <span className="mcc-echo-brief-set" title={getSntSetNam(previewEcho.set)}>
                                      <img src={getSntSetIco(previewEcho.set) ?? ''} alt="" onError={withDefIconM} />
                                    </span>
                                  ) : null}
                                  <span className="mcc-echo-brief-cost">{previewDef.cost}C</span>
                                  {mainEcho != null && previewEcho.uid === mainEcho.uid ? (
                                    <span className="mcc-echo-brief-main">Main</span>
                                  ) : null}
                                </span>
                              </div>
                              {previewDef.skillDesc ? (
                                <>
                                  <div
                                    ref={briefBodyRef}
                                    className={`mcc-echo-brief-body${!briefOpen && briefClamped ? ' is-clamped' : ''}`}
                                  >
                                    <RichDscr description={previewDef.skillDesc} />
                                  </div>
                                  {briefOpen ? (
                                    <button
                                      type="button" className="mcc-echo-brief-toggle"
                                      onClick={() => setBriefOpen(false)}
                                    >
                                      Show less
                                    </button>
                                  ) : briefClamped ? (
                                    <button
                                      type="button" className="mcc-echo-brief-toggle"
                                      onClick={() => setBriefOpen(true)}
                                    >
                                      Read more
                                    </button>
                                  ) : null}
                                </>
                              ) : (
                                <p className="mcc-echo-brief-empty">
                                  This echo has no active skill. Only the main echo's skill fires in combat.
                                </p>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="mcc-empty">No echoes are equipped yet.</div>
                  )}
                  </div>
                </ContextTrigger>

                {(mainEchoDef && mainEchoStates.length > 0) ? (
                  <div className="mcc-block">
                    <div className="mcc-block-head">
                      <span className="mcc-block-label">Main echo skill</span>
                      <span className="mcc-block-meta">{mainEchoDef.name}</span>
                    </div>
                    <div className="mcc-state-gallery">
                      {mainEchoStates.map((state) => (
                        <StateCell key={state.controlKey}>
                          <SourceStateCtrl
                            srcRt={runtime}
                            tgtRt={runtime}
                            actRt={actRt}
                            state={state}
                            onRtPdt={cscdRtUpd}
                            teamTgtSlct={mkRouting(state)}
                            hideDscr
                          />
                        </StateCell>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mcc-block">
                  <div className="mcc-block-head">
                    <span className="mcc-block-label">Sonata sets</span>
                    <span className="mcc-block-meta">{activeSets.length}</span>
                  </div>

                  {activeSets.length > 0 ? (
                    activeSets.map(({ setId, count }) => {
                      const def = getEchoSetDe(setId)
                      if (!def) {
                        return null
                      }

                      const icon = getSntSetIco(setId)
                      const pieceReq = def.setMax === 1 ? 1 : def.setMax === 3 ? 3 : 5
                      const hasPieceReq = count >= pieceReq
                      const isPassiveKey = (key: string) =>
                        key === 'onePiece' || key === 'twoPiece' || key === 'threePiece' || key === 'fivePiece'
                      const tierLabel = (key: string) => {
                        if (key === 'onePiece') return '1pc'
                        if (key === 'twoPiece') return '2pc'
                        if (key === 'threePiece') return '3pc'
                        if (key === 'fivePiece') return '5pc'
                        return ''
                      }
                      const passiveParts = def.parts.filter((part) => {
                        if (!isPassiveKey(part.key)) return false
                        if (part.key === 'onePiece') return count >= 1
                        if (part.key === 'twoPiece') return count >= 2
                        return count >= pieceReq
                      })
                      const setStates = hasPieceReq
                        ? listStatesFor('echoSet', String(setId)).filter((state) =>
                            isStateVisible(runtime, runtime, state, actRt),
                          )
                        : []

                      return (
                        <div key={setId} className="mcc-set">
                          <div className="mcc-set-head">
                            <span className="mcc-set-icon">
                              {icon ? <img src={icon} alt="" onError={withDefIconM} /> : null}
                            </span>
                            <span className="mcc-set-name">{def.name}</span>
                            <span className="mcc-set-meter">
                              <span className="mcc-set-pips" aria-hidden="true">
                                {Array.from({ length: pieceReq }, (_, index) => (
                                  <span
                                    key={index}
                                    className={`mcc-set-pip${index < count ? ' filled' : ''}`}
                                  />
                                ))}
                              </span>
                              <span className="mcc-set-count">{count}/{pieceReq}</span>
                            </span>
                          </div>

                          {passiveParts.map((part) => (
                            <div key={part.key} className="mcc-set-tier">
                              <span className="mcc-set-tier-tag">{tierLabel(part.key)}</span>
                              <RichDscr
                                description={part.description ?? part.label} className="mcc-set-tier-desc"
                              />
                            </div>
                          ))}

                          {setStates.length > 0 ? (
                            <div className="mcc-state-gallery">
                              {setStates.map((state) => (
                                <StateCell key={state.controlKey}>
                                  <SourceStateCtrl
                                    srcRt={runtime}
                                    tgtRt={runtime}
                                    actRt={actRt}
                                    state={state}
                                    onRtPdt={cscdRtUpd}
                                    teamTgtSlct={mkRouting(state)}
                                  />
                                </StateCell>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )
                    })
                  ) : (
                    <div className="mcc-empty">
                      No set effects are active. Equip 2 or more pieces of a sonata set.
                    </div>
                  )}
                </div>
              </>
            ) : null}

            {!wpnRackOpen && actChannel === 'buffs' ? (
              <TeammateManualBuffs runtime={runtime} onRtPdt={onRtPdt} />
            ) : null}
          </div>
  )

  return (
    <>
      <ContextTrigger asChild ariaLabel="Teammate build actions" items={buildPaneMenu}>
        {onBare ? stageBody : (
        <div className="mcc-root"
          onClick={(event) => event.stopPropagation()}
        >
        <aside className="mcc-spine">
          <div className="mcc-plinth">
            <img
              src={member.sprite || member.profile}
              alt="" className="mcc-plinth-art"
              style={spriteVars(member)}
              onError={withDefResMg}
            />
            <div className="mcc-plinth-scrim" aria-hidden="true" />
            <div className="mcc-plinth-id">
              <span className="mcc-plinth-eyebrow">{isActive ? 'Active' : 'Teammate'}</span>
              <h2 id="teammate-config-title" className="mcc-plinth-name">{member.name}</h2>
              {canManageSeat ? (
                <div className="mcc-plinth-acts">
                  <button
                    type="button" className="mcc-plinth-act"
                    onClick={() => seatPicker.show()}
                  >
                    <ArrowRightLeft size="0.72rem" />
                    Change
                  </button>
                  <button
                    type="button" className="mcc-plinth-act mcc-plinth-act--drop"
                    onClick={onSeatRemove}
                  >
                    <Trash2 size="0.72rem" />
                    Remove
                  </button>
                </div>
              ) : null}
              <div className="mcc-plinth-tags">
                <span className="mcc-tag">
                  <img
                    src={`/assets/game/attributes/icons/${member.attribute}.webp`}
                    alt={member.attribute}
                    style={member.attribute === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
                    onError={withDefIconM}
                  />
                  {getWpnTypeLb(member.weaponType)}
                </span>
                {!isActive ? <span className="mcc-tag">Lv {runtime.base.level}</span> : null}
                <span className="mcc-tag">S{runtime.base.sequence}</span>
              </div>
              <div className="mcc-plinth-chain">
                <ChainDial
                  label="Resonance chain"
                  prefix="S"
                  min={0}
                  max={6}
                  value={runtime.base.sequence}
                  compact
                  onChange={(next) => onSqncChng(Math.max(0, Math.min(6, next)))}
                />
              </div>
            </div>
          </div>


          {isActive ? (
            <div className="mcc-spine-lvl">
              <LevelRail
                label="Level"
                value={runtime.base.level}
                min={RES_LVL_MIN}
                max={RES_LVL_MAX}
                stops={ASCENSION_STOPS}
                onChange={onLvlChng}
              />
            </div>
          ) : null}

          <div className="mcc-spine-foot"
            style={weaponDef ? rarityVars(weaponDef.rarity, false, '--mcc-accent') as CssProps : undefined}
          >
            <button
              type="button"
              className={`mcc-foot-weapon${wpnRackOpen ? ' is-open' : ''}`}
              aria-expanded={wpnRackOpen}
              onClick={() => setWpnRackOpen(!wpnRackOpen)}
            >
              <img
                src={weaponDef?.icon ?? `/assets/game/weapons/icons/${weaponId}.webp`}
                alt=""
                onError={withDefWpnMg}
              />
              <span className="mcc-foot-weapon-meta">
                <span className="mcc-foot-weapon-overline">Weapon</span>
                <span className="mcc-foot-weapon-name">{weaponDef?.name ?? 'No weapon'}</span>
              </span>
              <span className="mcc-foot-weapon-rank">R{currentRank}</span>
            </button>

            {isActive && weaponDef ? (
              <LevelRail
                label="Weapon level"
                value={runtime.build.weapon.level}
                min={RES_LVL_MIN}
                max={RES_LVL_MAX}
                stops={ASCENSION_STOPS}
                onChange={onWpnLvlChng}
              />
            ) : null}

            {weaponDef && wpnStats ? (
              <div className="mcc-foot-stats">
                <span className="mcc-foot-stat">
                  <span className="mcc-stat-glyph"
                    aria-hidden="true"
                    style={{
                      WebkitMaskImage: `url(${WPN_STAT_CNS.atk})`,
                      maskImage: `url(${WPN_STAT_CNS.atk})`,
                    } as CssProps}
                  />
                  <i>{Math.round(wpnStats.atk)}</i>
                </span>
                <span className="mcc-foot-stat">
                  {WPN_STAT_CNS[weaponDef.statKey] ? (
                    <span className="mcc-stat-glyph"
                      aria-hidden="true"
                      style={{
                        WebkitMaskImage: `url(${WPN_STAT_CNS[weaponDef.statKey]})`,
                        maskImage: `url(${WPN_STAT_CNS[weaponDef.statKey]})`,
                      } as CssProps}
                    />
                  ) : null}
                  <i>{fmtWpnStatDs(weaponDef.statKey, wpnStats.scndStatVl)}</i>
                </span>
              </div>
            ) : null}

            <ChainDial
              label="Rank"
              prefix="R"
              min={1}
              max={5}
              value={currentRank}
              compact
              onChange={onRankChng}
            />
          </div>
        </aside>

        <section className="mcc-stage">
          <header className="mcc-stage-head">
            <nav className="mcc-tabs" aria-label="Resonator config sections">
              {channels.map((entry) => {
                const badge = navBadges[entry.id]
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`mcc-tab${entry.id === actChannel && !wpnRackOpen ? ' active' : ''}`}
                    aria-current={entry.id === actChannel && !wpnRackOpen ? 'true' : undefined}
                    onClick={() => {
                      setChannel(entry.id)
                      onChannelChange?.(entry.id)
                      setWpnRackOpen(false)
                    }}
                  >
                    <span className="mcc-tab-icon" aria-hidden="true">{entry.icon}</span>
                    {entry.label}
                    {typeof badge === 'number' && badge > 0 ? (
                      <span className="mcc-tab-badge">{badge}</span>
                    ) : null}
                  </button>
                )
              })}
            </nav>
            {roster.length > 1 ? (
              <div className="mcc-switch" role="group" aria-label="Switch teammate view">
                {roster.map((mate) => {
                  const isCurrent = mate.id === member.id
                  return (
                    <button
                      key={mate.id}
                      type="button"
                      className={`mcc-switch-chip${isCurrent ? ' active' : ''}`}
                      style={{ '--mcc-switch-accent': ATTR_COLORS[mate.attribute] } as CssProps}
                      aria-pressed={isCurrent}
                      aria-label={isCurrent ? `${mate.name} (current view)` : `Switch to ${mate.name}`}
                      title={isCurrent ? `${mate.name} (current view)` : `Switch to ${mate.name}`}
                      onClick={() => {
                        if (!isCurrent) {
                          onSwitchMember(mate.id)
                        }
                      }}
                    >
                      <img src={mate.profile} alt="" onError={withDefResMg} />
                    </button>
                  )
                })}
              </div>
            ) : null}
              <button type="button" className="mcc-close" aria-label="Close" onClick={onClose}>
                <X size="1rem" />
              </button>
          </header>

          {stageBody}
        </section>
        </div>
        )}
      </ContextTrigger>
    {echoEditModal.visible && editSlot != null && editEcho ? (
      <Edit
        visible={echoEditModal.visible}
        open={echoEditModal.open}
        closing={echoEditModal.closing}
        portalTarget={dialogHost}
        echo={editEcho}
        slotIndex={editSlot}
        echoes={allEchoes}
        maxCost={maxCostForEditSlot}
        onSave={onEchoEditSave}
        onClear={onEditClear}
        onClose={() => echoEditModal.hide()}
      />
    ) : null}
    {canManageSeat && seatPicker.visible ? (
      <ResPckr
        visible={seatPicker.visible}
        open={seatPicker.open}
        closing={seatPicker.closing}
        portalTarget={dialogHost}
        eyebrow="Team Slots"
        title="Select Teammate"
        resonators={eligibleForSlot(actRt.build.team, seatIndex)}
        selResId={member.id}
        selLbl="Selected"
        smmrPrmr={{ label: 'Slot', value: seatIndex + 1 }}
        emptyState={<p>No eligible resonators remain for this slot.</p>}
        panelWidth="regular"
        onClose={() => seatPicker.hide()}
        onSelect={onSeatSelect}
      />
    ) : null}
    {echoPickerModal.visible && pickerSlot != null ? (
      <EchoPicker
        visible={echoPickerModal.visible}
        open={echoPickerModal.open}
        closing={echoPickerModal.closing}
        portalTarget={dialogHost}
        echoes={allEchoes}
        selEchoId={runtime.build.echoes[pickerSlot]?.id ?? null}
        slotIndex={pickerSlot}
        maxCost={maxCostForPickerSlot}
        onSelect={onPickerSelect}
        onClear={onPickerClear}
        onClose={closeEchoPicker}
      />
    ) : null}
    {parserModal.visible ? (
      <Parser
        visible={parserModal.visible}
        open={parserModal.open}
        closing={parserModal.closing}
        portalTarget={dialogHost}
        charId={runtime.id}
        runtime={runtime}
        currentEchoes={runtime.build.echoes}
        onApplyRead={(_, next) => {
          onRtPdt(next)
          showToast({
            content: 'Build imported.',
            variant: 'success',
            duration: 2600,
          })
        }}
        onEquipEcho={(echoes) => {
          onRtPdt((prev) => ({
            ...prev,
            build: { ...prev.build, echoes },
          }))
        }}
        onClose={parserModal.hide}
      />
    ) : null}
    {quickSetupModal.visible ? (
      <QuickSetup
        visible={quickSetupModal.visible}
        open={quickSetupModal.open}
        closing={quickSetupModal.closing}
        portalTarget={dialogHost}
        currentEchoes={runtime.build.echoes}
        onClose={quickSetupModal.hide}
        onGenerate={(echoes) => {
          onRtPdt((prev) => ({
            ...prev,
            build: { ...prev.build, echoes },
          }))
          showToast({
            content: 'Echo build forged.',
            variant: 'success',
            duration: 2600,
          })
          quickSetupModal.hide()
        }}
      />
    ) : null}
    {invModal.visible ? (
      <InvMdl
        key={invEchoSearch ? `teammate-inventory:${runtime.id}:${invEchoSearch}` : `teammate-inventory:${runtime.id}`}
        visible={invModal.visible}
        open={invModal.open}
        closing={invModal.closing}
        portalTarget={dialogHost}
        resonatorId={runtime.id}
        currentBuild={{
          weapon: runtime.build.weapon,
          echoes: runtime.build.echoes,
        }}
        invChs={invChs}
        invBlds={invBlds}
        ntlEchoSrch={invEchoSearch}
        bldUsrsById={invSg.buildUseByBldId}
        echoSgByUid={invSg.echoUseByUid}
        onClose={() => {
          invModal.hide(() => setInvEchoSearch(''))
        }}
        onQpInvEcho={equipInvEcho}
        onEditEcho={(entry) => invEchoEditModal.show(entry.id)}
        onAddInvChs={(echoes) => addEchoesToInv(echoes).length}
        onSaveInitEchoes={saveTeammateEquippedToInv}
        onRmvInvEcho={rmEchoFromInv}
        onRmvInvChs={(entryIds) => {
          for (const entryId of entryIds) {
            rmEchoFromInv(entryId)
          }
        }}
        onClrInvChs={clrInvEchoes}
        onQpInvBld={confirmApplyBld}
        onPdtInvBlgk={(entryId, name) => updInvBuild(entryId, { name })}
        onRmvInvBld={rmInvBuild}
        onClrInvBlds={clrInvBuilds}
      />
    ) : null}
    {(() => {
      const editingEntry = invEchoEditModal.value
        ? invChs.find((entry) => entry.id === invEchoEditModal.value) ?? null
        : null
      return editingEntry ? (
        <Edit
          visible={invEchoEditModal.visible}
          open={invEchoEditModal.open}
          closing={invEchoEditModal.closing}
          portalTarget={dialogHost}
          echo={editingEntry.echo}
          slotIndex={0}
          onSave={(updated) => {
            updEchoInInv(editingEntry.id, {
              ...updated,
              uid: editingEntry.echo.uid,
            })
            invEchoEditModal.hide()
          }}
          onClose={() => invEchoEditModal.hide()}
        />
      ) : null
    })()}
    <ConfirmHost control={confirmation} portalTarget={dialogHost} />
    </>
  )
}

// the modal shell stays mounted across view switches so only the resonator
// view remounts; keying by member id resets all per-member local state.
export { ResonatorView as MemberStage }
