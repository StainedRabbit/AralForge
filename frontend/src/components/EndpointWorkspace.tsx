import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AuthedRequest, RouteData, RouteDataWithRefresh } from '../app/types'
import type { StudentProfile, User } from '../types'
import { createEmptyWorkspace } from '../queries/useScopedWorkspace'
import { queryKeys } from '../queries/queryKeys'
import { Page, SkeletonList, StatusBanner } from './ui'

export function EndpointWorkspace<T>({ api, currentUser, profile, path, map, children }: {
  api: AuthedRequest; currentUser: User; profile: StudentProfile | null; path: string
  map: (payload: T) => Partial<RouteData>
  children: (workspace: RouteDataWithRefresh) => ReactNode
}) {
  const query = useQuery({
    queryKey: queryKeys.resource(path),
    queryFn: ({ signal }) => api<T>(path, { signal }),
    staleTime: 60_000,
  })
  if (query.isPending) return <Page><SkeletonList count={4} /></Page>
  if (!query.data || query.error) return <Page><StatusBanner tone="warning" title="Data could not load" message="Retry this page request." /></Page>
  const workspace = Object.assign(createEmptyWorkspace(currentUser, profile), map(query.data), {
    refresh: async () => { await query.refetch() },
  })
  return children(workspace)
}
