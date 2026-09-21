/*
  Author: Runor Ewhro
  Description: Projects canonical damage factors into inspectable formula rows and formatted totals.
*/

import type { FeatureResult } from '@/domain/gameData/contracts.ts'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import { ATTR_ENEMY_RES, isNoEnemy } from '@/domain/entities/appState.ts'
import { getNegEffectDef } from '@/engine/gameData/negativeEffects.ts'
import type { CombatState } from '@/domain/entities/runtime.ts'
import type { FinalStats, NegEffectKey, SkillDef, SkillTypeKey } from '@/domain/entities/stats.ts'
import { getNegBase as cmptNegFfctB } from '@/engine/formulas/negativeEffects.ts'
import {
  calcBasePower,
  defenseReduction,
  enemyDefenseBase,
  getEnemyRes,
  makeSkillBuffs,
  resistMult,
  resolveDamageFactors,
  resolveHits,
  sumHitScale,
  type DamageFactors,
} from '@/engine/formulas/damageFactors.ts'
import { getTuneLevel } from '@/engine/formulas/tuneRupture.ts'
import { mergeSkillType } from '@/engine/resolvers/buffPool.ts'
import { getSkillType, fmtSkllTypeL } from '@/domain/gameData/skillTypes.ts'
import { formatTrunc, formatTruncCompact, truncTo } from '@/shared/lib/number.ts'

/** The engine's factors, plus how this pane names the skill's types. */
type ShrdDmgCtx = DamageFactors & { skillTypeLabel: string }

/*
  A factor's role in the chain, which is what lets a readout say the difference
  between what built the hit and what the target took back off it.
*/
export type FactorKind = 'base' | 'up' | 'down' | 'flat'

/** one named contribution inside a factor that is a sum of several */
export interface FactorTerm {
  label: string
  value: string
}

export interface DmgFactor {
  key: string
  label: string
  op: '=' | 'x' | '+'
  /** the factor itself, already formatted */
  value: string
  kind: FactorKind
  /** what the hit is worth once this factor has been applied */
  run: string
  terms?: FactorTerm[]
  /** the closed form, for the factors that have one */
  expr?: string
}

export type DmgBreakdown = {
  title: string
  summary: string
  equation: string
  sections: Array<{
    label: string
    lines: string[]
  }>
  /*
    The same story as `equation`, kept in the shape it was built in rather than
    joined into a line. A narrow readout sets it out as a column of factors; the
    wide one keeps reading `equation`, which is why this is additive and
    `fmtBreakdown` never looks at it.
  */
  chain?: DmgFactor[]
  /** what the chain lands on: 'Normal hit', 'Healing', 'Tune Break' */
  outLabel?: string
  outValue?: string
  /** what happens to that figure afterwards: crit, and the crit-weighted average */
  after?: Array<{ key: string; label: string; value: string; expr: string }>
}

export function fmtBreakdown(breakdown: DmgBreakdown): string {
  // the editor-style formula viewer expects plain text with comment headers, so the structured breakdown is flattened
  // into deterministic sections instead of rendered as nested jsx.
  return [
    `// ${breakdown.title}`,
    breakdown.equation,
    ...breakdown.summary.split('\n').filter(Boolean),
    ...breakdown.sections.flatMap((section) => [
      '',
      `// ${section.label}`,
      ...section.lines,
    ]),
  ].join('\n')
}

function dmgTitle(label: string): string {
  return /\bDMG$/i.test(label.trim()) ? label : `${label} DMG`
}

function fmtInt(value: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }

  return formatTrunc(value, 0)
}

function fmtFixed(value: number, digits = 4): string {
  if (!Number.isFinite(value)) {
    return '0'
  }

  const normalized = Math.abs(value) < 1e-12 ? 0 : value
  return formatTruncCompact(normalized, digits)
}

function fmtNum(value: number, digits = 2): string {
  if (!Number.isFinite(value)) {
    return '0'
  }

  const normalized = Math.abs(value) < 1e-12 ? 0 : value
  return truncTo(normalized, digits).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
}

function fixedPct(value: number, digits = 4): string {
  return `${fmtFixed(value, digits)}%`
}

function fmtPct(value: number, digits = 2): string {
  return `${fmtNum(value, digits)}%`
}

function fmtTuneBreakBoost(value: number): string {
  return fmtNum(value)
}

function pctMul(value: number, digits = 4): string {
  return fixedPct(value * 100, digits)
}

function fmtMulPct(value: number, digits = 2): string {
  return fmtPct(value * 100, digits)
}

function nonZero(value: number, epsilon = 1e-9): boolean {
  return Math.abs(value) > epsilon
}

/* a running value wants whole numbers once it is past a thousand */
function fmtRun(value: number): string {
  return Math.abs(value) >= 1000 ? fmtInt(value) : fmtNum(value, 2)
}

/*
  The fixed-digit enemy multipliers arrive as `80.0000%`, which spends a quarter
  of a narrow row saying nothing. The flat text keeps its full precision; only
  what is read on screen is trimmed.
*/
function trimZeros(text: string): string {
  return text.replace(/(\.\d*?)0+(%?)$/, '$1$2').replace(/\.(%?)$/, '$1')
}

interface ChainStep {
  key: string
  label: string
  op?: 'x' | '+'
  /** the multiplier, or the addend when `op` is '+' */
  factor: number
  value: string
  terms?: FactorTerm[]
  expr?: string
}

/*
  Folds the factors in the order the equation applies them and records what the
  hit is worth after each one. The last running value is the entry's own damage,
  since it is the same arithmetic the pipeline did.
*/
function mkChain(
  base: { key?: string; label: string; value: string; amount: number; expr?: string },
  steps: Array<ChainStep | null | undefined | false>,
): DmgFactor[] {
  let run = base.amount
  const chain: DmgFactor[] = [{
    key: base.key ?? 'core.base',
    label: base.label,
    op: '=',
    value: trimZeros(base.value),
    kind: 'base',
    run: trimZeros(fmtRun(run)),
    ...(base.expr ? { expr: base.expr } : {}),
  }]

  for (const step of steps) {
    if (!step) continue
    const op = step.op ?? 'x'
    run = op === '+' ? run + step.factor : run * step.factor
    chain.push({
      key: step.key,
      label: step.label,
      op,
      value: trimZeros(step.value),
      kind: op === '+' ? 'flat' : step.factor < 1 ? 'down' : 'up',
      run: trimZeros(fmtRun(run)),
      ...(step.terms && step.terms.length > 0 ? { terms: step.terms } : {}),
      ...(step.expr ? { expr: step.expr } : {}),
    })
  }

  return chain
}

