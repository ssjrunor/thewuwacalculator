/*
  Author: Runor Ewhro
  Description: Prepares authored condition choices, feature metadata, and
               runtime-backed rotation editor options from the live calculator
               state.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import { makeSourceCat } from '@/domain/services/runtimeSourceService'
import { resolveSkill } from '@/engine/pipeline/resolveSkill'
import { getNegFfctCm, getNegFfctEn } from '@/domain/gameData/negativeEffects'
import { getSkillType } from '@/modules/calculator/model/skillTypes'
import {
  getStateTeamTag,
  getTeamTgtPt,
} from '@/modules/calculator/features/controls/lib/runtimeStateUtils'
import { getStateText } from '@/modules/calculator/model/sourceStateDisplay'
import {
  enemyChoices,
  getDjcnSkllI,
  getFeatVar,
  getPrvsSkllI,
  listRotMemSt,
} from '@/modules/calculator/features/rotation/lib/utils'
import { mkCondChc } from '@/modules/calculator/features/rotation/lib/conditions'
import { seedRsntById } from '@/modules/calculator/features/resonator/lib/seedData'
import type {
  CondChoice,
  FeatureMeta,
  RotMemEnt,
} from '@/modules/calculator/features/rotation/lib/types'

export function mkCurTeamMem(runtime: ResRuntime): string[] {
  return Array.from(
    new Set([runtime.id, ...runtime.build.team.filter((member): member is string => Boolean(member))]),
  )
}

export function mkVlblRotMmb(
  runtime: ResRuntime,
  runtimesById: Record<string, ResRuntime>,
): RotMemEnt[] {
  const ids = mkCurTeamMem(runtime)

  return ids
    .map((resonatorId) => {
      const seed = seedRsntById[resonatorId]
      const memRt = resonatorId === runtime.id ? runtime : runtimesById[resonatorId]
      if (!seed || !memRt) {
        return null
      }

      const catalog = makeSourceCat(memRt)

      return {
        id: seed.id,
        name: seed.name,
        profile: seed.profile,
        attribute: seed.attribute,
        runtime: memRt,
        skills: catalog.skills,
        features: catalog.features,
        states: listRotMemSt(memRt, runtime),
      }
    })
    .filter((entry): entry is RotMemEnt => Boolean(entry))
}

export function mkDtblRotMmb(
  visibleMember: RotMemEnt[],
  runtimeId: string,
  view: ResRuntime['rotation']['view'],
): RotMemEnt[] {
  if (view === 'team') {
    return visibleMember
  }

  const activeMember = visibleMember.find((member) => member.id === runtimeId)
  return activeMember ? [activeMember] : []
}

export function mkRotFeatMet(
  visibleMember: RotMemEnt[],
): Record<string, FeatureMeta> {
  const lookup: Record<string, FeatureMeta> = {}

  for (const member of visibleMember) {
    for (const feature of member.features) {
      const skill = member.skills.find((entry) => entry.id === feature.skillId)
      const skillResult = skill ? resolveSkill(member.runtime, skill) : null
      const negFfctCmbtK = getNegFfctCm(skillResult?.archetype)
      const fixedStacks = negFfctCmbtK
        ? getNegFfctEn(member.runtime, negFfctCmbtK)?.stackMode === 'fixedMax'
        : false

      lookup[feature.id] = {
        label: skillResult?.tab === 'negativeEffect' ? skillResult.label : feature.label,
        skillId: feature.skillId,
        tab: skillResult?.tab ?? skill?.tab ?? 'feature',
        archetype: skillResult?.archetype ?? skill?.archetype,
        section: skillResult?.sectionTitle ?? skill?.sectionTitle,
        skillTypeLabel: getSkillType(skillResult?.skillType?.[0] ?? skill?.skillType?.[0]).label,
        element: skillResult?.element ?? skill?.element ?? member.attribute,
        ggrgType: skillResult?.aggregationType ?? skill?.aggregationType ?? 'damage',
        resonatorId: member.id,
        resName: member.name,
        variant: getFeatVar(feature),
        hitIndex: typeof feature.hitIndex === 'number' ? feature.hitIndex : undefined,
        fixedStacks,
      }
    }
  }

  return lookup
}

function mkSkllLnkdFe(
  visibleMember: RotMemEnt[],
  resLnkdSkllI: (skillId: string | undefined) => string | null | undefined,
): Record<string, string | undefined> {
  const lookup: Record<string, string | undefined> = {}

  for (const member of visibleMember) {
    const prmrFeatBySk = new Map<string, string>()

    for (const feature of member.features) {
      if (feature.variant === 'subHit' || !feature.skillId) {
        continue
      }

      if (!prmrFeatBySk.has(feature.skillId)) {
        prmrFeatBySk.set(feature.skillId, feature.id)
      }
    }

    for (const feature of member.features) {
      const lnkdSkllId = resLnkdSkllI(feature.skillId)
      lookup[feature.id] = lnkdSkllId ? prmrFeatBySk.get(lnkdSkllId) : undefined
    }
  }

  return lookup
}

export function mkDjcnFeatBy(
  visibleMember: RotMemEnt[],
): Record<string, string | undefined> {
  return mkSkllLnkdFe(visibleMember, getDjcnSkllI)
}

export function mkPrvsFeatBy(
  visibleMember: RotMemEnt[],
): Record<string, string | undefined> {
  return mkSkllLnkdFe(visibleMember, getPrvsSkllI)
}

export function mkRotCondChc(
  visibleMember: RotMemEnt[],
  runtime: ResRuntime,
  enemyId?: string,
): CondChoice[] {
  const memChcs = visibleMember.flatMap((member) => {
    const stateChoices = member.states.map((state) => mkCondChc(member, state))

    const tgtChcs = member.states.flatMap((state) => {
      const targetMode = getStateTeamTag(state)
      if (!targetMode) {
        return []
      }

      const options = getTeamTgtPt(runtime, member.id, targetMode)
      if (options.length === 0) {
        return []
      }

      const display = getStateText(state)

      return [mkCondChc(
        member,
        {
          id: `${state.id}:target`,
          label: `${display.label} Target`,
          source: state.source,
          ownerKey: state.ownerKey,
          controlKey: `${state.controlKey}:target`,
          path: `runtime.routing.selectedTargetsByOwnerKey.${state.ownerKey}`,
          kind: 'select' as const,
          options: options.map((option) => ({
            id: option.value,
            label: option.label,
          })),
          defaultValue: options[0]?.value ?? '',
          description:
            targetMode === 'activeOther'
              ? 'Select which other teammate receives this buff during the rotation.'
              : 'Select which team member receives this active-targeted buff during the rotation.',
        },
        {
          id: `${member.id}:${state.controlKey}:target`,
          label: `${display.label} Target`,
          description:
            targetMode === 'activeOther'
              ? 'Select which other teammate receives this buff during the rotation.'
              : 'Select which team member receives this active-targeted buff during the rotation.',
        },
      )]
    })

    return [...stateChoices, ...tgtChcs]
  })

  return [...memChcs, ...enemyChoices(runtime, enemyId)]
}
