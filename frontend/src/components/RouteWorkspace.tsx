import type { ReactNode } from 'react'
import type { AuthedRequest, RouteDataWithRefresh } from '../app/types'
import type { StudentProfile, User } from '../types'
import { useScopedWorkspace, type WorkspaceResource } from '../queries/useScopedWorkspace'
import { Page, SkeletonList, StatusBanner } from './ui'

export function RouteWorkspace({ api, currentUser, profile, resources, children }: {
  api: AuthedRequest
  currentUser: User
  profile: StudentProfile | null
  resources: readonly WorkspaceResource[]
  children: (workspace: RouteDataWithRefresh) => ReactNode
}) {
  const workspace = useScopedWorkspace(api, resources, currentUser, profile)
  if (workspace.loading) return <Page><SkeletonList count={4} /></Page>
  if (workspace.error) return <Page><StatusBanner tone="warning" title="Data could not load" message={workspace.error} /></Page>
  return children(workspace)
}