/* the crit pair every damaging readout closes on */
function critAfter(
  entry: FeatureResult,
  critRatePrcn: number,
  critDmgPrcn: number,
): NonNullable<DmgBreakdown['after']> {
  return [
    {
      key: 'out.crit',
      label: 'Crit',
      value: fmtInt(entry.crit),
      expr: `${fmtInt(entry.normal)} x ${fmtPct(critDmgPrcn)}`,
    },
    {
      key: 'out.avg',
      label: 'Average',
      value: fmtInt(entry.avg),
      expr: critRatePrcn >= 100
        ? 'guaranteed crit'
        : `${fmtInt(entry.normal)} x (1 + ${fmtPct(critRatePrcn)} x (${fmtPct(critDmgPrcn)} - 1))`,
    },
  ]
}

function addSection(
  sections: DmgBreakdown['sections'],
  label: string,
  ...lines: Array<string | null | undefined | false>
): void {
  // empty formula sections are omitted to keep the readout focused on factors that actually contributed.
  const normalized = lines.filter((line): line is string => Boolean(line && line.trim()))

  if (normalized.length > 0) {
    sections.push({ label, lines: normalized })
  }
}

function hitSpread(
  hits: SkillDef['hits'],
  vlFrmt: (hit: SkillDef['hits'][number]) => string,
): string {
  // multi-hit skills need compact per-hit notation so the formula can show both scale and hit count without becoming a
  // full table.
  return hits
    .map((hit, index) => {
      const value = vlFrmt(hit)
      const countSuffix = hit.count > 1 ? ` x ${hit.count}` : ''
      const label = hit.label ?? (hits.length > 1 ? `H${index + 1}` : '')

      return label ? `${label} ${value}${countSuffix}` : `${value}${countSuffix}`
    })
    .join(' + ')
}

function getSkllTypeL(skillTypes: SkillTypeKey[]): string {
  if (skillTypes.length === 0) {
    return 'Skill'
  }

  return skillTypes
    .map((skillType) => getSkillType(skillType).label ?? fmtSkllTypeL(skillType))
    .join(' + ')
}

function mkShrdDmgCtx(
  finalStats: FinalStats,
  skill: SkillDef,
  enemy: EnemyProfile,
  level: number,
): ShrdDmgCtx {
  // one resolved snapshot explains normal, healing, shield, negative-effect, and tune-rupture breakdowns alike.
  const factors = resolveDamageFactors(finalStats, skill, enemy, level)
  const skillTypeLabel = getSkllTypeL(skill.skillType)

  if (factors.zeroed) {
    // 100 percent base resistance is treated as immune before shred, matching the simulator's zero-damage shortcut,
    // and the breakdown states zeros rather than the multipliers that never got applied.
    return {
      ...factors,
      resShred: 0,
      enemyResVl: factors.baseRes,
      totalDefIgnore: 0,
      totalDefShred: 0,
      enemyDefBase: enemyDefenseBase(enemy),
      enemyDefense: 0,
      defMult: 0,
      dmgBonusPrcn: 0,
      dmgBonusMult: 0,
      ampPrcn: 0,
      ampMult: 0,
      dmgVulnPct: 0,
      dmgVulnMult: 0,
      finalDmgPct: 0,
      finalDmgMult: 0,
      critRatePrcn: 0,
      critRate: 0,
      critDmgPrcn: 0,
      critDmg: 0,
      skillTypeLabel,
    }
  }

  return { ...factors, skillTypeLabel }
}

function baseTerms(
  finalStats: FinalStats,
  skill: SkillDef,
): string {
  const terms: string[] = []

  if (skill.scaling.atk !== 0) {
    terms.push(`${fmtNum(finalStats.atk.final, 2)} ATK x ${fmtNum(skill.scaling.atk, 4)}`)
  }
  if (skill.scaling.hp !== 0) {
    terms.push(`${fmtNum(finalStats.hp.final, 2)} HP x ${fmtNum(skill.scaling.hp, 4)}`)
  }
  if (skill.scaling.def !== 0) {
    terms.push(`${fmtNum(finalStats.def.final, 2)} DEF x ${fmtNum(skill.scaling.def, 4)}`)
  }
  if (skill.scaling.energyRegen !== 0) {
    terms.push(`${fmtNum(finalStats.energyRegen, 2)} ER x ${fmtNum(skill.scaling.energyRegen, 4)}`)
  }

  return terms.length > 0 ? terms.join(' + ') : '0'
}

function baseSeg(
  finalStats: FinalStats,
  skill: SkillDef,
  baseAbility: number,
): string {
  return `core.base = ${fmtNum(baseAbility, 2)} = ${baseTerms(finalStats, skill)}`
}

function srcTerms(parts: Array<{ label: string; value: number }>, digits = 2): FactorTerm[] {
  return parts
    .filter((part) => nonZero(part.value))
    .map((part) => ({ label: part.label, value: fmtPct(part.value, digits) }))
}

function fmtSrcDdnd(parts: Array<{ label: string; value: number }>, digits = 2): string {
  const terms = srcTerms(parts, digits)

  if (terms.length === 0) {
    return fmtPct(0, digits)
  }

  return terms.map((term) => `${term.label} ${term.value}`).join(' + ')
}

