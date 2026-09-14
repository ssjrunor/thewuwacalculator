/*
  Author: Runor Ewhro
  Description: The visible Home, Simulation, and Read information architecture.
*/

import { APP_NAVIGATION } from '@/shared/lib/appRoutes'
import type { SimulationRoute } from '@/shared/lib/appRoutes'

export type SimulationPageId = SimulationRoute

export interface SimulationPage {
  id: SimulationPageId
  name: string
  scope: string
  to: string
  art: string
  says: string
}

export const SIMULATION_PAGES: SimulationPage[] = [
  {
    id: 'modulation',
    ...APP_NAVIGATION.modulation,
    scope: 'one build',
    art: '/assets/home/sc-catalog.webp',
    says: 'Should i pull S2 or just save?? is R5 on the 4 star Arbiter\'s Back Scrubber Pro Max (ABSPM) actually fine??" No, that weapon is yet to exist, but you can check other weapons out!',
  },
  {
    id: 'rotation',
    ...APP_NAVIGATION.rotation,
    scope: 'one sequence',
    art: '/assets/home/sc-rotation.webp',
    says: 'Using the power of node types, trees and other computer terms you probably don\'t care about, you can create a pretty super realistic rotation scenario and even compare it against others! The UI for it rocks, i promise.',
  },
  {
    id: 'showcase',
    ...APP_NAVIGATION.showcase,
    scope: 'one build',
    art: '/assets/home/sc-showcase.webp',
    says: 'Is your build terrible? atrocious even? Yes, it absolutely is but... at least you can make it look prettier..? (˶>⩊<˶)',
  },
  {
    id: 'suggestions',
    ...APP_NAVIGATION.suggestions,
    scope: 'one change',
    art: '/assets/home/sc-optimizer.webp',
    says: 'What is the single next thing worth doing to this build? Main stats, sonata sets and weapons each get asked separately, because each one is measured its own way.',
  },
  {
    id: 'optimizer',
    ...APP_NAVIGATION.optimizer,
    scope: 'every build',
    art: '/assets/home/sc-optimizer.webp',
    says: 'Erm is this piece with double crit better than my other piece with no crit at all?" Well.. yeah, probably (shocker) but you can\'t be too sure right??',
  },
]

export interface ReadPage {
  name: string
  to: string
  external?: boolean
}

export const READ_PAGES: ReadPage[] = [
  APP_NAVIGATION.docs,
  APP_NAVIGATION.guides,
  APP_NAVIGATION.changelog,
  APP_NAVIGATION.calibration,
]

export interface AppLink {
  name: string
  to: string
}

export const LINKS: AppLink[] = [
  { name: 'Discord', to: 'https://discord.gg/wNaauhE4uH' },
  { name: 'Ko-fi', to: 'https://ko-fi.com/ssjrunor' },
]

export const REST_ART = '/assets/home/sc-overview.webp'

export interface ArtCredit {
  subject: string
  artist: string
}

export const ART_CREDITS: Record<string, ArtCredit> = {
  '/assets/home/sc-showcase.webp': { subject: 'Qingxiao', artist: 'r1zen' },
  '/assets/home/sc-rotation.webp': { subject: 'Hiyuki', artist: '鱼鹅BABA' },
  '/assets/home/cs-4.webp': { subject: 'Quiyuan', artist: 'kuro Games' },
  '/assets/home/sc-optimizer.webp': { subject: 'Chisa and Namipon', artist: 'lxc' },
  '/assets/home/cs-3.webp': { subject: 'Hsin', artist: 'ruoganzhao' },
  '/assets/home/cs-2.webp': { subject: 'Phoebe', artist: 'Kuro Games' },
  '/assets/home/sc-catalog.webp': { subject: 'Denia', artist: 'HYONEE' },
  '/assets/home/cs-1.webp': { subject: 'Cartethyia', artist: 'riko-m' },
}

export function creditFor(art: string): ArtCredit | null {
  return ART_CREDITS[art] ?? null
}
