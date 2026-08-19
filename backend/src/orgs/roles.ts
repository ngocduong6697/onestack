export const ROLES = ['member', 'admin', 'owner'] as const

export type Role = (typeof ROLES)[number]

/**
 * Ranked so a check reads as "admin or above" rather than as a list of roles
 * somebody has to remember to extend when a new one appears.
 */
const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 }

export function satisfies(held: Role, required: Role): boolean {
  return RANK[held] >= RANK[required]
}