/*
  Where each modifier came from, described once. The flat lines join these and
  the chain carries them as terms, so the two can never drift apart.
*/
function modParts(finalStats: FinalStats, skill: SkillDef, shared: ShrdDmgCtx) {
  const spread = (
    pick: (source: ShrdDmgCtx['attributeAll']) => number,
    global: number,
    globalLabel = 'Global',
  ) => [
    { label: globalLabel, value: global },
    { label: 'Attr All', value: pick(shared.attributeAll) },
    { label: skill.element, value: pick(shared.attrElement) },
    { label: 'Type All', value: pick(shared.skillTypeAll) },
    { label: shared.skillTypeLabel, value: pick(shared.skillTypeBuff) },
    { label: 'Skill', value: pick(shared.skillBuffs) },
  ]

  return {
    dmgBonus: spread((source) => source.dmgBonus, finalStats.dmgBonus),
    amp: spread((source) => source.amplify, finalStats.amplify),
    vuln: spread((source) => source.dmgVuln, finalStats.dmgVuln),
    finalDmg: [{ label: 'Global', value: finalStats.finalDmg }],
    critRate: spread((source) => source.critRate, finalStats.critRate, 'Base'),
    critDmg: spread((source) => source.critDmg, finalStats.critDmg, 'Base'),
  }
}

function commonLines(finalStats: FinalStats, skill: SkillDef, shared: ShrdDmgCtx): string[] {
  const parts = modParts(finalStats, skill, shared)

  return [
    `mod.dmgBonus = ${fmtPct(shared.dmgBonusPrcn)} = ${fmtSrcDdnd(parts.dmgBonus)}`,
    `mod.amp = ${fmtPct(shared.ampPrcn)} = ${fmtSrcDdnd(parts.amp)}`,
    `mod.vuln = ${fmtPct(shared.dmgVulnPct)} = ${fmtSrcDdnd(parts.vuln)}`,
    `mod.finalDmg = ${fmtPct(shared.finalDmgPct)} = Global ${fmtPct(finalStats.finalDmg)}`,
    `crit.rate = ${fmtPct(shared.critRatePrcn)} = ${fmtSrcDdnd(parts.critRate)}`,
    `crit.dmg = ${fmtPct(shared.critDmgPrcn)} = ${fmtSrcDdnd(parts.critDmg)}`,
  ]
}

function enemyExpr(level: number, shared: ShrdDmgCtx): { def: string; res: string } {
  if (shared.ignoresEnemy) {
    return { def: 'no enemy', res: 'no enemy' }
  }

  let resFormula: string
  if (shared.enemyResVl < 0) {
    resFormula = `1 - ((${fmtPct(shared.baseRes)} - ${fmtPct(shared.resShred)}) / 200)`
  } else if (shared.enemyResVl < 75) {
    resFormula = `1 - (${fmtPct(shared.baseRes)} - ${fmtPct(shared.resShred)})`
  } else {
    resFormula = `1 / (1 + 5 x ((${fmtPct(shared.baseRes)} - ${fmtPct(shared.resShred)}) / 100))`
  }

  return {
    def: `(${fmtNum(800 + 8 * level, 2)}) / (${fmtNum(800 + 8 * level, 2)} + ${fmtNum(shared.enemyDefBase, 2)} x (1 - ${fmtPct(shared.totalDefShred)}) x (1 - ${fmtPct(shared.totalDefIgnore)}))`,
    res: resFormula,
  }
}

function enemyLines(level: number, shared: ShrdDmgCtx): string[] {
  const expr = enemyExpr(level, shared)

  if (shared.ignoresEnemy) {
    return [
      `enemy.def = ${pctMul(shared.defMult, 10)} = ${expr.def}`,
      `enemy.res = ${pctMul(shared.resMult, 10)} = ${expr.res}`,
    ]
  }

  return [
    `enemy.def = ${pctMul(shared.defMult, 10)} = ${expr.def}`,
    `enemy.res = ${pctMul(shared.resMult, 10)} = ${expr.res}`,
    `enemy.res.effective = ${fmtPct(shared.enemyResVl)} = Base ${fmtPct(shared.baseRes)} - Shred ${fmtPct(shared.resShred)}`,
  ]
}

