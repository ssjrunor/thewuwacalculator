import type { ChangeEvent, ReactNode } from 'react'
import { useRef } from 'react'
import { ConfirmationModal } from '@/shared/ui/ConfirmationModal'
import { useConfirmation } from '@/app/hooks/useConfirmation.ts'
import { getMainContentPortalTarget } from '@/shared/lib/portalTarget'
import { CopyPlus, Plus, Power, PowerOff, Trash2 } from 'lucide-react'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type {
  ManualBaseStatKey,
  ManualBuffs,
  ManualModifier,
  ManualModifierScope,
  ManualModifierValueKey,
  ManualQuickBuffs,
  ManualSkillMatchMode,
  ManualTopStatKey,
} from '@/domain/entities/manualBuffs'
import {
  makeDefaultCustomBuffs,
  makeDefaultManualModifier,
} from '@/domain/state/defaults'
import { manualBuffsSchema } from '@/domain/state/manualBuffsSchema'
import { Expandable } from '@/shared/ui/Expandable'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import type { RuntimeUpdateHandler } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import {getResonatorById} from "@/domain/services/catalogService.ts";
import { resolveSkill } from '@/engine/pipeline/resolveSkill'
import { MANUAL_BUFF_SKILL_TAB_ORDER, makeSkillTabOptions } from '@/modules/calculator/model/skillTabs'

interface ManualBuffEditorProps {
  runtime: ResonatorRuntimeState
  onRuntimeUpdate: RuntimeUpdateHandler
  cardVariant?: 'section' | 'inner'
  showQuickStats?: boolean
  showTransferActions?: boolean
}

// exposes the manual buff editor controls and ties them back to the shared runtime handler.

const MAIN_STAT_BUFF_ROWS: Array<{ label: string; stat: ManualBaseStatKey }> = [
  { label: 'Attack', stat: 'atk' },
  { label: 'HP', stat: 'hp' },
  { label: 'Defense', stat: 'def' },
]

const MAIN_SCALAR_BUFF_FIELDS: Array<{
  key: Exclude<keyof ManualQuickBuffs, 'atk' | 'hp' | 'def'>
  label: string
}> = [
  { key: 'critRate', label: 'Crit Rate' },
  { key: 'critDmg', label: 'Crit DMG' },
  { key: 'energyRegen', label: 'Energy Regen' },
  { key: 'healingBonus', label: 'Healing Bonus' },
]

const ADVANCED_SCOPE_OPTIONS: Array<{ value: ManualModifierScope; label: string }> = [
  { value: 'topStat', label: 'Top Stat' },
  { value: 'attribute', label: 'Element' },
  { value: 'skillType', label: 'Skill Type' },
  { value: 'skill', label: 'Specific Skill' },
  { value: 'baseStat', label: 'Base Stat' },
]

const DEFAULT_ADVANCED_MODIFIER_SCOPE: ManualModifierScope = 'topStat'

const ADVANCED_TOP_STAT_OPTIONS: Array<{ value: ManualTopStatKey; label: string }> = [
  { value: 'dmgBonus', label: 'Global DMG Bonus' },
  { value: 'amplify', label: 'Amplify' },
  { value: 'flatDmg', label: 'Flat Damage' },
  { value: 'critRate', label: 'Crit Rate' },
  { value: 'critDmg', label: 'Crit DMG' },
  { value: 'energyRegen', label: 'Energy Regen' },
  { value: 'healingBonus', label: 'Healing Bonus' },
  { value: 'shieldBonus', label: 'Shield Bonus' },
  { value: 'tuneBreakBoost', label: 'Tune Break Boost' },
  { value: 'special', label: 'Special Modifier' },
]

const ADVANCED_ATTRIBUTE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All Elements' },
  { value: 'physical', label: 'Physical' },
  { value: 'glacio', label: 'Glacio' },
  { value: 'fusion', label: 'Fusion' },
  { value: 'electro', label: 'Electro' },
  { value: 'aero', label: 'Aero' },
  { value: 'spectro', label: 'Spectro' },
  { value: 'havoc', label: 'Havoc' },
]

