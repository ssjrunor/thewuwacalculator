/*
  Author: Runor Ewhro
  Description: Provides targeted cloning helpers for runtime, profile,
               inventory-adjacent, and persisted state objects so hot paths
               can avoid full structuredClone calls.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import { cloneEchoLdt, cloneRotNds } from '@/domain/entities/inventoryStorage'
import type { ManualBuffs, MnlMod, QuickBuffs } from '@/domain/entities/manualBuffs'
import type { ResProf, SlotLocalState, SlotRatingState } from '@/domain/entities/profile'
import { cloneSntSet } from '@/domain/entities/sonataSetConditionals'
import type {
  CombatState,
  ResBaseStt,
  ResRuntime,
  ResSttStt,
  RotationState,
  SkillLevels,
  TeamMemRt,
  TraceNodeBuffs,
  WeaponState,
} from '@/domain/entities/runtime'
import type { AttributeKey, BaseStatBuff, ModBuff } from '@/domain/entities/stats'

function cloneBaseSta(buff: BaseStatBuff): BaseStatBuff {
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

export function cloneSkllLvl(skillLevels: SkillLevels): SkillLevels {
  return {
    normalAttack: skillLevels.normalAttack,
    resonanceSkill: skillLevels.resonanceSkill,
    forteCircuit: skillLevels.forteCircuit,
    resonanceLiberation: skillLevels.resonanceLiberation,
    introSkill: skillLevels.introSkill,
    tuneBreak: skillLevels.tuneBreak,
  }
}

export function cloneTrcNode(traceNodes: TraceNodeBuffs): TraceNodeBuffs {
  return {
    atk: cloneBaseSta(traceNodes.atk),
    hp: cloneBaseSta(traceNodes.hp),
    def: cloneBaseSta(traceNodes.def),
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

function cloneQckBffs(quick: QuickBuffs): QuickBuffs {
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

function cloneMnlMod(modifier: MnlMod): MnlMod {
  return { ...modifier }
}

export function cloneBuffs(manualBuffs: ManualBuffs): ManualBuffs {
  return {
    quick: cloneQckBffs(manualBuffs.quick),
    modifiers: manualBuffs.modifiers.map(cloneMnlMod),
  }
}

export function cloneCmbtStt(combat: CombatState): CombatState {
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

export function cloneWpnMkSt(weapon: WeaponState): WeaponState {
  return {
    id: weapon.id,
    level: weapon.level,
    rank: weapon.rank,
    baseAtk: weapon.baseAtk,
  }
}

export function cloneRotation(rotation: RotationState): RotationState {
  return {
    view: rotation.view,
    personalItems: cloneRotNds(rotation.personalItems),
    teamItems: cloneRotNds(rotation.teamItems),
  }
}

export function cloneSlotRtn(routing: SlotRatingState): SlotRatingState {
  return {
    selectedTargetsByOwnerKey: { ...routing.selectedTargetsByOwnerKey },
  }
}

export function cloneSlotLcl(local: SlotLocalState): SlotLocalState {
  return {
    controls: { ...local.controls },
    manualBuffs: cloneBuffs(local.manualBuffs),
    combat: cloneCmbtStt(local.combat),
    setConditionals: cloneSntSet(local.setConditionals),
  }
}

export function cloneRtSttVl(state: ResSttStt): ResSttStt {
  return {
    controls: { ...state.controls },
    manualBuffs: cloneBuffs(state.manualBuffs),
    combat: cloneCmbtStt(state.combat),
  }
}

export function cloneResBase(base: ResBaseStt): ResBaseStt {
  return {
    level: base.level,
    sequence: base.sequence,
    skillLevels: cloneSkllLvl(base.skillLevels),
    traceNodes: cloneTrcNode(base.traceNodes),
  }
}

export function cloneTeamMem(teamMember: TeamMemRt): TeamMemRt {
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
      echoes: cloneEchoLdt(teamMember.build.echoes),
    },
    manualBuffs: cloneBuffs(teamMember.manualBuffs),
  }
}

export function cloneTeamMvm(
    teamRuntimes: [TeamMemRt | null, TeamMemRt | null],
): [TeamMemRt | null, TeamMemRt | null] {
  return [
    teamRuntimes[0] ? cloneTeamMem(teamRuntimes[0]) : null,
    teamRuntimes[1] ? cloneTeamMem(teamRuntimes[1]) : null,
  ]
}

export function cloneResRtSt(runtime: ResRuntime): ResRuntime {
  return {
    id: runtime.id,
    base: cloneResBase(runtime.base),
    build: {
      weapon: cloneWpnMkSt(runtime.build.weapon),
      echoes: cloneEchoLdt(runtime.build.echoes),
      team: [...runtime.build.team],
    },
    state: cloneRtSttVl(runtime.state),
    rotation: cloneRotation(runtime.rotation),
    teamRuntimes: cloneTeamMvm(runtime.teamRuntimes),
  }
}

export function cloneResProf(profile: ResProf): ResProf {
  return {
    resonatorId: profile.resonatorId,
    runtime: {
      progression: cloneResBase(profile.runtime.progression),
      build: {
        weapon: cloneWpnMkSt(profile.runtime.build.weapon),
        echoes: cloneEchoLdt(profile.runtime.build.echoes),
      },
      local: cloneSlotLcl(profile.runtime.local),
      routing: cloneSlotRtn(profile.runtime.routing),
      team: [...profile.runtime.team],
      rotation: cloneRotation(profile.runtime.rotation),
      teamRuntimes: cloneTeamMvm(profile.runtime.teamRuntimes ?? [null, null]),
    },
  }
}

export function cloneEnemyPr(enemy: EnemyProfile): EnemyProfile {
  return {
    id: enemy.id,
    level: enemy.level,
    class: enemy.class,
    toa: enemy.toa,
    source: enemy.source,
    ...(enemy.status ? { status: { ...enemy.status } } : {}),
    res: { ...enemy.res },
  }
}
