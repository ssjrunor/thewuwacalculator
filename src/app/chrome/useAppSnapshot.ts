/*
  Author: Runor Ewhro
  Description: Reads what the app currently holds, so the index can report your
               own state rather than describe itself. Everything here is a
               direct read off the store or the catalog: no simulation is run
               and no figure is invented, so the entry screen costs nothing to
               show and is never out of date.
*/

import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/domain/state/store'
import { selScenarioProfiles } from '@/domain/state/selectors'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { mkActTeamSlt } from '@/domain/state/runtimeAdapters'
import { getResonator } from '@/modules/simulation/features/resonator/lib/resonator'
import type { SimulationPageId } from '@/app/chrome/appIndex'

export interface AppSnapshot {
  // who is set up right now
  active: { name: string, level: number, sequence: number } | null
  team: string[]
  equipped: number
  echoes: number
  builds: number
  takes: number
  // what each surface has to work with right now, as a labelled measurement.
  // null until the inventory has been read off disk, because a count we do not
  // have yet must not be reported as zero
  reading: Record<SimulationPageId, { label: string, value: string } | null>
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function useAppSnapshot(): AppSnapshot {
  const scenario = useAppStore((state) => selectedCombatScenario(state.combat))
  const profiles = useAppStore(selScenarioProfiles)
  const invHydrated = useAppStore((state) => state.invHydr)
  const ensureInventory = useAppStore((state) => state.ensInvHydr)
  const activeId = scenario.team.members[0]?.resonatorId ?? null
  const echoes = useAppStore((state) => state.library.echoes.length)
  const builds = useAppStore((state) => state.library.builds.length)
  const takes = useAppStore((state) => state.library.rotations.length)
  // showcase cards are a preference, held per resonator on the holding profile
  const cards = useAppStore(
      (state) => Object.keys(state.ui.preferences.showcaseCards ?? {}).length,
  )

  // the inventory is the one slice the app loads on demand; ask for it after
  // first paint so the index is up immediately and the counts land behind it
  useEffect(() => {
    if (invHydrated) return
    const idle = window.setTimeout(ensureInventory, 0)
    return () => window.clearTimeout(idle)
  }, [ensureInventory, invHydrated])

  return useMemo(() => {
    const profile = activeId ? profiles[activeId] : null
    const seed = activeId ? getResonator(activeId) : null

    const active = profile && seed
      ? {
          name: seed.name,
          level: profile.runtime.progression.level,
          sequence: profile.runtime.progression.sequence,
        }
      : null

    // the team is the two seats beside the active resonator, named the way the
    // app names them elsewhere
    const team = mkActTeamSlt(scenario)
      .slice(1)
      .map((id) => (id ? getResonator(id)?.name : null))
      .filter((name): name is string => Boolean(name))

    const equipped = (profile?.runtime.build.echoes ?? []).filter(Boolean).length

    return {
      active,
      team,
      equipped,
      echoes,
      builds,
      takes,
      reading: {
        rotation: invHydrated
          ? { label: 'try it now!', value: takes > 0 ? plural(takes, 'take') : 'no takes yet' }
          : null,
        modulation: {
          label: 'tune it now!',
          value: active ? `Lv ${active.level} · S${active.sequence} · ${equipped}/5 echoes` : 'nobody yet',
        },
        showcase: {
          label: 'show it now!',
          value: cards > 0 ? plural(cards, 'card') : 'no cards yet',
        },
        optimizer: invHydrated
          ? { label: 'find out now!', value: echoes > 0 ? `${echoes} echoes` : 'no echoes yet' }
          : null,
        suggestions: {
          label: 'ask it now!',
          value: active ? `${equipped}/5 echoes on ${active.name}` : 'nobody yet',
        },
      },
    }
  }, [activeId, builds, cards, echoes, invHydrated, profiles, scenario, takes])
}
