import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { SessionGuard } from '../auth/session.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { CurrentOrg, RequirePermission, type OrgContext } from '../orgs/current-org.decorator'
import { OrgGuard } from '../orgs/org.guard'
import { AuditService, type AuditQuery } from './audit.service'

const auditQuerySchema = z.object({
  action: z.string().max(64).optional(),
  resourceType: z.string().max(64).optional(),
  actorId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

/**
 * Organization-scoped, matching the table: signing in and changing a role
 * happen outside any workspace. Admin and above only — the log says who
 * removed whom.
 */
@Controller('orgs/:orgId/audit')
@UseGuards(SessionGuard, OrgGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit:read')
  list(
    @CurrentOrg() org: OrgContext,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ) {
    return this.audit.list(org.organization.id, query)
  }
}
