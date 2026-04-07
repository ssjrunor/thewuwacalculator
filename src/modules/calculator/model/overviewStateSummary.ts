/*
  Author: Runor Ewhro
  Description: builds grouped overview summaries of active states and effects
               across the active resonator, teammates, weapon, main echo,
               and echo sets for the character overview panel.
*/

import type { CombatGraph } from '@/domain/entities/combatGraph'
import { buildTeamCompositionInfo } from '@/domain/gameData/teamComposition'
import { readRuntimePath } from '@/domain/gameData/runtimePath'
import type {
  EffectDefinition,
  EffectRuntimeContext,
  SourceOwnerDefinition,
  SourceStateDefinition,
} from '@/domain/gameData/contracts'
import { isUnsetWeaponId, type ResonatorRuntimeState } from '@/domain/entities/runtime'
import { computeEchoSetCounts } from '@/engine/pipeline/buildCombatContext'
import { buildTransientCombatGraph, findCombatParticipantSlotId } from '@/domain/state/combatGraph'
import { makeDefaultEnemyProfile } from '@/domain/state/defaults'
import { evaluateCondition, evaluateFormula } from '@/engine/effects/evaluator'
import { buildSourceStateScope } from '@/modules/calculator/model/sourceStateEvaluation'
import { effectTargetsRuntime } from '@/engine/effects/targetScope'
import { buildCombatContext } from '@/engine/pipeline/buildCombatContext'
import type { CombatContext } from '@/engine/pipeline/types'
import {
  listEffectsForOwnerKey,
  listSkillsForSource,
  listOwnersForSource,
  listStatesForOwnerKey,
} from '@/domain/services/gameDataService'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { getSkillTypeDisplay } from '@/modules/calculator/model/skillTypes'
import { getEchoSetDef } from '@/data/gameData/echoSets/effects'

export interface OverviewStateSummaryNode {
  id: string
  ownerLabel: string
  ownerScope: string
  ownerScopeLabel: string
  stateLabels: string[]
  effectLabels: string[]
}

export interface OverviewStateSummaryScopeGroup {
  id: string
  label: string
  nodes: OverviewStateSummaryNode[]
}

export interface OverviewStateSummaryGroup {
  id: string
  sourceId: string
  sourceName: string
  sourceProfile: string
  scopes: OverviewStateSummaryScopeGroup[]
}

// normalize ids / camelCase / snake_case / kebab-case into readable labels
function toTitle(value: string): string {
  if (!value) return ''
  return value
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase())
      .trim()
}

// compact number formatting used in human-readable effect labels
function formatValue(value: number, suffix = ''): string {
  const normalized = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
  return `${normalized}${suffix}`
}

