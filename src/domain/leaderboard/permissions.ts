/*
  Author: Runor Ewhro
  description: leaderboard roles and permissions. an account has one role,
               each role grants a fixed set of permissions, and every staff route
               requires one permission by name. the service enforces it, and the
               app reads the same table to choose which tools to show.
*/

export const ROLES = ['user', 'moderator', 'admin'] as const
export type Role = (typeof ROLES)[number]

export type Permission =
  /** read the report queue and take, note and close reports. */
  | 'reports.review'
  /** hide or restore any build. */
  | 'builds.moderate'
  /** submit cards without a challenge, and block cards. */
  | 'cards.moderate'
  /** clear a player's or build's settings documents. */
  | 'documents.moderate'
  /** remove any comment. */
  | 'comments.moderate'
  /** approve or reject uploaded media. */
  | 'media.review'
  /** warn, suspend or ban a uid or an account, and lift it. */
  | 'sanctions.issue'
  /** read any subject's full history: its audit trail, reports and sanctions. */
  | 'history.read'
  /** read service health. */
  | 'health.read'
  /** publish, rescore and activate rulesets. */
  | 'rulesets.manage'
  /** give or take an account's role. */
  | 'roles.assign'
  /** what they upload or write goes out without waiting in a staff queue; reports on it still reach staff. */
  | 'review.exempt'

const MODERATOR: readonly Permission[] = ['reports.review', 'builds.moderate', 'cards.moderate', 'documents.moderate', 'comments.moderate', 'media.review',
  'sanctions.issue', 'history.read', 'health.read']

export const GRANTS: Readonly<Record<Role, readonly Permission[]>> = {
  user: [],
  moderator: MODERATOR,
  admin: [...MODERATOR, 'rulesets.manage', 'roles.assign', 'review.exempt'],
}

export const can = (role: Role, permission: Permission): boolean => GRANTS[role].includes(permission)
