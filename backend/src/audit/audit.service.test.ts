import { describe, expect, it, vi } from 'vitest'
import type { Database } from '../database/client'
import { AUDIT_ACTIONS } from './actions'
import { AuditService, SYSTEM_ACTOR } from './audit.service'

const entry = {
  organizationId: '01a01a00-0000-7000-8000-000000000001',
  actor: { userId: '01a01a00-0000-7000-8000-000000000002', label: 'Founder' },
  action: AUDIT_ACTIONS.invoicePaid,
  resourceType: 'invoice',
  resourceId: 'inv-1',
}

describe('AuditService.record', () => {
  const dbWith = (values: unknown) =>
    ({ insert: vi.fn().mockReturnValue({ values }) }) as unknown as Database

  it('writes what it was given', async () => {
    const values = vi.fn().mockResolvedValue(undefined)

    await new AuditService(dbWith(values)).record(entry)

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invoice.paid',
        resourceType: 'invoice',
        resourceId: 'inv-1',
        actorLabel: 'Founder',
      }),
    )
  })

  it('records automation as the system actor', async () => {
    const values = vi.fn().mockResolvedValue(undefined)

    await new AuditService(dbWith(values)).record({
      ...entry,
      actor: { userId: null, label: SYSTEM_ACTOR },
      action: AUDIT_ACTIONS.workflowRun,
    })

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: null, actorLabel: 'system' }),
    )
  })

  /** Redacted centrally, so a call site cannot forget. */
  it('redacts sensitive values whatever the caller passed', async () => {
    const values = vi.fn().mockResolvedValue(undefined)

    await new AuditService(dbWith(values)).record({
      ...entry,
      changes: { name: 'Acme', passwordHash: '$argon2id$real', apiKey: 'sk-secret' },
    })

    const written = values.mock.calls[0]![0] as { changes: Record<string, unknown> }
    expect(written.changes).toEqual({
      name: 'Acme',
      passwordHash: '[redacted]',
      apiKey: '[redacted]',
    })
  })

  /**
   * An audit write that fails a payment is worse than a missing entry: the
   * money moved either way.
   */
  it('does not throw when the database is unavailable', async () => {
    const failing = dbWith(vi.fn().mockRejectedValue(new Error('database is down')))

    await expect(new AuditService(failing).record(entry)).resolves.toBeUndefined()
  })

  it('does not throw when the insert blows up synchronously', async () => {
    const broken = {
      insert: vi.fn().mockImplementation(() => {
        throw new Error('pool exhausted')
      }),
    } as unknown as Database

    await expect(new AuditService(broken).record(entry)).resolves.toBeUndefined()
  })

  it('stores no changes when there are none', async () => {
    const values = vi.fn().mockResolvedValue(undefined)

    await new AuditService(dbWith(values)).record(entry)

    expect((values.mock.calls[0]![0] as { changes: unknown }).changes).toBeNull()
  })
})