// signed number formatting used for buffs/debuffs
function formatSignedValue(value: number, suffix = ''): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${formatValue(value, suffix)}`
}

// pretty labels for base stat references
function formatBaseStatLabel(stat: string): string {
  if (stat === 'atk') return 'ATK'
  if (stat === 'hp') return 'HP'
  if (stat === 'def') return 'DEF'
  return toTitle(stat)
}

// pretty labels for top-level scalar stats
function formatTopStatLabel(stat: string): string {
  const labels: Record<string, string> = {
    flatDmg: 'Flat DMG',
    amplify: 'DMG Amplify',
    critRate: 'Crit Rate',
    critDmg: 'Crit DMG',
    energyRegen: 'Energy Regen',
    healingBonus: 'Healing Bonus',
    shieldBonus: 'Shield Bonus',
    dmgBonus: 'DMG Bonus',
    dmgVuln: 'DMG Vulnerability',
    tuneBreakBoost: 'Tune Break Bonus',
    special: 'Special',
  }

  return labels[stat] ?? toTitle(stat)
}

// labels for skill-specific scalar fields
function formatSkillScalarLabel(field: string): string {
  const labels: Record<string, string> = {
    fixedDmg: 'Fixed DMG',
    skillHealingBonus: 'Healing Bonus',
    skillShieldBonus: 'Shield Bonus',
    tuneRuptureCritRate: 'Tune Rupture Crit Rate',
    tuneRuptureCritDmg: 'Tune Rupture Crit DMG',
    negativeEffectCritRate: 'Negative Effect Crit Rate',
    negativeEffectCritDmg: 'Negative Effect Crit DMG',
  }

  return labels[field] ?? toTitle(field)
}

// display labels for attribute-targeted effect ops
function formatAttributeLabel(attribute: string): string {
  if (attribute === 'all') {
    return 'All Attributes'
  }

  return toTitle(attribute)
}

// display labels for modifier types
function formatModLabel(mod: string): string {
  const labels: Record<string, string> = {
    resShred: 'RES Shred',
    dmgBonus: 'DMG Bonus',
    amplify: 'DMG Amplify',
    defIgnore: 'DEF Ignore',
    defShred: 'DEF Shred',
    dmgVuln: 'DMG Vulnerability',
    critRate: 'Crit Rate',
    critDmg: 'Crit DMG',
  }

  return labels[mod] ?? toTitle(mod)
}

function formatNegativeEffectLabel(key: string): string {
  return getSkillTypeDisplay(key).label
}

// group label shown above nodes with the same owner scope
function formatOwnerScopeLabel(owner: SourceOwnerDefinition): string {
  if (owner.source.type === 'echo' || owner.source.type === 'echoSet') {
    return 'Echoes'
  }

  const labels: Record<SourceOwnerDefinition['scope'], string> = {
    resonator: 'State',
    weapon: 'Weapon',
    echo: 'Echo',
    team: 'Team',
    sequence: 'Sequence',
    inherent: 'Inherent',
  }

  return labels[owner.scope] ?? toTitle(owner.scope)
}

// internal group id for owner scope buckets
function formatOwnerScopeKey(owner: SourceOwnerDefinition): string {
  if (owner.source.type === 'echo' || owner.source.type === 'echoSet') {
    return 'echoes'
  }

  return owner.scope
}

// owner display label shown for each node
function formatOwnerLabel(owner: SourceOwnerDefinition): string {
  if (owner.source.type === 'echo') {
    return `Main Echo: ${owner.label}`
  }

  return owner.label
}

// specialized label for echo set piece summaries like "Moonlit Clouds 2pc"
function formatEchoSetPieceLabel(owner: SourceOwnerDefinition, effectId: string): string {
  const setId = Number(owner.source.id)
  const setDef = Number.isFinite(setId) ? getEchoSetDef(setId) : undefined

  if (!setDef) {
    return owner.label
  }

  if (effectId.endsWith(':2pc')) {
    return `${owner.label} 2pc`
  }

  return `${owner.label} ${setDef.setMax === 3 ? '3pc' : '5pc'}`
}

// wrap a runtime effect context into the evaluator scope shape used by conditions/formulas
function buildEvalScope(context: EffectRuntimeContext) {
  return {
    sourceRuntime: context.sourceRuntime,
    sourceFinalStats: context.sourceFinalStats,
    targetRuntime: context.targetRuntime,
    activeRuntime: context.activeRuntime,
    context,
    baseStats: context.baseStats,
    finalStats: context.finalStats,
    pool: context.pool,
  }
}

// detect whether a source state is currently active by reading its runtime path
function isStateActive(state: SourceStateDefinition, targetRuntime: ResonatorRuntimeState): boolean {
  const rawValue = readRuntimePath(targetRuntime, state.path)

  // toggles are active only when explicitly true
  if (state.kind === 'toggle') {
    return rawValue === true
  }

  // selects are active when they differ from the default/empty state
  if (state.kind === 'select') {
    const value = rawValue == null ? '' : String(rawValue)
    const defaultValue = state.defaultValue == null ? '' : String(state.defaultValue)
    return value !== '' && value !== defaultValue
  }

  // numeric/stack states are active when finite and different from default and zero
  const numericValue =
      typeof rawValue === 'number'
          ? rawValue
          : typeof rawValue === 'string'
              ? Number(rawValue)
              : 0
  const defaultValue =
      typeof state.defaultValue === 'number'
          ? state.defaultValue
          : typeof state.defaultValue === 'string'
              ? Number(state.defaultValue)
              : 0

  return Number.isFinite(numericValue) && numericValue !== defaultValue && numericValue !== 0
}

// resolve skill labels used by skill-scoped operations so summary text can be human-readable
function resolveMatchedSkillLabels(
    effect: EffectDefinition,
    operation: EffectDefinition['operations'][number],
): string[] {
  const skills = effect.source.type === 'resonator'
      ? listSkillsForSource('resonator', effect.source.id)
      : []

  if (!('match' in operation) || !operation.match) {
    return []
  }

  if (operation.match.skillIds?.length) {
    return operation.match.skillIds
        .map((skillId) => skills.find((skill) => skill.id === skillId)?.label ?? skillId)
        .filter((label): label is string => Boolean(label))
  }

  if (operation.match.skillTypes?.length) {
    return operation.match.skillTypes.map((skillType) => getSkillTypeDisplay(skillType).label)
  }

  if (operation.match.tabs?.length) {
    return operation.match.tabs
        .map((tab) => {
          const skillInTab = skills.find((skill) => skill.tab === tab)

          if (skillInTab?.sectionTitle) {
            return skillInTab.sectionTitle
          }

          return toTitle(tab)
        })
        .filter((label, index, arr) => arr.indexOf(label) === index)
  }

  return []
}

// escape html because effect labels are later rendered with span markup
function escapeHtml(value: string): string {
  return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
}

// build the final highlighted label fragment for one effect line
function withHighlight(mainLabel: string, modLabel: string, value: string): string {
  return [
    mainLabel ? `<span class="effect-label-main">${escapeHtml(mainLabel)}</span>` : '',
    (modLabel || value)
        ? `<span class="effect-label-mod">${modLabel ? `${escapeHtml(modLabel)} ` : ''}<span class="effect-label-value highlight">${escapeHtml(value)}</span></span>`
        : '',
  ]
      .filter(Boolean)
      .join(' ')
}

// convert effect operations into compact human-readable summary labels
function formatOperationLabels(
    effect: EffectDefinition,
    context: EffectRuntimeContext,
): string[] {
  const scope = buildEvalScope(context)

  return effect.operations.flatMap((operation) => {
    // base stat adders like atk% / hp flat / def flat
    if (operation.type === 'add_base_stat') {
      const suffix = operation.field === 'percent' ? '%' : ''
      const value = formatSignedValue(evaluateFormula(operation.value, scope), suffix)
      return withHighlight(formatBaseStatLabel(operation.stat), '', value)
    }

    // top-level scalar adders like crit rate, flat damage, healing bonus, etc.
    if (operation.type === 'add_top_stat') {
      const rawValue = evaluateFormula(operation.value, scope)
      const value = formatSignedValue(rawValue, '%')
      return withHighlight(formatTopStatLabel(operation.stat), '', value)
    }

    // attribute mod ops may affect one or several attributes
    if (operation.type === 'add_attribute_mod') {
      const attributes = Array.isArray(operation.attribute) ? operation.attribute : [operation.attribute]
      const value = formatSignedValue(evaluateFormula(operation.value, scope), '%')

      return attributes.map((attr) =>
          withHighlight(
              formatAttributeLabel(attr),
              formatModLabel(operation.mod),
              value,
          ),
      )
    }

    // skill-type mod ops may affect one or several skill types
    if (operation.type === 'add_skilltype_mod') {
      const skillTypes = Array.isArray(operation.skillType) ? operation.skillType : [operation.skillType]
      const value = formatSignedValue(evaluateFormula(operation.value, scope), '%')

      return skillTypes.map((st) =>
          withHighlight(
              getSkillTypeDisplay(st).label,
              formatModLabel(operation.mod),
              value,
          ),
      )
    }

    if (operation.type === 'add_negative_effect_mod') {
      const negativeEffects = Array.isArray(operation.negativeEffect)
          ? operation.negativeEffect
          : [operation.negativeEffect]
      const rawValue = evaluateFormula(operation.value, scope)
      const value = operation.mod === 'multiplier'
          ? formatSignedValue(rawValue * 100, '%')
          : formatSignedValue(rawValue, '%')
      const modLabel = operation.mod === 'multiplier'
          ? 'Multiplier'
          : formatModLabel(operation.mod)

      return negativeEffects.map((negativeEffect) =>
          withHighlight(
              formatNegativeEffectLabel(negativeEffect),
              modLabel,
              value,
          ),
      )
    }

    // skill-specific mod ops are matched against skill ids/types/tabs
    if (operation.type === 'add_skill_mod') {
      const labels = resolveMatchedSkillLabels(effect, operation)
      const value = formatSignedValue(evaluateFormula(operation.value, scope), '%')
      const modLabel = formatModLabel(operation.mod)

      if (labels.length === 0) {
        return withHighlight('Skill', modLabel, value)
      }

      return labels.map((label) => {
        const shouldTrimDmgSuffix =
            operation.mod === 'dmgBonus' ||
            operation.mod === 'amplify' ||
            operation.mod === 'dmgVuln'

        const cleanedLabel =
            shouldTrimDmgSuffix && /\sDMG$/i.test(label)
                ? label.replace(/\sDMG$/i, '')
                : label

        return withHighlight(cleanedLabel, modLabel, value)
      })
    }

    // direct multiplier addition for matched skills
    if (operation.type === 'add_skill_multiplier') {
      const labels = resolveMatchedSkillLabels(effect, operation)
      const added = formatSignedValue(evaluateFormula(operation.value, scope), '')

      if (labels.length === 0) {
        return withHighlight('', 'Skill Multiplier', added)
      }

      return labels.map((label) => {
        const cleanedLabel = /\sDMG$/i.test(label)
            ? label.replace(/\sDMG$/i, '')
            : label

        return withHighlight(cleanedLabel, 'DMG Multiplier', added)
      })
    }

    // multiplicative scaling for matched skills
    if (operation.type === 'scale_skill_multiplier') {
      const labels = resolveMatchedSkillLabels(effect, operation)
      const scale = `×${formatValue(evaluateFormula(operation.value, scope))}`

      if (labels.length === 0) {
        return withHighlight('', 'Skill Multiplier', scale)
      }

      return labels.map((label) => {
        const cleanedLabel = /\sDMG$/i.test(label)
            ? label.replace(/\sDMG$/i, '')
            : label

        return withHighlight(cleanedLabel, 'DMG Multiplier', scale)
      })
    }

    // scalar fields on matched skills like fixed damage, extra crit rate, etc.
    if (operation.type === 'add_skill_scalar') {
      const labels = resolveMatchedSkillLabels(effect, operation)
      const suffix = /CritRate|CritDmg|Bonus$/.test(operation.field) ? '%' : ''
      const value = formatSignedValue(evaluateFormula(operation.value, scope), suffix)
      const scalarLabel = formatSkillScalarLabel(operation.field)

      if (labels.length === 0) {
        return withHighlight('Skill', scalarLabel, value)
      }

      return labels.map((label) => {
        const cleanedLabel = /\sDMG$/i.test(label)
            ? label.replace(/\sDMG$/i, '')
            : label

        return withHighlight(cleanedLabel, scalarLabel, value)
      })
    }

    return []
  })
}

// determine whether an owner block is visible in the current runtime/effect context
function ownerIsVisible(owner: SourceOwnerDefinition, context: EffectRuntimeContext): boolean {
  const scope = buildEvalScope(context)

  if (!evaluateCondition(owner.unlockWhen, scope)) {
    return false
  }

  return evaluateCondition(owner.visibleWhen, scope)
}

// determine whether a source state should appear in the current summary context
function stateIsVisible(state: SourceStateDefinition, context: EffectRuntimeContext): boolean {
  const stateScope = buildSourceStateScope(
      context.sourceRuntime,
      context.targetRuntime,
      state,
      context.activeRuntime,
  )

  if (!evaluateCondition(state.visibleWhen, stateScope)) {
    return false
  }

  return evaluateCondition(state.enabledWhen, stateScope)
}

// build an effect runtime context for a specific source runtime relative to the active runtime
function buildContext(
    sourceRuntime: ResonatorRuntimeState,
    activeRuntime: ResonatorRuntimeState,
    runtimesById: Record<string, ResonatorRuntimeState>,
    selectedTargetsByOwnerKey: Record<string, string | null>,
    graph: CombatGraph | null,
    preparedContextsByResonatorId: Record<string, CombatContext> = {},
    enemyProfile = makeDefaultEnemyProfile(),
): EffectRuntimeContext {
  const preparedContext = preparedContextsByResonatorId[sourceRuntime.id] ?? null
  const teamMemberIds = Array.from(
      new Set([activeRuntime.id, ...activeRuntime.build.team.filter((memberId): memberId is string => Boolean(memberId))]),
  )
  const sourceSeed = preparedContext ? null : getResonatorSeedById(sourceRuntime.id)

  // try to reuse an existing graph participant if available
  const sourceParticipant =
      graph ? Object.values(graph.participants).find((participant) => participant.resonatorId === sourceRuntime.id) : null

  // otherwise build a transient graph so we can still resolve combat context for teammates
  const transientGraph = !sourceParticipant && sourceSeed
      ? buildTransientCombatGraph({
        activeRuntime,
        participantRuntimes: runtimesById,
        selectedTargetsByResonatorId: {
          [activeRuntime.id]: selectedTargetsByOwnerKey,
        },
      })
      : null
  const transientTargetSlotId =
      transientGraph ? findCombatParticipantSlotId(transientGraph, sourceRuntime.id) : null

  // resolve combat context from either the live graph or the transient fallback
  const combatContext = preparedContext
      ?? (sourceParticipant
          ? buildCombatContext({
            graph: graph!,
            targetSlotId: sourceParticipant.slotId,
            enemy: enemyProfile,
          })
          : transientGraph && transientTargetSlotId
              ? buildCombatContext({
                graph: transientGraph,
                targetSlotId: transientTargetSlotId,
                enemy: enemyProfile,
              })
              : null)

  return {
    source: {
      type: 'resonator',
      id: sourceRuntime.id,
    },
    sourceRuntime,
    sourceFinalStats: combatContext?.finalStats,
    targetRuntime: activeRuntime,
    activeRuntime,
    targetRuntimeId: activeRuntime.id,
    activeResonatorId: activeRuntime.id,
    teamMemberIds,
    team: buildTeamCompositionInfo(teamMemberIds),
    echoSetCounts: computeEchoSetCounts(sourceRuntime.build.echoes),
    selectedTargetsByOwnerKey,
    baseStats: combatContext?.baseStats,
    finalStats: combatContext?.finalStats,
    pool: combatContext?.buffs,
    enemy: combatContext?.enemy ?? enemyProfile,
  }
}

// dedupe repeated labels while preserving order
function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

// bucket nodes by scope so the overview ui can render grouped sections
function groupNodesByScope(nodes: OverviewStateSummaryNode[]): OverviewStateSummaryScopeGroup[] {
  const groups = new Map<string, OverviewStateSummaryScopeGroup>()

  for (const node of nodes) {
    const existing = groups.get(node.ownerScope)
    if (existing) {
      existing.nodes.push(node)
      continue
    }

    groups.set(node.ownerScope, {
      id: node.ownerScope,
      label: node.ownerScopeLabel,
      nodes: [node],
    })
  }

  return Array.from(groups.values()).sort((left, right) => left.label.localeCompare(right.label))
}

// build the full overview summary for the active resonator plus all relevant supporting sources
export function buildOverviewStateSummary(
    activeRuntime: ResonatorRuntimeState | null,
    runtimesById: Record<string, ResonatorRuntimeState>,
    graph: CombatGraph | null = null,
    selectedTargetsOverride: Record<string, string | null> | null = null,
    options: {
      contextsByResonatorId?: Record<string, CombatContext>
      enemyProfile?: ReturnType<typeof makeDefaultEnemyProfile>
    } = {},
): OverviewStateSummaryGroup[] {
  if (!activeRuntime) {
    return []
  }

  // use explicit target overrides when given, otherwise try to pull them from the active graph participant
  const activeParticipant = graph?.participants[graph.activeSlotId]
  const selectedTargetsByOwnerKey = selectedTargetsOverride
      ? { ...selectedTargetsOverride }
      : activeParticipant
          ? { ...activeParticipant.slot.routing.selectedTargetsByOwnerKey }
          : {}

  // include the active resonator and all non-empty teammates as sources
  const sourceIds = Array.from(
      new Set([activeRuntime.id, ...activeRuntime.build.team.filter((memberId): memberId is string => Boolean(memberId))]),
  )

  const groups = sourceIds.flatMap((sourceId) => {
    const sourceRuntime = runtimesById[sourceId] ?? (sourceId === activeRuntime.id ? activeRuntime : null)
    const sourceResonator = getResonatorSeedById(sourceId)

    if (!sourceRuntime || !sourceResonator) {
      return []
    }

    const context = buildContext(
        sourceRuntime,
        activeRuntime,
        runtimesById,
        selectedTargetsByOwnerKey,
        graph,
        options.contextsByResonatorId,
        options.enemyProfile,
    )
    const weaponId = sourceRuntime.build.weapon.id
    const mainEchoId = sourceRuntime.build.echoes[0]?.id ?? null
    const setIds = Array.from(
        new Set(
            sourceRuntime.build.echoes
                .filter((echo): echo is NonNullable<typeof echo> => Boolean(echo))
                .map((echo) => String(echo.set)),
        ),
    )

    // build source-specific contexts for weapon, main echo, and each set owner
    const weaponContext = !isUnsetWeaponId(weaponId)
        ? { ...context, source: { type: 'weapon' as const, id: weaponId } }
        : null
    const echoContext = mainEchoId
        ? { ...context, source: { type: 'echo' as const, id: mainEchoId } }
        : null
    const echoSetContexts = new Map(
        setIds.map((setId) => [
          setId,
          { ...context, source: { type: 'echoSet' as const, id: setId } },
        ]),
    )

    // collect all owners that can contribute visible states/effects
    const owners = [
      ...listOwnersForSource('resonator', sourceId),
      ...(!isUnsetWeaponId(weaponId) ? listOwnersForSource('weapon', weaponId) : []),
      ...(mainEchoId ? listOwnersForSource('echo', mainEchoId) : []),
      ...setIds.flatMap((setId) => listOwnersForSource('echoSet', setId)),
    ]

    const nodes = owners.flatMap((owner) => {
      const ownerContext =
          owner.source.type === 'weapon' && weaponContext
              ? weaponContext
              : owner.source.type === 'echo' && echoContext
                  ? echoContext
                  : owner.source.type === 'echoSet'
                      ? echoSetContexts.get(owner.source.id) ?? context
                      : context

      if (!ownerIsVisible(owner, ownerContext)) {
        return []
      }

      // collect visible + currently active states under this owner
      const states = listStatesForOwnerKey(owner.ownerKey)
          .filter((state) => stateIsVisible(state, ownerContext))
          .filter((state) => isStateActive(state, ownerContext.sourceRuntime))

      // collect effects that both target this runtime and pass their condition
      const effects = listEffectsForOwnerKey(owner.ownerKey)
          .filter((effect) => effectTargetsRuntime(effect, ownerContext))
          .filter((effect) => evaluateCondition(effect.condition, buildEvalScope(ownerContext)))

      const effectLabels = uniqueStrings(effects.flatMap((effect) => formatOperationLabels(effect, ownerContext)))
      if (states.length === 0 && effectLabels.length === 0) {
        return []
      }

      // echo set effects can be broken out by piece label (2pc / 5pc / 3pc)
      if (owner.source.type === 'echoSet' && effects.length > 0) {
        const effectLabelsByPiece = new Map<string, string[]>()

        for (const effect of effects) {
          const labels = uniqueStrings(formatOperationLabels(effect, ownerContext))
          if (labels.length === 0) {
            continue
          }

          const pieceLabel = formatEchoSetPieceLabel(owner, effect.id)
          const existing = effectLabelsByPiece.get(pieceLabel) ?? []
          effectLabelsByPiece.set(pieceLabel, uniqueStrings([...existing, ...labels]))
        }

        const effectNodes = Array.from(effectLabelsByPiece.entries()).map(([pieceLabel, labels]) => ({
          id: `${owner.ownerKey}:${pieceLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          ownerLabel: pieceLabel,
          ownerScope: formatOwnerScopeKey(owner),
          ownerScopeLabel: formatOwnerScopeLabel(owner),
          stateLabels: [],
          effectLabels: labels,
        } satisfies OverviewStateSummaryNode))

        if (effectNodes.length > 0) {
          return effectNodes
        }
      }

      // standard owner node combines active state labels plus effect labels
      return [
        {
          id: owner.ownerKey,
          ownerLabel: formatOwnerLabel(owner),
          ownerScope: formatOwnerScopeKey(owner),
          ownerScopeLabel: formatOwnerScopeLabel(owner),
          stateLabels: uniqueStrings(
              states
                  .map((state) => state.label)
                  .filter((label) => label !== owner.label),
          ),
          effectLabels,
        } satisfies OverviewStateSummaryNode,
      ]
    })

    if (nodes.length === 0) {
      return []
    }

    // one top-level group per source resonator
    return [
      {
        id: sourceRuntime.id,
        sourceId: sourceRuntime.id,
        sourceName: sourceResonator.name,
        sourceProfile: sourceResonator.profile ?? '',
        scopes: groupNodesByScope(nodes.sort((left, right) => left.ownerLabel.localeCompare(right.ownerLabel))),
      } satisfies OverviewStateSummaryGroup,
    ]
  })

  // keep the active resonator first, then sort teammates alphabetically
  return groups.sort((left, right) => {
    if (left.sourceId === activeRuntime.id && right.sourceId !== activeRuntime.id) {
      return -1
    }

    if (left.sourceId !== activeRuntime.id && right.sourceId === activeRuntime.id) {
      return 1
    }

    return left.sourceName.localeCompare(right.sourceName)
  })
}
