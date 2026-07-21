/*
  Author: Runor Ewhro
  Description: Renders teammate manual-buff controls and routes all modifier
               transitions through the shared manual buff operations.
*/

import { type ChangeEvent, type CSSProperties as CssProps, type ReactNode, useMemo, useRef } from 'react'
import { Bookmark, Copy, Plus, Trash2 } from 'lucide-react'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type {
  MnlBaseStatK,
  MnlMod,
  MnlModScp,
  MnlModVlKey,
  MnlSkllMtchM,
  MnlSkllSclrK,
  MnlTopStatKe,
  QuickBuffs,
} from '@/domain/entities/manualBuffs.ts'
import type { AttributeKey, NegEffectKey, SkillTypeKey } from '@/domain/entities/stats.ts'
import { mkDefMnlMod } from '@/domain/state/defaults.ts'
import { mnlBffsSchm } from '@/domain/state/manualBuffsSchema.ts'
import { getResonatorById as getResById } from '@/domain/services/catalogService.ts'
import { resolveSkill } from '@/engine/pipeline/resolveSkill.ts'
import { getEchoStatI } from '@/modules/calculator/features/echoes/lib/echoPane.ts'
import { NumberInput } from '@/modules/calculator/features/controls/NumberInput.tsx'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import type { RtUpdHnd } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { BuffPresetModal } from '@/modules/calculator/features/buffs/BuffPresetModal.tsx'
import { clampQuickBuff, makeModId, mprtPay, cleanBuffs } from '@/modules/calculator/features/buffs/lib/helpers.ts'
import { cloneManualMods } from '@/modules/calculator/features/buffs/lib/clipboard.ts'
import {
  ADV_SKILL_MATCH,
  ADV_SKILL_TYPES,
  DEFDVNCMODSC,
  DVNCBASESTAT,
  DVNCBASESTuv,
  DVNCSCPPTNS,
  DVNCTOPSTATP,
  DVNCTTRBPTNS,
  MAINSCLRBUFF,
  MAINSTATBUFF,
  MOD_VL_PTNS,
  NEG_EFFECT_MODS,
  NEG_EFFECT_OPTS,
  SKILL_TAB_OPTIONS,
  SKLLMODPTNS,
  SKLLSCLRPTNS,
} from '@/modules/calculator/features/buffs/lib/options.ts'
import {
  applySkillMod,
  changeModScope,
  getModVlMax,
  getModVlSfx,
  getSkllModPt,
  modSummary,
  setAttribute,
  setBaseField,
  setBaseStat,
  setElementMod,
  setModValue,
  setNegEffect,
  setNegMod,
  setSkillHit,
  setSkillMatchMode,
  setSkillScalarField,
  setSkillTarget,
  setSkillType,
  setTopStat,
  skillMatchOptions,
} from '@/modules/calculator/features/buffs/lib/manualBuffOps.ts'

const ZERO_QUICK: QuickBuffs = {
  atk: { flat: 0, percent: 0 },
  hp: { flat: 0, percent: 0 },
  def: { flat: 0, percent: 0 },
  critRate: 0,
  critDmg: 0,
  energyRegen: 0,
  healingBonus: 0,
}

function QbuffGlyph({ statKey }: { statKey: string }) {
  const icon = getEchoStatI(statKey)
  if (!icon) {
    return <span className="mcc-qbuff-glyph is-blank" aria-hidden="true" />
  }
  return (
    <span
      className="mcc-qbuff-glyph"
      aria-hidden="true"
      style={{ WebkitMaskImage: `url(${icon})`, maskImage: `url(${icon})` } as CssProps}
    />
  )
}

function QuickField({
  value,
  suffix,
  max,
  onChange,
}: {
  value: number
  suffix: string | null
  max: number
  onChange: (value: number) => void
}) {
  return (
    <span className={`mcc-qbuff-input${suffix ? ' has-suffix' : ''}`}>
      <NumberInput value={value} min={-max} max={max} onChange={onChange} />
      {suffix ? <i>{suffix}</i> : null}
    </span>
  )
}