function drctBrkd(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
): DmgBreakdown {
  const { skill } = entry
  const sections: DmgBreakdown['sections'] = []

  if ((skill.fixedDmg ?? 0) > 0) {
    const dstrHits = resolveHits(skill, 1)
    const ttlHitScl = sumHitScale(dstrHits)

    addSection(
      sections,
      'core',
      `core.fixed = ${fmtInt(entry.normal)} = max(1, ${fmtNum(skill.fixedDmg ?? 0, 2)})`,
      dstrHits.length > 1 || dstrHits.some((hit) => hit.count > 1 || hit.label)
        ? `core.spread = ${hitSpread(
          dstrHits,
          (hit) => fmtPct((ttlHitScl > 0 ? hit.multiplier / ttlHitScl : 1) * 100),
        )}`
        : null,
    )

    return {
      title: dmgTitle(skill.label),
      summary: [
        `out.crit = ${fmtInt(entry.crit)} = fixed damage`,
        `out.avg = ${fmtInt(entry.avg)} = fixed damage`,
      ].join('\n'),
      equation: `out.normal = ${fmtInt(entry.normal)} = max(1, ${fmtNum(skill.fixedDmg ?? 0, 2)})`,
      sections,
      chain: mkChain(
        { key: 'core.fixed', label: 'Fixed damage', value: fmtInt(entry.normal), amount: entry.normal },
        [],
      ),
      outLabel: 'Normal hit',
      outValue: fmtInt(entry.normal),
      after: [
        { key: 'out.crit', label: 'Crit', value: fmtInt(entry.crit), expr: 'fixed damage' },
        { key: 'out.avg', label: 'Average', value: fmtInt(entry.avg), expr: 'fixed damage' },
      ],
    }
  }

  const hits = skill.hits
  if (hits.length === 0) {
    return {
      title: dmgTitle(skill.label),
      summary: [
        `out.crit = ${fmtInt(entry.crit)}`,
        `out.avg = ${fmtInt(entry.avg)}`,
      ].join('\n'),
      equation: `out.normal = ${fmtInt(entry.normal)} = no resolved hit data`,
      sections: [{ label: 'note', lines: ['No resolved hit data for this skill.'] }],
      chain: mkChain(
        { label: 'Base power', value: fmtInt(entry.normal), amount: entry.normal, expr: 'no resolved hit data' },
        [],
      ),
      outLabel: 'Normal hit',
      outValue: fmtInt(entry.normal),
      after: [],
    }
  }

  const shared = mkShrdDmgCtx(finalStats, skill, enemy, level)
  const baseAbility = calcBasePower(finalStats, skill)
  const totalMv = sumHitScale(hits)
  const ttlHitCnt = hits.reduce((total, hit) => total + hit.count, 0)
  const flatPerHit = skill.flat + finalStats.flatDmg
  const flatTotal = flatPerHit * ttlHitCnt
  const baseDmgSgmn = nonZero(flatTotal)
    ? `(${fmtNum(baseAbility, 2)} x ${fmtPct(totalMv * 100)} + ${fmtNum(flatTotal, 2)})`
    : `${fmtNum(baseAbility, 2)} x ${fmtPct(totalMv * 100)}`

  addSection(
    sections,
    'core',
    baseSeg(finalStats, skill, baseAbility),
    `core.mv = ${fmtPct(totalMv * 100)} = ${hitSpread(hits, (hit) => fmtPct(hit.multiplier * 100))}`,
    nonZero(flatTotal)
      ? `core.flat = ${fmtNum(flatTotal, 2)} = (${fmtNum(skill.flat, 2)} + ${fmtNum(finalStats.flatDmg, 2)}) x ${fmtInt(ttlHitCnt)}`
      : null,
  )
  addSection(sections, 'enemy', ...enemyLines(level, shared))
  addSection(sections, 'mods', ...commonLines(finalStats, skill, shared))

  const parts = modParts(finalStats, skill, shared)
  const enemyExprs = enemyExpr(level, shared)
  /* the same factors the equation multiplies, in the same order */
  const chain = mkChain(
    {
      label: 'Base power',
      value: fmtNum(baseAbility, 2),
      amount: baseAbility,
      expr: baseTerms(finalStats, skill),
    },
    [
      {
        key: 'core.mv',
        label: 'Motion value',
        factor: totalMv,
        value: fmtPct(totalMv * 100),
        expr: hitSpread(hits, (hit) => fmtPct(hit.multiplier * 100)),
      },
      nonZero(flatTotal) && {
        key: 'core.flat',
        label: 'Flat damage',
        op: '+' as const,
        factor: flatTotal,
        value: fmtNum(flatTotal, 2),
        expr: `(${fmtNum(skill.flat, 2)} + ${fmtNum(finalStats.flatDmg, 2)}) x ${fmtInt(ttlHitCnt)}`,
      },
      {
        key: 'mod.dmgBonus',
        label: 'DMG bonus',
        factor: shared.dmgBonusMult,
        value: fmtPct(100 + shared.dmgBonusPrcn),
        terms: srcTerms(parts.dmgBonus),
      },
      {
        key: 'mod.amp',
        label: 'Amplify',
        factor: shared.ampMult,
        value: fmtPct(100 + shared.ampPrcn),
        terms: srcTerms(parts.amp),
      },
      {
        key: 'mod.vuln',
        label: 'Vulnerability',
        factor: shared.dmgVulnMult,
        value: fmtPct(100 + shared.dmgVulnPct),
        terms: srcTerms(parts.vuln),
        ...(nonZero(shared.dmgVulnPct) ? {} : { expr: 'nothing applied' }),
      },
      {
        key: 'enemy.def',
        label: 'Target DEF',
        factor: shared.defMult,
        value: pctMul(shared.defMult, 4),
        expr: enemyExprs.def,
      },
      {
        key: 'enemy.res',
        label: 'Target RES',
        factor: shared.resMult,
        value: pctMul(shared.resMult, 4),
        expr: enemyExprs.res,
      },
      {
        key: 'mod.finalDmg',
        label: 'Final DMG',
        factor: shared.finalDmgMult,
        value: fmtPct(100 + shared.finalDmgPct),
        terms: srcTerms(parts.finalDmg),
      },
    ],
  )

  return {
    chain,
    outLabel: 'Normal hit',
    outValue: fmtInt(entry.normal),
    after: critAfter(entry, shared.critRatePrcn, shared.critDmgPrcn),
    title: dmgTitle(skill.label),
    summary: [
      `out.crit = ${fmtInt(entry.crit)} = ${fmtInt(entry.normal)} x ${fmtPct(shared.critDmgPrcn)}`,
      shared.critRate >= 1
        ? `out.avg = ${fmtInt(entry.avg)} = guaranteed crit`
        : `out.avg = ${fmtInt(entry.avg)} = ${fmtInt(entry.normal)} x (1 + ${fmtPct(shared.critRatePrcn)} x (${fmtPct(shared.critDmgPrcn)} - 1))`,
    ].join('\n'),
    equation: shared.zeroed
      ? `out.normal = ${fmtInt(entry.normal)} = 0 (enemy base RES shortcut)`
      : `out.normal = ${fmtInt(entry.normal)} = ${baseDmgSgmn} x (1 + ${fmtPct(shared.dmgBonusPrcn)}) x (1 + ${fmtPct(shared.ampPrcn)}) x (1 + ${fmtPct(shared.dmgVulnPct)}) x ${pctMul(shared.defMult, 10)} x ${pctMul(shared.resMult, 10)} x (1 + ${fmtPct(shared.finalDmgPct)})`,
    sections,
  }
}

