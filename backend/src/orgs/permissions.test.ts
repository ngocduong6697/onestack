import { describe, expect, it } from 'vitest'
import { can, permissionsFor, PERMISSIONS, type Permission } from './permissions'
import { ROLES } from './roles'

describe('permission map', () => {
  it('gives a member read access and nothing that writes', () => {
    expect(permissionsFor('member')).toEqual(['org:read', 'workspace:read', 'member:read'])

    for (const permission of ['org:update', 'member:remove', 'invite:create'] as Permission[]) {
      expect(can('member', permission)).toBe(false)
    }
  })

  it('gives an admin everything except what only an owner may do to an owner', () => {
    for (const permission of [
      'org:update',
      'workspace:write',
      'member:update',
      'member:remove',
      'invite:create',
      'invite:revoke',
    ] as Permission[]) {
      expect(can('admin', permission)).toBe(true)
    }
  })

  /**
   * Owner and admin hold the same permissions on purpose. What separates them
   * is who they may act on, which is an invariant in the service, not a grant.
   */
  it('gives an owner at least everything an admin has', () => {
    for (const permission of permissionsFor('admin')) {
      expect(can('owner', permission)).toBe(true)
    }
  })

  it('grants nothing outside the catalogue', () => {
    for (const role of ROLES) {
      for (const permission of permissionsFor(role)) {
        expect(PERMISSIONS).toContain(permission)
      }
    }
  })

  it('has no role with an empty grant, which would be a role nobody can use', () => {
    for (const role of ROLES) {
      expect(permissionsFor(role).length).toBeGreaterThan(0)
    }
  })
})
