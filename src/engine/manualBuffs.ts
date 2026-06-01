/*
  Author: Runor Ewhro
  Description: Applies manual quick buffs and custom manual modifiers to
               unified buff pools and individual skill definitions.
*/

import type { ManualBuffs, MnlMod, MnlSkllMod } from '@/domain/entities/manualBuffs'
import type { SkillDef, UnifiedBuffPool } from '@/domain/entities/stats'
import { makeModBuff } from '@/engine/resolvers/buffPool'

// ignore disabled, non-finite, and zero-value rows before they reach the hot
// switch paths. a zero modifier is treated as absent so saved placeholder rows
// do not perturb buff pools or skill definitions.
function isEnabled(modifier: MnlMod): boolean {
  return modifier.enabled && Number.isFinite(modifier.value) && modifier.value !== 0
}

// apply quick buffs and every non-skill manual modifier directly to the shared
// buff pool. skill-scoped modifiers are skipped here because they must be
// evaluated against each skill definition after source/runtime effects resolve.
export function applyMnlBffs(pool: UnifiedBuffPool, manualBuffs: ManualBuffs): void {
  const { quick, modifiers } = manualBuffs

  // quick buffs are unscoped editor fields, so they map straight into the
  // shared top-level pool before custom modifier rows are considered.
  pool.atk.flat += quick.atk.flat
  pool.atk.percent += quick.atk.percent
  pool.hp.flat += quick.hp.flat
  pool.hp.percent += quick.hp.percent
  pool.def.flat += quick.def.flat
  pool.def.percent += quick.def.percent
  pool.critRate += quick.critRate
  pool.critDmg += quick.critDmg
  pool.energyRegen += quick.energyRegen
  pool.healingBonus += quick.healingBonus

  // custom rows carry their own scope discriminator; each branch mutates only
  // the relevant pool lane and leaves unknown or skill-only rows untouched.
  for (const modifier of modifiers) {
    if (!isEnabled(modifier)) {
      continue
    }

    switch (modifier.scope) {
      case 'baseStat':
        pool[modifier.stat][modifier.field] += modifier.value
        break

      case 'topStat':
        pool[modifier.stat] += modifier.value
        break

      case 'attribute':
        pool.attribute[modifier.attribute][modifier.mod] += modifier.value
        break

      case 'skillType':
        pool.skillType[modifier.skillType][modifier.mod] += modifier.value
        break

      case 'negativeEffect':
        pool.negativeEffect[modifier.negativeEffect][modifier.mod] += modifier.value
        break

        // skill-scoped modifiers are handled separately per skill
      case 'skill':
        break

      default:
        break
    }
  }
}

// check whether a skill-scoped row targets this skill. id mode is exact and is
// used for one concrete skill; tab mode fans out across all skills in the tab.
function mtchSkllMod(
    skill: SkillDef,
    modifier: MnlSkllMod,
): boolean {
  if (modifier.matchMode === 'skillId') {
    return Boolean(modifier.skillId) && skill.id === modifier.skillId
  }

  if (modifier.matchMode === 'skillType') {
    return modifier.skillType === 'all' || Boolean(modifier.skillType && skill.skillType.includes(modifier.skillType))
  }

  if (modifier.matchMode === 'archetype') {
    return Boolean(modifier.archetype) && skill.archetype === modifier.archetype
  }

  return Boolean(modifier.tab) && skill.tab === modifier.tab
}


// collapse hit rows back into the aggregate multiplier used by old single-row
// skills. hit count matters here because repeated sub-hits contribute multiple
// copies of the row multiplier.
function sumHits(skill: Pick<SkillDef, 'hits'>): number {
  return skill.hits.reduce((total, hit) => total + hit.multiplier * hit.count, 0)
}

// add a flat multiplier value while preserving the hit table's relative shape.
// if a skill has detailed hits, the aggregate delta is converted into a scale
// factor and applied to each hit so downstream breakdowns still match totals.
function applyDddMltp(skill: SkillDef, dddMltp: number): SkillDef {
  const curMltp = skill.multiplier

  if (curMltp <= 0 || dddMltp === 0) {
    return skill
  }

  if (skill.hits.length === 0) {
    return {
      ...skill,
      multiplier: curMltp + dddMltp,
    }
  }

  const mltpScl = (curMltp + dddMltp) / curMltp
  const hits = skill.hits.map((hit) => ({
    ...hit,
    multiplier: hit.multiplier * mltpScl,
  }))

  return {
    ...skill,
    multiplier: sumHits({ hits }),
    hits,
  }
}

// multiply the whole skill by a percentage scale. detailed hit tables are
// scaled row-by-row, then the aggregate multiplier is recomputed from those
// rows so the summary and per-hit data cannot drift apart.
function applyMltpScl(skill: SkillDef, mltpScl: number): SkillDef {
  if (mltpScl === 1) {
    return skill
  }

  if (skill.hits.length === 0) {
    return {
      ...skill,
      multiplier: skill.multiplier * mltpScl,
    }
  }

  const hits = skill.hits.map((hit) => ({
    ...hit,
    multiplier: hit.multiplier * mltpScl,
  }))

  return {
    ...skill,
    multiplier: sumHits({ hits }),
    hits,
  }
}

function applyHitMltp(skill: SkillDef, hitIndex: number, dddMltp: number): SkillDef {
  if (dddMltp === 0 || hitIndex < 0 || hitIndex >= skill.hits.length) {
    return skill
  }

  const hits = skill.hits.map((hit, index) => (
    index === hitIndex
      ? { ...hit, multiplier: hit.multiplier + dddMltp }
      : hit
  ))

  return {
    ...skill,
    multiplier: sumHits({ hits }),
    hits,
  }
}

// apply one enabled skill modifier after target matching. stat-style modifiers
// become skill-local buffs, while multiplier rows rewrite the skill definition
// itself so later damage evaluation sees the adjusted scaling.
function applySkllMod(skill: SkillDef, modifier: MnlSkllMod): SkillDef {
  if (modifier.effect === 'mod') {
    return {
      ...skill,
      skillBuffs: {
        ...(skill.skillBuffs ?? makeModBuff()),
        [modifier.mod]: (skill.skillBuffs?.[modifier.mod] ?? 0) + modifier.value,
      },
    }
  }

  if (modifier.effect === 'addMultiplier') {
    return applyDddMltp(skill, modifier.value / 100)
  }

  if (modifier.effect === 'scaleMultiplier') {
    return applyMltpScl(skill, 1 + modifier.value / 100)
  }

  if (modifier.effect === 'addHitMultiplier') {
    return applyHitMltp(skill, modifier.hitIndex, modifier.value / 100)
  }

  return {
    ...skill,
    [modifier.field]: ((skill[modifier.field] as number | undefined) ?? 0) + modifier.value,
  }
}

// apply every matching skill-scoped row to one skill definition in order. the
// multiplier is normalized from hits before each row, so chained manual edits
// work the same for old aggregate-only skills and newer multi-hit skills.
export function applyMnlSkll(skill: SkillDef, manualBuffs: ManualBuffs): SkillDef {
  let next = skill

  for (const modifier of manualBuffs.modifiers) {
    if (modifier.scope !== 'skill' || !isEnabled(modifier) || !mtchSkllMod(next, modifier)) {
      continue
    }

    next = applySkllMod({
      ...next,
      multiplier: next.hits.length > 0 ? sumHits(next) : next.multiplier,
    }, modifier)
  }

  return next
}
