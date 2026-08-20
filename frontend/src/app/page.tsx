import type { AnalyticsSummary, MembershipSummary, Workspace } from '@onestack/shared'
import { redirect } from 'next/navigation'
import { apiGet } from '@/lib/api'
import { DashboardView } from './dashboard-view'
import { SignOut } from './sign-out'

// Per-session figures. Caching this would show one person another's numbers.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const orgs = await apiGet<MembershipSummary[]>('/orgs')

  // The middleware only checks the cookie exists; an expired one gets here.
  if (orgs.status === 401) redirect('/login')

  const organization = orgs.data?.[0]

  if (!organization) {
    return <Empty message="This account does not belong to an organization yet." />
  }

  const workspaces = await apiGet<Workspace[]>(`/orgs/${organization.id}/workspaces`)
  const workspace = workspaces.data?.[0]

  if (!workspace) {
    return <Empty message="This organization has no workspace yet." />
  }

  const summary = await apiGet<AnalyticsSummary>(
    `/orgs/${organization.id}/workspaces/${workspace.id}/analytics/summary`,
  )

  if (!summary.data) {
    return <Empty message={summary.error ?? 'The numbers could not be loaded.'} />
  }

  return (
    <DashboardView
      organizationName={organization.name}
      workspaceName={workspace.name}
      role={organization.role}
      metrics={summary.data}
    />
  )
}

function Empty({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">OneStack</h1>
      <p className="text-sm text-muted">{message}</p>
      <SignOut />
    </main>
  )
}
