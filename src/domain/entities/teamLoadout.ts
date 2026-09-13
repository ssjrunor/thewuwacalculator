/*
  Author: Runor Ewhro
  Description: Re-exports team loadout types from inventoryStorage for clarity.
*/

export type { TeamMemberBuild, TeamLoadoutSnap, InvTeamLoadout } from './inventoryStorage'
export {
  cloneTeamMemberBuild,
  cloneTeamLoadoutSnap,
  makeInvTeamLoadout,
  areTeamLoadoutSnapsEqual,
} from './inventoryStorage'