export function TeammateManualBuffs({ runtime, onRtPdt }: { runtime: ResRuntime; onRtPdt: RtUpdHnd }) {
  const importRef = useRef<HTMLInputElement | null>(null)
  const presetModal = useAppModal()
  const manualBuffs = runtime.state.manualBuffs
  const modifiers = manualBuffs.modifiers

  const resonator = getResById(runtime.id)
  // Skill rows are resolved through the runtime, not the raw catalog, because
  // labels and ids can depend on the teammate's current authored state.
  const skillOptions = useMemo(
    () =>
      Array.from(
        new Map(
          (resonator?.skills ?? []).map((rawSkill) => {
            const skill = resolveSkill(runtime, rawSkill)
            return [skill.id, { value: skill.id, label: skill.label }]
          }),
        ).values(),
      ),
    [resonator, runtime],
  )
  const tabOptions = useMemo(
    () => SKILL_TAB_OPTIONS.filter(({ value }) => (resonator?.skills ?? []).some((skill) => skill.tab === value)),
    [resonator],
  )

  // Quick buffs and custom modifiers live under the teammate runtime's local
  // manualBuffs object; all writes preserve unrelated runtime state.
  const setQuick = (fn: (quick: QuickBuffs) => QuickBuffs) => {
    onRtPdt((prev) => ({
      ...prev,
      state: { ...prev.state, manualBuffs: { ...prev.state.manualBuffs, quick: fn(prev.state.manualBuffs.quick) } },
    }))
  }

  const setBase = (stat: MnlBaseStatK, field: 'flat' | 'percent', raw: number) => {
    setQuick((quick) => ({ ...quick, [stat]: { ...quick[stat], [field]: clampQuickBuff(field === 'flat', raw) } }))
  }

  const setScalar = (key: Exclude<keyof QuickBuffs, 'atk' | 'hp' | 'def'>, raw: number) => {
    setQuick((quick) => ({ ...quick, [key]: clampQuickBuff(false, raw) }))
  }

  const patchModifiers = (fn: (modifiers: MnlMod[]) => MnlMod[]) => {
    onRtPdt((prev) => ({
      ...prev,
      state: { ...prev.state, manualBuffs: { ...prev.state.manualBuffs, modifiers: fn(prev.state.manualBuffs.modifiers) } },
    }))
  }

  const updateMod = (id: string, fn: (modifier: MnlMod) => MnlMod) => {
    patchModifiers((list) => list.map((modifier) => (modifier.id === id ? fn(modifier) : modifier)))
  }

  const addMod = () => patchModifiers((list) => [...list, mkDefMnlMod(makeModId(), DEFDVNCMODSC)])
  const duplicateMod = (modifier: MnlMod) => patchModifiers((list) => [...list, { ...modifier, id: makeModId() }])
  const removeMod = (id: string) => patchModifiers((list) => list.filter((modifier) => modifier.id !== id))

  // preset rows get fresh ids and are reversed so the newest lands at the top of the reversed list
  const addPresets = (presets: MnlMod[]) => {
    if (presets.length === 0) {
      return
    }
    patchModifiers((list) => [...list, ...cloneManualMods(presets).reverse()])
  }

  const clearAll = () => {
    onRtPdt((prev) => ({
      ...prev,
      state: { ...prev.state, manualBuffs: { quick: ZERO_QUICK, modifiers: [] } },
    }))
  }

  const exportBuffs = () => {
    const payload = {
      type: 'manual-buffs' as const,
      version: 1,
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

  const importBuffs = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    try {
      const parsed = mnlBffsSchm.safeParse(mprtPay(JSON.parse(await file.text())))
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Invalid manual buffs JSON.')
      }
      const sanitized = cleanBuffs(parsed.data)
      onRtPdt((prev) => ({ ...prev, state: { ...prev.state, manualBuffs: sanitized } }))
    } catch (error) {
      window.alert(`Import failed: ${error instanceof Error ? error.message : 'Invalid manual buffs JSON.'}`)
    }
  }

  const activeCount = modifiers.filter((modifier) => modifier.enabled).length

  const modField = (label: string, control: ReactNode, wide = false) => (
    <label className={`mcc-mod-field${wide ? ' is-value' : ''}`}>
      <span>{label}</span>
      {control}
    </label>
  )

  const valueField = (modifier: MnlMod) => {
    const max = getModVlMax(modifier)
    const suffix = getModVlSfx(modifier)
    return modField(
      'Value',
      <span className={`mcc-qbuff-input${suffix ? ' has-suffix' : ''}`}>
        <NumberInput
          value={modifier.value}
          min={-max}
          max={max}
          onChange={(value) => updateMod(modifier.id, (current) => setModValue(current, value))}
        />
        {suffix ? <i>{suffix}</i> : null}
      </span>,
      true,
    )
  }

  const targetFields = (modifier: MnlMod) => {
    // Target controls decide which source bucket the modifier attaches to;
    // effect controls below decide which numeric field inside that bucket moves.
    const scopeSelect = modField(
      'Scope',
      <LiquidSelect
        value={modifier.scope}
        options={DVNCSCPPTNS}
        onChange={(value) => updateMod(modifier.id, (current) => changeModScope(current, value as MnlModScp))}
      />,
    )

    if (modifier.scope === 'attribute') {
      return (
        <>
          {scopeSelect}
          {modField(
            'Element',
            <LiquidSelect
              value={modifier.attribute}
              options={DVNCTTRBPTNS}
              onChange={(value) => updateMod(modifier.id, (current) => setAttribute(current, value as AttributeKey | 'all'))}
            />,
          )}
        </>
      )
    }

    if (modifier.scope === 'skillType') {
      return (
        <>
          {scopeSelect}
          {modField(
            'Skill type',
            <LiquidSelect
              value={modifier.skillType}
              options={ADV_SKILL_TYPES}
              onChange={(value) => updateMod(modifier.id, (current) => setSkillType(current, value as SkillTypeKey))}
            />,
          )}
        </>
      )
    }

    if (modifier.scope === 'skill') {
      const targetOptions = skillMatchOptions(modifier, skillOptions, tabOptions)
      const targetValue =
        modifier.matchMode === 'skillId'
          ? modifier.skillId ?? ''
          : modifier.matchMode === 'tab'
            ? modifier.tab ?? ''
            : modifier.skillType ?? 'all'
      return (
        <>
          {scopeSelect}
          {modField(
            'Match by',
            <LiquidSelect
              value={modifier.matchMode}
              options={ADV_SKILL_MATCH}
              onChange={(value) =>
                updateMod(modifier.id, (current) =>
                  setSkillMatchMode(current, value as MnlSkllMtchM, tabOptions[0]?.value ?? 'normalAttack'),
                )
              }
            />,
          )}
          {modField(
            modifier.matchMode === 'skillId' ? 'Skill' : modifier.matchMode === 'tab' ? 'Tab' : 'Skill type',
            <LiquidSelect
              value={targetValue}
              options={targetOptions}
              onChange={(value) => updateMod(modifier.id, (current) => setSkillTarget(current, value))}
            />,
          )}
        </>
      )
    }

    return scopeSelect
  }

  const effectFields = (modifier: MnlMod) => {
    if (modifier.scope === 'baseStat') {
      return (
        <>
          {modField(
            'Stat',
            <LiquidSelect
              value={modifier.stat}
              options={DVNCBASESTAT}
              onChange={(value) => updateMod(modifier.id, (current) => setBaseStat(current, value as MnlBaseStatK))}
            />,
          )}
          {modField(
            'Field',
            <LiquidSelect
              value={modifier.field}
              options={DVNCBASESTuv}
              onChange={(value) => updateMod(modifier.id, (current) => setBaseField(current, value as 'flat' | 'percent'))}
            />,
          )}
          {valueField(modifier)}
        </>
      )
    }

    if (modifier.scope === 'topStat') {
      return (
        <>
          {modField(
            'Stat',
            <LiquidSelect
              value={modifier.stat}
              options={DVNCTOPSTATP}
              onChange={(value) => updateMod(modifier.id, (current) => setTopStat(current, value as MnlTopStatKe))}
            />,
          )}
          {valueField(modifier)}
        </>
      )
    }

    if (modifier.scope === 'attribute' || modifier.scope === 'skillType') {
      return (
        <>
          {modField(
            'Modifier',
            <LiquidSelect
              value={modifier.mod}
              options={MOD_VL_PTNS}
              onChange={(value) => updateMod(modifier.id, (current) => setElementMod(current, value as MnlModVlKey))}
            />,
          )}
          {valueField(modifier)}
        </>
      )
    }

    if (modifier.scope === 'negativeEffect') {
      return (
        <>
          {modField(
            'Effect',
            <LiquidSelect
              value={modifier.negativeEffect}
              options={NEG_EFFECT_OPTS}
              onChange={(value) => updateMod(modifier.id, (current) => setNegEffect(current, value as NegEffectKey))}
            />,
          )}
          {modField(
            'Modifier',
            <LiquidSelect
              value={modifier.mod}
              options={NEG_EFFECT_MODS}
              onChange={(value) =>
                updateMod(modifier.id, (current) => setNegMod(current, value as (typeof NEG_EFFECT_MODS)[number]['value']))
              }
            />,
          )}
          {valueField(modifier)}
        </>
      )
    }

    return (
      <>
        {modField(
          'Modifier',
          <LiquidSelect
            value={getSkllModPt(modifier)}
            options={SKLLMODPTNS}
            onChange={(value) => updateMod(modifier.id, (current) => applySkillMod(current, value))}
          />,
        )}
        {modifier.effect === 'addHitMultiplier'
          ? modField(
              'Hit',
              <span className="mcc-qbuff-input">
                <NumberInput
                  value={modifier.hitIndex + 1}
                  min={1}
                  max={99}
                  onChange={(value) => updateMod(modifier.id, (current) => setSkillHit(current, value))}
                />
              </span>,
            )
          : null}
        {modifier.effect === 'scalar'
          ? modField(
              'Field',
              <LiquidSelect
                value={modifier.field}
                options={SKLLSCLRPTNS}
                onChange={(value) => updateMod(modifier.id, (current) => setSkillScalarField(current, value as MnlSkllSclrK))}
              />,
            )
          : null}
        {valueField(modifier)}
      </>
    )
  }

  return (
    <div className="mcc-buffs">
      <div className="mcc-block">
        <div className="mcc-block-head">
          <span className="mcc-block-label">Quick buffs</span>
          <span className="mcc-block-meta">Flat / %</span>
        </div>
        <div className="mcc-qbuff-grid">
          {MAINSTATBUFF.map(({ label, stat }) => (
            <div key={stat} className="mcc-qbuff-row">
              <QbuffGlyph statKey={`${stat}Flat`} />
              <span className="mcc-qbuff-label">{label}</span>
              <div className="mcc-qbuff-dual">
                <QuickField
                  value={manualBuffs.quick[stat].flat}
                  suffix={null}
                  max={9999}
                  onChange={(value) => setBase(stat, 'flat', value)}
                />
                <QuickField
                  value={manualBuffs.quick[stat].percent}
                  suffix="%"
                  max={999}
                  onChange={(value) => setBase(stat, 'percent', value)}
                />
              </div>
            </div>
          ))}
          {MAINSCLRBUFF.map(({ key, label }) => (
            <div key={key} className="mcc-qbuff-row">
              <QbuffGlyph statKey={key} />
              <span className="mcc-qbuff-label">{label}</span>
              <QuickField
                value={manualBuffs.quick[key]}
                suffix="%"
                max={999}
                onChange={(value) => setScalar(key, value)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mcc-block">
        <div className="mcc-block-head">
          <span className="mcc-block-label">Custom modifiers</span>
          <span className="mcc-block-meta">
            {modifiers.length > 0 ? `${activeCount}/${modifiers.length} on` : 'None'}
          </span>
          <span className="mcc-block-actions" role="group" aria-label="Modifier actions">
            <button type="button" className="mcc-block-action" onClick={presetModal.show}>
              <Bookmark size={13} aria-hidden="true" /> Presets
            </button>
            <button type="button" className="mcc-block-action" onClick={addMod}>
              <Plus size={13} aria-hidden="true" /> Add
            </button>
          </span>
        </div>

        {modifiers.length > 0 ? (
          <div className="mcc-mod-list">
            {modifiers
              .slice()
              .reverse()
              .map((modifier) => (
                <div
                  key={modifier.id}
                  className={`mcc-mod${modifier.enabled ? ' is-on' : ''}`}
                >
                  <div className="mcc-mod-head">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={modifier.enabled}
                      className="mcc-mod-power"
                      title={modifier.enabled ? 'Turn off' : 'Turn on'}
                      aria-label={modifier.enabled ? 'Turn off modifier' : 'Turn on modifier'}
                      onClick={() => updateMod(modifier.id, (current) => ({ ...current, enabled: !current.enabled }))}
                    />
                    <span className="mcc-mod-summary">{modSummary(modifier, { skillOptions, tabOptions })}</span>
                    <span className="mcc-mod-tools">
                      <button
                        type="button"
                        className="mcc-mod-tool"
                        title="Duplicate modifier"
                        aria-label="Duplicate modifier"
                        onClick={() => duplicateMod(modifier)}
                      >
                        <Copy size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="mcc-mod-tool is-remove"
                        title="Delete modifier"
                        aria-label="Delete modifier"
                        onClick={() => removeMod(modifier.id)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                  <div className="mcc-mod-fields">
                    {targetFields(modifier)}
                    {effectFields(modifier)}
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <div className="mcc-empty">
            No custom modifiers. Add one to hand-tune this teammate's buffs.
          </div>
        )}

        <div className="mcc-buffs-footer">
          <button type="button" className="mcc-block-action" onClick={() => importRef.current?.click()}>
            Import
          </button>
          <button type="button" className="mcc-block-action" onClick={exportBuffs}>
            Export
          </button>
          <button type="button" className="mcc-block-action is-danger" onClick={clearAll}>
            Clear all
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            hidden
            onChange={importBuffs}
          />
        </div>
      </div>

      <BuffPresetModal
        state={presetModal.dialogProps}
        runtime={runtime}
        onClose={presetModal.hide}
        onAdd={addPresets}
      />
    </div>
  )
}