const ADVANCED_SKILL_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All Skill Types' },
  { value: 'basicAtk', label: 'Basic Attack' },
  { value: 'heavyAtk', label: 'Heavy Attack' },
  { value: 'resonanceSkill', label: 'Resonance Skill' },
  { value: 'resonanceLiberation', label: 'Resonance Liberation' },
  { value: 'introSkill', label: 'Intro Skill' },
  { value: 'outroSkill', label: 'Outro Skill' },
  { value: 'echoSkill', label: 'Echo Skill' },
  { value: 'coord', label: 'Coordinated Attack' },
  { value: 'spectroFrazzle', label: 'Spectro Frazzle' },
  { value: 'aeroErosion', label: 'Aero Erosion' },
  { value: 'fusionBurst', label: 'Fusion Burst' },
  { value: 'havocBane', label: 'Havoc Bane' },
  { value: 'glacioChafe', label: 'Glacio Chafe' },
  { value: 'electroFlare', label: 'Electro Flare' },
  { value: 'healing', label: 'Healing' },
  { value: 'shield', label: 'Shield' },
  { value: 'tuneRupture', label: 'Tune Rupture' },
]

const ADVANCED_BASE_STAT_OPTIONS: Array<{ value: ManualBaseStatKey; label: string }> = [
  { value: 'atk', label: 'Attack' },
  { value: 'hp', label: 'HP' },
  { value: 'def', label: 'Defense' },
]

const ADVANCED_BASE_STAT_FIELD_OPTIONS: Array<{ value: 'percent' | 'flat'; label: string }> = [
  { value: 'percent', label: 'Percent' },
  { value: 'flat', label: 'Flat' },
]

const ADVANCED_SKILL_MATCH_OPTIONS: Array<{ value: ManualSkillMatchMode; label: string }> = [
  { value: 'skillId', label: 'Skill' },
  { value: 'tab', label: 'Tab' },
]

const MODIFIER_VALUE_OPTIONS: Array<{ value: ManualModifierValueKey; label: string }> = [
  { value: 'dmgBonus', label: 'DMG Bonus' },
  { value: 'amplify', label: 'Amplify' },
  { value: 'resShred', label: 'RES Shred' },
  { value: 'defIgnore', label: 'DEF Ignore' },
  { value: 'defShred', label: 'DEF Shred' },
  { value: 'dmgVuln', label: 'DMG Vulnerability' },
  { value: 'critRate', label: 'Crit Rate' },
  { value: 'critDmg', label: 'Crit DMG' },
]

const SKILL_TAB_OPTIONS: Array<{ value: string; label: string }> = makeSkillTabOptions(MANUAL_BUFF_SKILL_TAB_ORDER)

const MANUAL_BUFFS_EXPORT_VERSION = 1