function spprBrkd(entry: FeatureResult, finalStats: FinalStats): DmgBreakdown {
  const { skill } = entry
  const sections: DmgBreakdown['sections'] = []
  const supportType = skill.archetype === 'healing' ? 'Healing' : 'Shield'
  const supportKey = skill.archetype === 'healing' ? 'heal' : 'shield'
  const baseAbility = calcBasePower(finalStats, skill)
  const supportBonus = skill.archetype === 'healing'
    ? finalStats.healingBonus + (skill.skillHealingBonus ?? 0)
    : finalStats.shieldBonus + (skill.skillShieldBonus ?? 0)
  const ttlMltp = 1 + supportBonus / 100

  addSection(
    sections,
    'core',
    baseSeg(finalStats, skill, baseAbility),
    `core.mv = ${fmtMulPct(skill.multiplier)}`,
    nonZero(skill.flat) ? `core.flat = ${fmtNum(skill.flat, 2)}` : null,
  )
  addSection(
    sections,
    'mods',
    `mod.${supportKey} = ${fmtPct(supportBonus)} = ${skill.archetype === 'healing'
      ? fmtSrcDdnd([
        { label: 'Global', value: finalStats.healingBonus },
        { label: 'Skill', value: skill.skillHealingBonus ?? 0 },
      ])
      : fmtSrcDdnd([
        { label: 'Global', value: finalStats.shieldBonus },
        { label: 'Skill', value: skill.skillShieldBonus ?? 0 },
      ])}`,
  )

  return {
    chain: mkChain(
      {
        label: 'Base power',
        value: fmtNum(baseAbility, 2),
        amount: baseAbility,
        expr: baseTerms(finalStats, skill),
      },
      [
        {
          key: 'core.mv',
          label: 'Motion value',
          factor: skill.multiplier,
          value: fmtMulPct(skill.multiplier),
        },
        nonZero(skill.flat) && {
          key: 'core.flat',
          label: `Flat ${supportType.toLowerCase()}`,
          op: '+' as const,
          factor: skill.flat,
          value: fmtNum(skill.flat, 2),
        },
        {
          key: `mod.${supportKey}`,
          label: `${supportType} bonus`,
          factor: ttlMltp,
          value: fmtMulPct(ttlMltp),
          terms: srcTerms(skill.archetype === 'healing'
            ? [
              { label: 'Global', value: finalStats.healingBonus },
              { label: 'Skill', value: skill.skillHealingBonus ?? 0 },
            ]
            : [
              { label: 'Global', value: finalStats.shieldBonus },
              { label: 'Skill', value: skill.skillShieldBonus ?? 0 },
            ]),
        },
      ],
    ),
    outLabel: supportType,
    outValue: fmtInt(entry.avg),
    /* healing and shields do not crit, so the chain is the whole story */
    after: [],
    title: `${skill.label} ${supportType}`,
    summary: `out.normal = 0\nout.crit = 0`,
    equation: `out.avg = ${fmtInt(entry.avg)} = max(1, ((${fmtNum(baseAbility, 2)} x ${fmtMulPct(skill.multiplier)})${nonZero(skill.flat) ? ` + ${fmtNum(skill.flat, 2)}` : ''}) x ${fmtMulPct(ttlMltp)})`,
    sections,
  }
}

