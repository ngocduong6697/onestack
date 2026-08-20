import type { Role } from './roles'

/**
 * The catalogue. Routes ask for one of these rather than for a rank, so adding
 * a role later is one edit here instead of an audit of every controller.
 */
export const PERMISSIONS = [
  'org:read',
  'org:update',
  'workspace:read',
  'workspace:write',
  'member:read',
  'member:update',
  'member:remove',
  'invite:read',
  'invite:create',
  'invite:revoke',
  'customer:read',
  'customer:write',
  'product:read',
  'product:write',
  'subscription:read',
  'subscription:write',
  'ai:read',
  'ai:invoke',
  'workflow:read',
  'workflow:write',
  'workflow:run',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const MEMBER: Permission[] = [
  'org:read',
  'workspace:read',
  'member:read',
  'customer:read',
  'product:read',
  'subscription:read',
  'ai:read',
  'workflow:read',
]

const ADMIN: Permission[] = [
  ...MEMBER,
  'org:update',
  'workspace:write',
  'member:update',
  'member:remove',
  'invite:read',
  'invite:create',
  'invite:revoke',
  'customer:write',
  'product:write',
  'subscription:write',
  'ai:invoke',
  'workflow:write',
  'workflow:run',
]

/**
 * Owner holds everything an admin does. The difference between them is not in
 * this map — it is that an admin may not touch an owner, which is an invariant
 * about the target of an action rather than about the actor, and lives in the
 * service.
 */
const GRANTS: Record<Role, readonly Permission[]> = {
  member: MEMBER,
  admin: ADMIN,
  owner: ADMIN,
}

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].includes(permission)
}

export function permissionsFor(role: Role): readonly Permission[] {
  return GRANTS[role]
}