interface ManualBuffsExportPayload {
  type: 'manual-buffs'
  version: typeof MANUAL_BUFFS_EXPORT_VERSION
  resonatorId: string
  exportedAt: string
  manualBuffs: ManualBuffs
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampQuickBuffValue(isFlat: boolean, rawValue: number): number {
  const maximum = isFlat ? 9999 : 999
  return Math.max(0, Math.min(maximum, rawValue))
}

function clampManualModifierValue(modifier: ManualModifier, rawValue: number): number {
  const isFlatLike =
    (modifier.scope === 'baseStat' && modifier.field === 'flat')
    || (modifier.scope === 'topStat' && modifier.stat === 'flatDmg')

  return clampQuickBuffValue(isFlatLike, rawValue)
}

function createManualModifierId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function extractManualBuffsImportPayload(input: unknown): unknown {
  if (
    isRecord(input)
    && input.type === 'manual-buffs'
    && 'manualBuffs' in input
  ) {
    return input.manualBuffs
  }

  return input
}

function sanitizeImportedManualBuffs(manualBuffs: ManualBuffs): ManualBuffs {
  const seenIds = new Set<string>()

  const normalizeModifierId = (rawId: string) => {
    const trimmedId = rawId.trim()
    if (trimmedId !== '' && !seenIds.has(trimmedId)) {
      seenIds.add(trimmedId)
      return trimmedId
    }

    const fallbackId = createManualModifierId()
    seenIds.add(fallbackId)
    return fallbackId
  }

  return {
    quick: {
      atk: {
        flat: clampQuickBuffValue(true, manualBuffs.quick.atk.flat),
        percent: clampQuickBuffValue(false, manualBuffs.quick.atk.percent),
      },
      hp: {
        flat: clampQuickBuffValue(true, manualBuffs.quick.hp.flat),
        percent: clampQuickBuffValue(false, manualBuffs.quick.hp.percent),
      },
      def: {
        flat: clampQuickBuffValue(true, manualBuffs.quick.def.flat),
        percent: clampQuickBuffValue(false, manualBuffs.quick.def.percent),
      },
      critRate: clampQuickBuffValue(false, manualBuffs.quick.critRate),
      critDmg: clampQuickBuffValue(false, manualBuffs.quick.critDmg),
      energyRegen: clampQuickBuffValue(false, manualBuffs.quick.energyRegen),
      healingBonus: clampQuickBuffValue(false, manualBuffs.quick.healingBonus),
    },
    modifiers: manualBuffs.modifiers.map((modifier) => {
      const nextModifier = {
        ...modifier,
        id: normalizeModifierId(modifier.id),
      }

      return {
        ...nextModifier,
        value: clampManualModifierValue(nextModifier, nextModifier.value),
      }
    }),
  }
}

export function ManualBuffEditor({
  runtime,
  onRuntimeUpdate,
  cardVariant = 'section',
  showQuickStats = true,
  showTransferActions = false,
}: ManualBuffEditorProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const confirmation = useConfirmation()
  const portalTarget = getMainContentPortalTarget()
  const resonator = getResonatorById(runtime.id)
  const manualBuffs = runtime.state.manualBuffs

  const skillOptions = Array.from(
    new Map(
      (resonator?.skills ?? []).map((rawSkill) => {
        const skill = resolveSkill(runtime, rawSkill)
        return [
          skill.id,
          {
            value: skill.id,
            label: skill.label,
          },
        ]
      }),
    ).values(),
  )
  const tabOptions = SKILL_TAB_OPTIONS.filter(({ value }) =>
    (resonator?.skills ?? []).some((skill) => skill.tab === value),
  )
  const cardClassName = `custom-buffs-card ui-surface-card ui-surface-card--${cardVariant}`

  const updateQuickBaseStat = (
    stat: ManualBaseStatKey,
    field: 'flat' | 'percent',
    rawValue: number,
  ) => {
    const nextValue = clampQuickBuffValue(field === 'flat', rawValue)
    onRuntimeUpdate((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          quick: {
            ...prev.state.manualBuffs.quick,
            [stat]: {
              ...prev.state.manualBuffs.quick[stat],
              [field]: nextValue,
            },
          },
        },
      },
    }))
  }

  const updateQuickScalar = (
    key: Exclude<keyof ManualQuickBuffs, 'atk' | 'hp' | 'def'>,
    rawValue: number,
  ) => {
    const nextValue = clampQuickBuffValue(false, rawValue)
    onRuntimeUpdate((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          quick: {
            ...prev.state.manualBuffs.quick,
            [key]: nextValue,
          },
        },
      },
    }))
  }

  const updateManualModifier = (
    modifierId: string,
    updater: (modifier: ManualModifier) => ManualModifier,
  ) => {
    onRuntimeUpdate((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          modifiers: prev.state.manualBuffs.modifiers.map((modifier) =>
            modifier.id === modifierId ? updater(modifier) : modifier,
          ),
        },
      },
    }))
  }

  const removeManualModifier = (modifierId: string) => {
    onRuntimeUpdate((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          modifiers: prev.state.manualBuffs.modifiers.filter((modifier) => modifier.id !== modifierId),
        },
      },
    }))
  }

  const addManualModifier = () => {
    const id = createManualModifierId()
    onRuntimeUpdate((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          modifiers: [
            ...prev.state.manualBuffs.modifiers,
            makeDefaultManualModifier(id, DEFAULT_ADVANCED_MODIFIER_SCOPE),
          ],
        },
      },
    }))
  }

  const duplicateManualModifier = (modifier: ManualModifier) => {
    const id = createManualModifierId()
    onRuntimeUpdate((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          modifiers: [
            ...prev.state.manualBuffs.modifiers,
            { ...modifier, id },
          ],
        },
      },
    }))
  }

  const exportManualBuffs = () => {
    const payload: ManualBuffsExportPayload = {
      type: 'manual-buffs',
      version: MANUAL_BUFFS_EXPORT_VERSION,
      resonatorId: runtime.id,
      exportedAt: new Date().toISOString(),
      manualBuffs,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `${runtime.id}-manual-buffs.json`
    link.click()

    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const importManualBuffs = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    try {
      const rawText = await file.text()
      const parsedJson = JSON.parse(rawText) as unknown
      const resolvedPayload = extractManualBuffsImportPayload(parsedJson)
      const parsedManualBuffs = manualBuffsSchema.safeParse(resolvedPayload)

      if (!parsedManualBuffs.success) {
        throw new Error(parsedManualBuffs.error.issues[0]?.message ?? 'Invalid manual buffs JSON.')
      }

      const sanitizedManualBuffs = sanitizeImportedManualBuffs(parsedManualBuffs.data)

      onRuntimeUpdate((prev) => ({
        ...prev,
        state: {
          ...prev.state,
          manualBuffs: sanitizedManualBuffs,
        },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid manual buffs JSON.'
      window.alert(`Import failed: ${message}`)
    }
  }

  const renderQuickInput = (
    value: number,
    onChange: (value: number) => void,
    suffix: string | null = '%',
    isFlat = false,
  ) => (
    <div className={`custom-buff-input ${suffix ? 'has-suffix' : ''}`}>
      <input
        type="number"
        value={value}
        min={0}
        max={isFlat ? 9999 : 999}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
      {suffix ? <span>{suffix}</span> : null}
    </div>
  )

  const renderDualBuffRow = (label: string, stat: ManualBaseStatKey) => (
    <div key={label} className="custom-buff-row">
      <label className="custom-buff-row-label">{label}</label>
      <div className="custom-buff-dual">
        {renderQuickInput(
          manualBuffs.quick[stat].flat,
          (value) => updateQuickBaseStat(stat, 'flat', value),
          null,
          true,
        )}
        {renderQuickInput(
          manualBuffs.quick[stat].percent,
          (value) => updateQuickBaseStat(stat, 'percent', value),
        )}
      </div>
    </div>
  )

  const renderSingleQuickRow = (
    label: string,
    key: Exclude<keyof ManualQuickBuffs, 'atk' | 'hp' | 'def'>,
    suffix: string | null = '%',
  ) => (
    <div key={String(key)} className="custom-buff-row">
      <label className="custom-buff-row-label">{label}</label>
      {renderQuickInput(
        manualBuffs.quick[key],
        (value) => updateQuickScalar(key, value),
        suffix,
      )}
    </div>
  )

  const renderModifierValueInput = (modifier: ManualModifier) => (
    <div className={`custom-buff-input ${modifier.scope === 'baseStat' && modifier.field === 'flat' ? '' : 'has-suffix'}`}>
      <input
        type="number"
        value={modifier.value}
        min={0}
        max={
          (modifier.scope === 'baseStat' && modifier.field === 'flat')
          || (modifier.scope === 'topStat' && modifier.stat === 'flatDmg')
            ? 9999
            : 999
        }
        onChange={(event) => {
          const nextValue = clampManualModifierValue(modifier, Number(event.target.value) || 0)
          updateManualModifier(modifier.id, (current) => ({
            ...current,
            value: nextValue,
          }))
        }}
      />
      {((modifier.scope === 'baseStat' && modifier.field === 'flat')
        || (modifier.scope === 'topStat' && modifier.stat === 'flatDmg')) ? null : <span>%</span>}
    </div>
  )

  const getOptionLabel = (
    options: Array<{ value: string; label: string }>,
    value: string | undefined,
    fallback = 'Unspecified',
  ) => options.find((option) => option.value === value)?.label ?? fallback

  const renderModifierField = (
    label: string,
    control: ReactNode,
    className?: string,
  ) => (
    <label className={['manual-modifier-field', className].filter(Boolean).join(' ')}>
      <span>{label}</span>
      {control}
    </label>
  )

  const renderModifierTargetFields = (modifier: ManualModifier) => {
    const scopeField = renderModifierField(
      'Scope',
      <LiquidSelect
        value={modifier.scope}
        options={ADVANCED_SCOPE_OPTIONS}
        onChange={(value) =>
          updateManualModifier(modifier.id, (current) => ({
            ...makeDefaultManualModifier(current.id, value as ManualModifierScope),
            enabled: current.enabled,
          }))
        }
      />,
    )

    if (modifier.scope === 'attribute') {
      return (
        <>
          {scopeField}
          {renderModifierField(
            'Element',
            <LiquidSelect
              value={modifier.attribute}
              options={ADVANCED_ATTRIBUTE_OPTIONS}
              onChange={(value) =>
                updateManualModifier(modifier.id, (current) => ({
                  ...current,
                  attribute: value as Extract<ManualModifier, { scope: 'attribute' }>['attribute'],
                }) as ManualModifier)
              }
            />,
          )}
        </>
      )
    }

    if (modifier.scope === 'skillType') {
      return (
        <>
          {scopeField}
          {renderModifierField(
            'Skill Type',
            <LiquidSelect
              value={modifier.skillType}
              options={ADVANCED_SKILL_TYPE_OPTIONS}
              onChange={(value) =>
                updateManualModifier(modifier.id, (current) => ({
                  ...current,
                  skillType: value as Extract<ManualModifier, { scope: 'skillType' }>['skillType'],
                }) as ManualModifier)
              }
            />,
          )}
        </>
      )
    }

    if (modifier.scope === 'skill') {
      return (
        <>
          {scopeField}
          {renderModifierField(
            'Match By',
            <LiquidSelect
              value={modifier.matchMode}
              options={ADVANCED_SKILL_MATCH_OPTIONS}
              onChange={(value) =>
                updateManualModifier(modifier.id, (current) => ({
                  ...(current as Extract<ManualModifier, { scope: 'skill' }>),
                  matchMode: value as ManualSkillMatchMode,
                  skillId: value === 'skillId' ? (current.scope === 'skill' ? current.skillId ?? '' : '') : undefined,
                  tab: value === 'tab' ? (current.scope === 'skill' ? current.tab ?? tabOptions[0]?.value ?? 'normalAttack' : 'normalAttack') : undefined,
                }))
              }
            />,
          )}
          {renderModifierField(
            modifier.matchMode === 'skillId' ? 'Skill' : 'Tab',
            <LiquidSelect
              value={modifier.matchMode === 'skillId' ? modifier.skillId ?? '' : modifier.tab ?? ''}
              options={
                modifier.matchMode === 'skillId'
                  ? [{ value: '', label: 'Select Skill' }, ...skillOptions]
                  : (tabOptions.length > 0
                    ? tabOptions
                    : [{ value: 'normalAttack', label: 'Normal Attack' }])
              }
              onChange={(value) =>
                updateManualModifier(modifier.id, (current) => ({
                  ...(current as Extract<ManualModifier, { scope: 'skill' }>),
                  ...(modifier.matchMode === 'skillId'
                    ? { skillId: value }
                    : { tab: value }),
                }))
              }
            />,
          )}
        </>
      )
    }

    return scopeField
  }

  const renderModifierEffectFields = (modifier: ManualModifier) => {
    if (modifier.scope === 'baseStat') {
      return (
        <>
          {renderModifierField(
            'Stat',
            <LiquidSelect
              value={modifier.stat}
              options={ADVANCED_BASE_STAT_OPTIONS}
              onChange={(value) =>
                updateManualModifier(modifier.id, (current) => ({
                  ...current,
                  stat: value as ManualBaseStatKey,
                }) as ManualModifier)
              }
            />,
          )}
          {renderModifierField(
            'Field',
            <LiquidSelect
              value={modifier.field}
              options={ADVANCED_BASE_STAT_FIELD_OPTIONS}
              onChange={(value) =>
                updateManualModifier(modifier.id, (current) => ({
                  ...current,
                  field: value as 'flat' | 'percent',
                  value: clampManualModifierValue(
                    { ...(current as Extract<ManualModifier, { scope: 'baseStat' }>), field: value as 'flat' | 'percent' },
                    current.value,
                  ),
                }) as ManualModifier)
              }
            />,
          )}
          {renderModifierField('Value', renderModifierValueInput(modifier), 'manual-modifier-field--value')}
        </>
      )
    }

    if (modifier.scope === 'topStat') {
      return (
        <>
          {renderModifierField(
            'Stat',
            <LiquidSelect
              value={modifier.stat}
              options={ADVANCED_TOP_STAT_OPTIONS}
              onChange={(value) =>
                updateManualModifier(modifier.id, (current) => ({
                  ...current,
                  stat: value as ManualTopStatKey,
                  value: clampManualModifierValue(
                    { ...(current as Extract<ManualModifier, { scope: 'topStat' }>), stat: value as ManualTopStatKey },
                    current.value,
                  ),
                }) as ManualModifier)
              }
            />,
          )}
          {renderModifierField('Value', renderModifierValueInput(modifier), 'manual-modifier-field--value')}
        </>
      )
    }

    return (
      <>
        {renderModifierField(
          'Modifier',
          <LiquidSelect
            value={modifier.mod}
            options={MODIFIER_VALUE_OPTIONS}
            onChange={(value) =>
              updateManualModifier(modifier.id, (current) => ({
                ...current,
                mod: value as ManualModifierValueKey,
              }) as ManualModifier)
            }
          />,
        )}
        {renderModifierField('Value', renderModifierValueInput(modifier), 'manual-modifier-field--value')}
      </>
    )
  }

  const renderModifierRow = (modifier: ManualModifier) => {
    const summary = (() => {
      if (modifier.scope === 'baseStat') {
        return `${getOptionLabel(ADVANCED_BASE_STAT_OPTIONS, modifier.stat)} · ${getOptionLabel(ADVANCED_BASE_STAT_FIELD_OPTIONS, modifier.field)}`
      }

      if (modifier.scope === 'topStat') {
        return getOptionLabel(ADVANCED_TOP_STAT_OPTIONS, modifier.stat)
      }

      if (modifier.scope === 'attribute') {
        return `${getOptionLabel(ADVANCED_ATTRIBUTE_OPTIONS, modifier.attribute)} · ${getOptionLabel(MODIFIER_VALUE_OPTIONS, modifier.mod)}`
      }

      if (modifier.scope === 'skillType') {
        return `${getOptionLabel(ADVANCED_SKILL_TYPE_OPTIONS, modifier.skillType)} · ${getOptionLabel(MODIFIER_VALUE_OPTIONS, modifier.mod)}`
      }

      const skillMatchOptions = modifier.matchMode === 'skillId'
        ? [{ value: '', label: 'Select Skill' }, ...skillOptions]
        : (tabOptions.length > 0
          ? tabOptions
          : [{ value: 'normalAttack', label: 'Normal Attack' }])

      return `${getOptionLabel(skillMatchOptions, modifier.matchMode === 'skillId' ? modifier.skillId ?? '' : modifier.tab ?? '')} · ${getOptionLabel(MODIFIER_VALUE_OPTIONS, modifier.mod)}`
    })()

    return (
      <Expandable
        key={modifier.id}
        as="article"
        className="manual-modifier-row rotation-item ui-surface-card ui-surface-card--inner"
        chevronContainerClassName="rotation-collapse-button manual-modifier-collapse"
        triggerClassName="manual-modifier-expandable-trigger"
        contentClassName="manual-modifier-expandable"
        contentInnerClassName="manual-modifier-layout"
        chevronClassName="manual-modifier-chevron"
        chevronSize={16}
        defaultOpen={false}
        header={
          <div className="manual-modifier-card-head">
            <div className="manual-modifier-card-copy">
              <div className="manual-modifier-card-topline">
                <span className="manual-modifier-card-index">{summary}</span>
              </div>
            </div>

            <div className="manual-modifier-actions">
              <button
                type="button"
                className="block-icon-button power"
                title={modifier.enabled ? 'Disable modifier' : 'Enable modifier'}
                aria-pressed={modifier.enabled}
                onClick={(event) => {
                  event.stopPropagation()
                  updateManualModifier(modifier.id, (current) => ({
                    ...current,
                    enabled: !current.enabled,
                  }))
                }}
              >
                {modifier.enabled ? <Power size={16} /> : <PowerOff size={16} />}
              </button>
              <button
                type="button"
                className="block-icon-button copy"
                title="Duplicate modifier"
                aria-label="Duplicate modifier"
                onClick={(event) => {
                  event.stopPropagation()
                  duplicateManualModifier(modifier)
                }}
              >
                <CopyPlus size={15} />
              </button>
              <button
                type="button"
                className="block-icon-button delete"
                title="Remove modifier"
                aria-label="Remove modifier"
                onClick={(event) => {
                  event.stopPropagation()
                  removeManualModifier(modifier.id)
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        }
      >
        <section className="manual-modifier-panel block-entries-list ui-surface-card ui-surface-card--inner">
          <span className="manual-modifier-panel-label">Target</span>
          <div className="manual-modifier-fields">
            {renderModifierTargetFields(modifier)}
          </div>
        </section>

        <section className="manual-modifier-panel block-entries-list ui-surface-card ui-surface-card--inner">
          <span className="manual-modifier-panel-label">Effect</span>
          <div className="manual-modifier-fields">
            {renderModifierEffectFields(modifier)}
          </div>
        </section>
      </Expandable>
    )
  }

  return (
    <>
      {showQuickStats ? (
        <div className={cardClassName}>
          <h4>Main Stats</h4>
          <div className="custom-buffs-grid">
            {MAIN_STAT_BUFF_ROWS.map((field) => renderDualBuffRow(field.label, field.stat))}
            {MAIN_SCALAR_BUFF_FIELDS.map((field) => renderSingleQuickRow(field.label, field.key))}
          </div>
        </div>
      ) : null}

      <div className={cardClassName}>
        <div className="custom-buffs-head custom-buffs-head--modifiers">
          <div>
            <h4>Advanced Modifiers</h4>
          </div>
          <div className="manual-modifier-head-actions">
            <span className="manual-modifier-count">
              {manualBuffs.modifiers.length} {manualBuffs.modifiers.length === 1 ? 'entry' : 'entries'}
            </span>
            <button
              type="button"
              className="block-icon-button manual-modifier-add"
              title="Add modifier"
              onClick={addManualModifier}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="manual-modifier-list">
          {manualBuffs.modifiers.length === 0 ? (
            <div className="soft-empty manual-modifier-empty">
              No advanced modifiers yet.
            </div>
          ) : (
            manualBuffs.modifiers.slice().reverse().map(renderModifierRow)
          )}
        </div>
      </div>

      {showTransferActions ? (
        <div className="custom-buffs-footer">
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={importManualBuffs}
          />
          <button
            type="button"
            className="ui-pill-button"
            onClick={() => importInputRef.current?.click()}
          >
            Import
          </button>
          <button
            type="button"
            className="ui-pill-button"
            onClick={exportManualBuffs}
          >
            Export
          </button>
          <button
            type="button"
            className="ui-pill-button ui-pill-button-danger custom-buffs-clear"
            onClick={() => confirmation.confirm({
              title: 'You sure about that? ( · ❛ ֊ ❛)',
              message: 'This will reset all custom bonuses back to their defaults.',
              confirmLabel: 'Clear All',
              variant: 'danger',
              onConfirm: () =>
                onRuntimeUpdate((prev) => ({
                  ...prev,
                  state: {
                    ...prev.state,
                    manualBuffs: makeDefaultCustomBuffs(),
                  },
                })),
            })}
          >
            Clear All
          </button>
        </div>
      ) : null}

      <ConfirmationModal
        visible={confirmation.visible}
        open={confirmation.open}
        closing={confirmation.closing}
        portalTarget={portalTarget}
        title={confirmation.title}
        message={confirmation.message}
        confirmLabel={confirmation.confirmLabel}
        cancelLabel={confirmation.cancelLabel}
        variant={confirmation.variant}
        onConfirm={confirmation.onConfirm}
        onCancel={confirmation.onCancel}
      />
    </>
  )
}