function tuneBrkd(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
  kind: 'tuneRupture' | 'hack' = 'tuneRupture',
): DmgBreakdown {
  const { skill } = entry
  const sections: DmgBreakdown['sections'] = []
  const hits = resolveHits(skill, skill.tuneRuptureScale ?? 16)
  const ignoresEnemy = isNoEnemy(enemy)
  const baseRes = ignoresEnemy ? 0 : getEnemyRes(enemy, skill.element)
  const attributeAll = finalStats.attribute.all
  const attrElement = finalStats.attribute[skill.element]
  const skillTypeAll = finalStats.skillType.all
  const skillTypeBuff = mergeSkillType(finalStats.skillType, skill.skillType)
  const skillBuffs = makeSkillBuffs(skill)
  const resShred =
    attributeAll.resShred +
    attrElement.resShred +
    skillTypeAll.resShred +
    skillTypeBuff.resShred +
    skillBuffs.resShred
  const defIgnore =
    skillTypeBuff.defIgnore +
    skillBuffs.defIgnore
  const defShred =
    finalStats.defShred +
    attributeAll.defShred +
    attrElement.defShred +
    skillTypeAll.defShred +
    skillTypeBuff.defShred +
    skillBuffs.defShred
  const dmgVuln =
    finalStats.dmgVuln +
    attributeAll.dmgVuln +
    attrElement.dmgVuln +
    skillTypeAll.dmgVuln +
    skillTypeBuff.dmgVuln +
    skillBuffs.dmgVuln
  const enemyResVl = ignoresEnemy ? 0 : baseRes - resShred
  const resMult = ignoresEnemy ? 1 : resistMult(enemyResVl)
  const enemyDfnsBas = ignoresEnemy ? 0 : (8 * enemy.level) + 792
  const enemyDefense = ignoresEnemy ? 0 : enemyDfnsBas * defenseReduction(defIgnore, defShred)
  const defenseMult = ignoresEnemy
    ? 1
    : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))
  const classMult = enemy.class === 3 || enemy.class === 4
    ? 14
    : enemy.class === 2
      ? 3
      : 1
  const formulaSkillType = finalStats.skillType[kind]
  const kindLabel = kind === 'hack' ? 'Hack' : 'Tune'
  const levelScale = getTuneLevel(level)
  const ttlHitScl = sumHitScale(hits)
  const ampPrcn = ttlHitScl * 100
  const critRatePrcn = (skill.tuneRuptureCritRate ?? 0) * 100
  const critDmgPrcn = (skill.tuneRuptureCritDmg ?? 1) * 100

  addSection(
    sections,
    'core',
    `core.level = ${fmtNum(levelScale, 2)}`,
    `core.${kind === 'hack' ? 'hackAmp' : 'tuneAmp'} = ${fmtPct(ampPrcn)} = ${hitSpread(hits, (hit) => fmtPct(hit.multiplier * 100))}`,
    `enemy.type = ${fmtNum(classMult, 2)}`,
  )
  addSection(
    sections,
    'enemy',
    ignoresEnemy
      ? `enemy.def = ${pctMul(defenseMult, 10)} = no enemy`
      : `enemy.def = ${pctMul(defenseMult, 10)} = (${fmtNum(800 + 8 * level, 2)}) / (${fmtNum(800 + 8 * level, 2)} + ${fmtNum(enemyDfnsBas, 2)} x (1 - ${fmtPct(defShred)}) x (1 - ${fmtPct(defIgnore)}))`,
    ignoresEnemy
      ? `enemy.res = ${pctMul(resMult, 10)} = no enemy`
      : `enemy.res = ${pctMul(resMult, 10)} = RES after shred ${fmtPct(enemyResVl)}`,
  )
  addSection(
    sections,
    'mods',
    `mod.vuln = ${fmtPct(dmgVuln)} = ${fmtSrcDdnd([
      { label: 'Global', value: finalStats.dmgVuln },
      { label: 'Elem All', value: attributeAll.dmgVuln },
      { label: skill.element, value: attrElement.dmgVuln },
      { label: 'Type All', value: skillTypeAll.dmgVuln },
      { label: kindLabel, value: skillTypeBuff.dmgVuln },
      { label: 'Skill', value: skillBuffs.dmgVuln },
    ])}`,
    `mod.dmgBonus = ${fmtPct(formulaSkillType.dmgBonus)} = ${kindLabel} ${fmtPct(formulaSkillType.dmgBonus)}`,
    `mod.amp = ${fmtPct(finalStats.amplify)} = Global ${fmtPct(finalStats.amplify)}`,
    `mod.finalDmg = ${fmtPct(finalStats.finalDmg)} = Global ${fmtPct(finalStats.finalDmg)}`,
    `mod.tuneBoost = ${fmtTuneBreakBoost(finalStats.tbb)}`,
    `crit.rate = ${fmtPct(critRatePrcn)}`,
    `crit.dmg = ${fmtPct(critDmgPrcn)}`,
  )

  return {
    chain: mkChain(
      { key: 'core.level', label: 'Level base', value: fmtNum(levelScale, 2), amount: levelScale },
      [
        {
          key: `core.${kind === 'hack' ? 'hackAmp' : 'tuneAmp'}`,
          label: `${kindLabel} amplifier`,
          factor: ttlHitScl,
          value: fmtPct(ampPrcn),
          expr: hitSpread(hits, (hit) => fmtPct(hit.multiplier * 100)),
        },
        {
          key: 'enemy.def',
          label: 'Target DEF',
          factor: defenseMult,
          value: pctMul(defenseMult, 4),
          expr: ignoresEnemy
            ? 'no enemy'
            : `(${fmtNum(800 + 8 * level, 2)}) / (${fmtNum(800 + 8 * level, 2)} + ${fmtNum(enemyDfnsBas, 2)} x (1 - ${fmtPct(defShred)}) x (1 - ${fmtPct(defIgnore)}))`,
        },
        {
          key: 'enemy.res',
          label: 'Target RES',
          factor: resMult,
          value: pctMul(resMult, 4),
          expr: ignoresEnemy ? 'no enemy' : `RES after shred ${fmtPct(enemyResVl)}`,
        },
        {
          key: 'mod.vuln',
          label: 'Vulnerability',
          factor: 1 + dmgVuln / 100,
          value: fmtPct(100 + dmgVuln),
          ...(nonZero(dmgVuln) ? {} : { expr: 'nothing applied' }),
        },
        {
          key: 'enemy.type',
          label: 'Target class',
          factor: classMult,
          value: fmtNum(classMult, 2),
          expr: `class ${fmtNum(enemy.class, 0)}`,
        },
        {
          key: 'mod.amp',
          label: 'Amplify',
          factor: 1 + finalStats.amplify / 100,
          value: fmtPct(100 + finalStats.amplify),
          terms: srcTerms([{ label: 'Global', value: finalStats.amplify }]),
        },
        {
          key: 'mod.dmgBonus',
          label: 'DMG bonus',
          factor: 1 + formulaSkillType.dmgBonus / 100,
          value: fmtPct(100 + formulaSkillType.dmgBonus),
          terms: srcTerms([{ label: kindLabel, value: formulaSkillType.dmgBonus }]),
        },
        {
          key: 'mod.finalDmg',
          label: 'Final DMG',
          factor: 1 + finalStats.finalDmg / 100,
          value: fmtPct(100 + finalStats.finalDmg),
          terms: srcTerms([{ label: 'Global', value: finalStats.finalDmg }]),
        },
        {
          key: 'mod.tuneBoost',
          label: `${kindLabel} Break Boost`,
          factor: 1 + finalStats.tbb / 100,
          value: fmtPct(100 + finalStats.tbb),
          expr: `1 + ${fmtTuneBreakBoost(finalStats.tbb)} / 100`,
        },
      ],
    ),
    outLabel: dmgTitle(skill.label),
    outValue: fmtInt(entry.normal),
    after: critRatePrcn <= 0
      ? []
      : critAfter(entry, critRatePrcn, critDmgPrcn),
    title: dmgTitle(skill.label),
    summary: [
      `out.crit = ${fmtInt(entry.crit)} = ${fmtInt(entry.normal)} x ${fmtPct(critDmgPrcn)}`,
      (skill.tuneRuptureCritRate ?? 0) >= 1
        ? `out.avg = ${fmtInt(entry.avg)} = guaranteed crit`
        : `out.avg = ${fmtInt(entry.avg)} = ${fmtInt(entry.normal)} x (1 + ${fmtPct(critRatePrcn)} x (${fmtPct(critDmgPrcn)} - 1))`,
    ].join('\n'),
    equation: !ignoresEnemy && baseRes === 100
      ? `out.normal = ${fmtInt(entry.normal)} = 0 (enemy base RES shortcut)`
      : `out.normal = ${fmtInt(entry.normal)} = ${fmtNum(levelScale, 2)} x ${fmtPct(ampPrcn)} x ${pctMul(defenseMult, 10)} x ${pctMul(resMult, 10)} x (1 + ${fmtPct(dmgVuln)}) x ${fmtNum(classMult, 2)} x (1 + ${fmtPct(finalStats.amplify)}) x (1 + ${fmtPct(formulaSkillType.dmgBonus)}) x (1 + ${fmtTuneBreakBoost(finalStats.tbb)} / 100) x (1 + ${fmtPct(finalStats.finalDmg)})`,
    sections,
  }
}

