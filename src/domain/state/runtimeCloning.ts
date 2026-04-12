/*
  Author: Runor Ewhro
  Description: Provides targeted cloning helpers for runtime, profile,
               inventory-adjacent, and persisted state objects so hot paths
               can avoid full structuredClone calls.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import { cloneEchoLoadout, cloneRotationNodes } from '@/domain/entities/inventoryStorage'
import type { ManualBuffs, ManualModifier, ManualQuickBuffs } from '@/domain/entities/manualBuffs'
import type { ResonatorProfile, SlotLocalState, SlotRoutingState } from '@/domain/entities/profile'
import { cloneCompactSonataSetConditionals } from '@/domain/entities/sonataSetConditionals'
import type {
  CombatState,
  ResonatorBaseState,
  ResonatorRuntimeState,
  ResonatorStateState,
  RotationState,
  SkillLevels,
  TeamMemberRuntime,
  TraceNodeBuffs,
  WeaponBuildState,
} from '@/domain/entities/runtime'
import type { AttributeKey, BaseStatBuff, ModBuff } from '@/domain/entities/stats'

function cloneBaseStatBuff(buff: BaseStatBuff): BaseStatBuff {
  return {
    percent: buff.percent,
    flat: buff.flat,
  }
}

function cloneModBuff(buff: ModBuff): ModBuff {
  return {
    resShred: buff.resShred,
    dmgBonus: buff.dmgBonus,
    amplify: buff.amplify,
    defIgnore: buff.defIgnore,
    defShred: buff.defShred,
    dmgVuln: buff.dmgVuln,
    critRate: buff.critRate,
    critDmg: buff.critDmg,
  }
}

export function cloneSkillLevels(skillLevels: SkillLevels): SkillLevels {
  return {
    normalAttack: skillLevels.normalAttack,
    resonanceSkill: skillLevels.resonanceSkill,
    forteCircuit: skillLevels.forteCircuit,
    resonanceLiberation: skillLevels.resonanceLiberation,
    introSkill: skillLevels.introSkill,
    tuneBreak: skillLevels.tuneBreak,
  }
}

export function cloneTraceNodeBuffs(traceNodes: TraceNodeBuffs): TraceNodeBuffs {
  return {
    atk: cloneBaseStatBuff(traceNodes.atk),
    hp: cloneBaseStatBuff(traceNodes.hp),
    def: cloneBaseStatBuff(traceNodes.def),
    attribute: Object.fromEntries(
        Object.entries(traceNodes.attribute).map(([attribute, buff]) => [
          attribute,
          cloneModBuff(buff),
        ]),
    ) as Record<AttributeKey, ModBuff>,
    critRate: traceNodes.critRate,
    critDmg: traceNodes.critDmg,
    healingBonus: traceNodes.healingBonus,
    activeNodes: { ...traceNodes.activeNodes },
  }
}

function cloneQuickBuffs(quick: ManualQuickBuffs): ManualQuickBuffs {
  return {
    atk: { ...quick.atk },
    hp: { ...quick.hp },
    def: { ...quick.def },
    critRate: quick.critRate,
    critDmg: quick.critDmg,
    energyRegen: quick.energyRegen,
    healingBonus: quick.healingBonus,
  }
}

function cloneManualModifier(modifier: ManualModifier): ManualModifier {
  return { ...modifier }
}

export function cloneManualBuffs(manualBuffs: ManualBuffs): ManualBuffs {
  return {
    quick: cloneQuickBuffs(manualBuffs.quick),
    modifiers: manualBuffs.modifiers.map(cloneManualModifier),
  }
}

export function cloneCombatState(combat: CombatState): CombatState {
  return {
    spectroFrazzle: combat.spectroFrazzle,
    aeroErosion: combat.aeroErosion,
    fusionBurst: combat.fusionBurst,
    havocBane: combat.havocBane,
    glacioChafe: combat.glacioChafe,
    electroFlare: combat.electroFlare,
    electroRage: combat.electroRage,
  }
}

export function cloneWeaponBuildState(weapon: WeaponBuildState): WeaponBuildState {
  return {
    id: weapon.id,
    level: weapon.level,
    rank: weapon.rank,
    baseAtk: weapon.baseAtk,
  }
}

export function cloneRotationState(rotation: RotationState): RotationState {
  return {
    view: rotation.view,
    personalItems: cloneRotationNodes(rotation.personalItems),
    teamItems: cloneRotationNodes(rotation.teamItems),
  }
}

export function cloneSlotRoutingStateValue(routing: SlotRoutingState): SlotRoutingState {
  return {
    selectedTargetsByOwnerKey: { ...routing.selectedTargetsByOwnerKey },
  }
}

export function cloneSlotLocalStateValue(local: SlotLocalState): SlotLocalState {
  return {
    controls: { ...local.controls },
    manualBuffs: cloneManualBuffs(local.manualBuffs),
    combat: cloneCombatState(local.combat),
    setConditionals: cloneCompactSonataSetConditionals(local.setConditionals),
  }
}

export function cloneRuntimeStateValue(state: ResonatorStateState): ResonatorStateState {
  return {
    controls: { ...state.controls },
    manualBuffs: cloneManualBuffs(state.manualBuffs),
    combat: cloneCombatState(state.combat),
  }
}

export function cloneResonatorBaseState(base: ResonatorBaseState): ResonatorBaseState {
  return {
    level: base.level,
    sequence: base.sequence,
    skillLevels: cloneSkillLevels(base.skillLevels),
    traceNodes: cloneTraceNodeBuffs(base.traceNodes),
  }
}

export function cloneTeamMemberRuntime(teamMember: TeamMemberRuntime): TeamMemberRuntime {
  return {
    id: teamMember.id,
    base: {
      sequence: teamMember.base.sequence,
    },
    build: {
      weapon: {
        id: teamMember.build.weapon.id,
        rank: teamMember.build.weapon.rank,
        baseAtk: teamMember.build.weapon.baseAtk,
      },
      echoes: cloneEchoLoadout(teamMember.build.echoes),
    },
    manualBuffs: cloneManualBuffs(teamMember.manualBuffs),
  }
}

export function cloneTeamMemberRuntimes(
    teamRuntimes: [TeamMemberRuntime | null, TeamMemberRuntime | null],
): [TeamMemberRuntime | null, TeamMemberRuntime | null] {
  return [
    teamRuntimes[0] ? cloneTeamMemberRuntime(teamRuntimes[0]) : null,
    teamRuntimes[1] ? cloneTeamMemberRuntime(teamRuntimes[1]) : null,
  ]
}

export function cloneResonatorRuntimeState(runtime: ResonatorRuntimeState): ResonatorRuntimeState {
  return {
    id: runtime.id,
    base: cloneResonatorBaseState(runtime.base),
    build: {
      weapon: cloneWeaponBuildState(runtime.build.weapon),
      echoes: cloneEchoLoadout(runtime.build.echoes),
      team: [...runtime.build.team],
    },
    state: cloneRuntimeStateValue(runtime.state),
    rotation: cloneRotationState(runtime.rotation),
    teamRuntimes: cloneTeamMemberRuntimes(runtime.teamRuntimes),
  }
}

export function cloneResonatorProfile(profile: ResonatorProfile): ResonatorProfile {
  return {
    resonatorId: profile.resonatorId,
    runtime: {
      progression: cloneResonatorBaseState(profile.runtime.progression),
      build: {
        weapon: cloneWeaponBuildState(profile.runtime.build.weapon),
        echoes: cloneEchoLoadout(profile.runtime.build.echoes),
      },
      local: cloneSlotLocalStateValue(profile.runtime.local),
      routing: cloneSlotRoutingStateValue(profile.runtime.routing),
      team: [...profile.runtime.team],
      rotation: cloneRotationState(profile.runtime.rotation),
      teamRuntimes: cloneTeamMemberRuntimes(profile.runtime.teamRuntimes ?? [null, null]),
    },
  }
}

export function cloneEnemyProfile(enemy: EnemyProfile): EnemyProfile {
  return {
    id: enemy.id,
    level: enemy.level,
    class: enemy.class,
    toa: enemy.toa,
    source: enemy.source,
    ...(enemy.status ? { status: { tuneStrain: enemy.status.tuneStrain } } : {}),
    res: { ...enemy.res },
  }
}
