/**
 * Every audited action, in one file.
 *
 * Rule 7 says "important", and important is a judgement — so the list is
 * explicit and reviewable rather than derived from whatever happens to write
 * to the database. You can read this and say whether something is missing,
 * which you cannot do with an interceptor.
 */
export const AUDIT_ACTIONS = {
  // Identity
  authRegistered: 'auth.registered',
  authLogin: 'auth.login',
  authLogout: 'auth.logout',
  authPasswordChanged: 'auth.password_changed',

  // Who is in the organization, and as what
  memberRoleChanged: 'member.role_changed',
  memberRemoved: 'member.removed',
  inviteCreated: 'invite.created',
  inviteAccepted: 'invite.accepted',
  inviteRevoked: 'invite.revoked',

  // Things that disappear
  customerDeleted: 'customer.deleted',
  productDeleted: 'product.deleted',
  productArchived: 'product.archived',
  priceArchived: 'price.archived',
  workspaceDeleted: 'workspace.deleted',
  workflowDeleted: 'workflow.deleted',

  // Money
  invoiceIssued: 'invoice.issued',
  invoicePaid: 'invoice.paid',
  invoiceVoided: 'invoice.voided',
  subscriptionCanceled: 'subscription.canceled',
  ledgerEntryDeleted: 'ledger.entry_deleted',

  // Things that run on their own
  workflowRun: 'workflow.run',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]

export const ALL_AUDIT_ACTIONS: AuditAction[] = Object.values(AUDIT_ACTIONS)