function getNegBase(
  archetype: SkillDef['archetype'],
  level: number,
  stacks: number,
  fixedMv?: number,
): number {
  if (
    archetype !== 'spectroFrazzle'
    && archetype !== 'aeroErosion'
    && archetype !== 'fusionBurst'
    && archetype !== 'glacioChafe'
    && archetype !== 'electroFlare'
  ) {
    return 0
  }

  return cmptNegFfctB(archetype, level, stacks, { fixedMv })
}

function negBreakdown(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
  combatState: CombatState,
): DmgBreakdown {
  const { skill } = entry
  const sections: DmgBreakdown['sections'] = []
  const effectArch = skill.archetype as Extract<
    SkillDef['archetype'],
    'spectroFrazzle' | 'aeroErosion' | 'fusionBurst' | 'glacioChafe' | 'electroFlare'
  >
  const rawStacks = effectArch === 'spectroFrazzle'
    ? combatState.spectroFrazzle
    : effectArch === 'aeroErosion'
      ? combatState.aeroErosion
      : effectArch === 'fusionBurst'
        ? combatState.fusionBurst
        : effectArch === 'glacioChafe'
          ? combatState.glacioChafe
        : combatState.electroFlare
  const stacks = skill.stackMode === 'fixedMax'
    ? skill.stackMax ?? getNegEffectDef(effectArch)
    : rawStacks
  const extraStacks = effectArch === 'electroFlare'
    && combatState.electroFlare > getNegEffectDef('electroFlare')
    ? combatState.electroRage
    : 0
  const element = effectArch === 'spectroFrazzle'
    ? 'spectro'
    : effectArch === 'aeroErosion'
      ? 'aero'
      : effectArch === 'fusionBurst'
        ? 'fusion'
        : effectArch === 'glacioChafe'
          ? 'glacio'
        : 'electro'
  const ggrgFfctType = mergeSkillType(finalStats.skillType, skill.skillType)
  const negFfctBuff = finalStats.negativeEffect[effectArch as NegEffectKey]
  const skillBuffs = makeSkillBuffs(skill)
  const attributeAll = finalStats.attribute.all
  const attrElement = finalStats.attribute[element]
  const ignoresEnemy = isNoEnemy(enemy)
  const baseRes = ignoresEnemy ? 0 : enemy.res[ATTR_ENEMY_RES[element]]
  const resShred = attributeAll.resShred + attrElement.resShred + ggrgFfctType.resShred
  const defIgnore = ggrgFfctType.defIgnore + skillBuffs.defIgnore
  const defShred = finalStats.defShred + attributeAll.defShred + attrElement.defShred + ggrgFfctType.defShred
  const dmgVuln = finalStats.dmgVuln + attributeAll.dmgVuln + attrElement.dmgVuln + ggrgFfctType.dmgVuln
  const enemyResVl = ignoresEnemy ? 0 : baseRes - resShred
  const resMult = ignoresEnemy ? 1 : resistMult(enemyResVl)
  const enemyDfnsBas = ignoresEnemy ? 0 : (8 * enemy.level) + 792
  const enemyDefense = ignoresEnemy ? 0 : enemyDfnsBas * defenseReduction(defIgnore, defShred)
  const defenseMult = ignoresEnemy
    ? 1
    : (800 + 8 * level) / (800 + 8 * level + Math.max(0, enemyDefense))
  const hits = resolveHits(skill, 1)
  const ttlHitScl = sumHitScale(hits)
  const perStackBase =
    getNegBase(effectArch, level, stacks, skill.fixedMv) +
    (effectArch === 'electroFlare' ? getNegBase(effectArch, level, extraStacks, skill.fixedMv) : 0)
  const negFfctMltp = 1 + negFfctBuff.multiplier
  const critRatePrcn = ((skill.negativeEffectCritRate ?? 0) * 100) + negFfctBuff.critRate
  const critDmgPrcn = ((skill.negativeEffectCritDmg ?? 1) * 100) + negFfctBuff.critDmg

  if (stacks <= 0 && extraStacks <= 0) {
    return {
      title: dmgTitle(skill.label),
      summary: [
        `out.crit = ${fmtInt(entry.crit)}`,
        `out.avg = ${fmtInt(entry.avg)}`,
      ].join('\n'),
      equation: `out.normal = ${fmtInt(entry.normal)} = 0 (no stacks)`,
      sections: [{ label: 'core', lines: ['core.stacks = 0'] }],
      chain: mkChain(
        { key: 'core.stacks', label: 'Stacks', value: '0', amount: 0, expr: 'the effect is not on the target' },
        [],
      ),
      outLabel: 'Normal hit',
      outValue: fmtInt(entry.normal),
      after: [],
    }
  }

  addSection(
    sections,
    'core',
    effectArch === 'electroFlare'
      ? `core.stacks = ${fmtInt(stacks)} + ${fmtInt(extraStacks)}`
      : `core.stacks = ${fmtInt(stacks)}`,
    `core.base = ${fmtNum(perStackBase, 2)}`,
    `core.mv = ${fmtPct(ttlHitScl * 100)} = ${hitSpread(hits, (hit) => fmtPct(hit.multiplier * 100))}`,
  )
  addSection(
    sections,
    'enemy',
    ignoresEnemy
      ? `enemy.def = ${pctMul(defenseMult, 10)} = no enemy`
      : `enemy.def = ${pctMul(defenseMult, 10)} = (${fmtNum(800 + 8 * level, 2)}) / (${fmtNum(800 + 8 * level, 2)} + ${fmtNum(enemyDfnsBas, 2)} x (1 - ${fmtPct(defShred)}) x (1 - ${fmtPct(defIgnore)}))`,
    ignoresEnemy
      ? `enemy.res = ${pctMul(resMult, 10)} = no enemy`
      : `enemy.res = ${pctMul(resMult, 10)} = RES after shred ${fmtPct(enemyResVl)}`,
  )
  addSection(
    sections,
    'mods',
    `mod.effect = ${fmtMulPct(negFfctMltp)} = ${getSkillType(skill.skillType).label} bonus ${fmtPct(negFfctBuff.multiplier * 100)}`,
    `mod.dmgBonus = ${fmtPct(ggrgFfctType.dmgBonus)} = Effect ${fmtPct(ggrgFfctType.dmgBonus)}`,
    `mod.amp = ${fmtPct(finalStats.amplify + ggrgFfctType.amplify)} = Global ${fmtPct(finalStats.amplify)} + Effect ${fmtPct(ggrgFfctType.amplify)}`,
    `mod.vuln = ${fmtPct(dmgVuln)} = Global ${fmtPct(finalStats.dmgVuln)} + Elem All ${fmtPct(attributeAll.dmgVuln)} + ${element} ${fmtPct(attrElement.dmgVuln)} + Effect ${fmtPct(ggrgFfctType.dmgVuln)}`,
    `mod.finalDmg = ${fmtPct(finalStats.finalDmg)}`,
    `crit.rate = ${fmtPct(critRatePrcn)}`,
    `crit.dmg = ${fmtPct(critDmgPrcn)}`,
  )

  return {
    chain: mkChain(
      {
        label: 'Effect base',
        value: fmtNum(perStackBase, 2),
        amount: perStackBase,
        expr: effectArch === 'electroFlare'
          ? `${fmtInt(stacks)} + ${fmtInt(extraStacks)} stacks`
          : `${fmtInt(stacks)} stack${stacks === 1 ? '' : 's'}`,
      },
      [
        {
          key: 'core.mv',
          label: 'Motion value',
          factor: ttlHitScl,
          value: fmtPct(ttlHitScl * 100),
          expr: hitSpread(hits, (hit) => fmtPct(hit.multiplier * 100)),
        },
        {
          key: 'mod.effect',
          label: `${getSkillType(skill.skillType).label} bonus`,
          factor: negFfctMltp,
          value: fmtMulPct(negFfctMltp),
        },
        {
          key: 'enemy.def',
          label: 'Target DEF',
          factor: defenseMult,
          value: pctMul(defenseMult, 4),
          expr: ignoresEnemy
            ? 'no enemy'
            : `(${fmtNum(800 + 8 * level, 2)}) / (${fmtNum(800 + 8 * level, 2)} + ${fmtNum(enemyDfnsBas, 2)} x (1 - ${fmtPct(defShred)}) x (1 - ${fmtPct(defIgnore)}))`,
        },
        {
          key: 'enemy.res',
          label: 'Target RES',
          factor: resMult,
          value: pctMul(resMult, 4),
          expr: ignoresEnemy ? 'no enemy' : `RES after shred ${fmtPct(enemyResVl)}`,
        },
        {
          key: 'mod.amp',
          label: 'Amplify',
          factor: 1 + (finalStats.amplify + ggrgFfctType.amplify) / 100,
          value: fmtPct(100 + finalStats.amplify + ggrgFfctType.amplify),
          terms: srcTerms([
            { label: 'Global', value: finalStats.amplify },
            { label: 'Effect', value: ggrgFfctType.amplify },
          ]),
        },
        {
          key: 'mod.dmgBonus',
          label: 'DMG bonus',
          factor: 1 + ggrgFfctType.dmgBonus / 100,
          value: fmtPct(100 + ggrgFfctType.dmgBonus),
          terms: srcTerms([{ label: 'Effect', value: ggrgFfctType.dmgBonus }]),
        },
        {
          key: 'mod.vuln',
          label: 'Vulnerability',
          factor: 1 + dmgVuln / 100,
          value: fmtPct(100 + dmgVuln),
          ...(nonZero(dmgVuln) ? {} : { expr: 'nothing applied' }),
        },
        {
          key: 'mod.finalDmg',
          label: 'Final DMG',
          factor: 1 + finalStats.finalDmg / 100,
          value: fmtPct(100 + finalStats.finalDmg),
          terms: srcTerms([{ label: 'Global', value: finalStats.finalDmg }]),
        },
      ],
    ),
    outLabel: 'Normal hit',
    outValue: fmtInt(entry.normal),
    after: critAfter(entry, critRatePrcn, critDmgPrcn),
    title: dmgTitle(skill.label),
    summary: [
      `out.crit = ${fmtInt(entry.crit)} = ${fmtInt(entry.normal)} x ${fmtPct(critDmgPrcn)}`,
      critRatePrcn >= 100
        ? `out.avg = ${fmtInt(entry.avg)} = guaranteed crit`
        : `out.avg = ${fmtInt(entry.avg)} = ${fmtInt(entry.normal)} x (1 + ${fmtPct(critRatePrcn)} x (${fmtPct(critDmgPrcn)} - 1))`,
    ].join('\n'),
    equation: `out.normal = ${fmtInt(entry.normal)} = ${fmtNum(perStackBase, 2)} x ${fmtPct(ttlHitScl * 100)} x ${fmtMulPct(negFfctMltp)} x ${pctMul(defenseMult, 10)} x ${pctMul(resMult, 10)} x (1 + ${fmtPct(finalStats.amplify + ggrgFfctType.amplify)}) x (1 + ${fmtPct(ggrgFfctType.dmgBonus)}) x (1 + ${fmtPct(dmgVuln)}) x (1 + ${fmtPct(finalStats.finalDmg)})`,
    sections,
  }
}

export function formBrkd(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
  combatState: CombatState,
): DmgBreakdown {
  switch (entry.skill.archetype) {
    case 'healing':
    case 'shield':
      return spprBrkd(entry, finalStats)
    case 'tuneRupture':
      return tuneBrkd(entry, finalStats, enemy, level)
    case 'hack':
      return tuneBrkd(entry, finalStats, enemy, level, 'hack')
    case 'spectroFrazzle':
    case 'aeroErosion':
    case 'fusionBurst':
    case 'glacioChafe':
    case 'electroFlare':
      return negBreakdown(entry, finalStats, enemy, level, combatState)
    case 'skillDamage':
    default:
      return drctBrkd(entry, finalStats, enemy, level)
  }
}

export function skillFormula(
  entry: FeatureResult,
  finalStats: FinalStats,
  enemy: EnemyProfile,
  level: number,
  combatState: CombatState,
): string {
  return fmtBreakdown(
    formBrkd(entry, finalStats, enemy, level, combatState),
  )
}
