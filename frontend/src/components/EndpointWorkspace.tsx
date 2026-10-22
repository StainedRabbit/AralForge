import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AuthedRequest, RouteData, RouteDataWithRefresh } from '../app/types'
import type { StudentProfile, User } from '../types'
import { createEmptyWorkspace } from '../queries/useScopedWorkspace'
import { queryKeys } from '../queries/queryKeys'
import { HOUR_MS, LIVE_STALE_MS } from '../queries/persistentCache'
import { Page, SkeletonList, StatusBanner } from './ui'

export function EndpointWorkspace<T>({ api, currentUser, profile, path, map, children }: {
  api: AuthedRequest; currentUser: User; profile: StudentProfile | null; path: string
  map: (payload: T) => Partial<RouteData>
  children: (workspace: RouteDataWithRefresh) => ReactNode
}) {
  const query = useQuery({
    queryKey: queryKeys.resource(path),
    queryFn: ({ signal }) => api<T>(path, { signal }),
    staleTime: path.startsWith('/grades/') ? LIVE_STALE_MS : HOUR_MS,
  })
  if (query.isPending) return <Page><SkeletonList count={4} /></Page>
  if (!query.data || query.error) return <Page><StatusBanner tone="warning" title="Data could not load" message="Retry this page request." /></Page>
  const workspace = Object.assign(createEmptyWorkspace(currentUser, profile), map(query.data), {
    refresh: async () => { await query.refetch() },
  })
  return children(workspace)
}

export function SplitEndpointWorkspace<TContent, TState>({
  api, currentUser, profile, contentPath, statePath, map, children,
}: {
  api: AuthedRequest
  currentUser: User
  profile: StudentProfile | null
  contentPath: string
  statePath: string
  map: (content: TContent, state: TState) => Partial<RouteData>
  children: (workspace: RouteDataWithRefresh) => ReactNode
}) {
  const content = useQuery({
    queryKey: queryKeys.resource(contentPath),
    queryFn: ({ signal }) => api<TContent>(contentPath, { signal }),
    staleTime: HOUR_MS,
  })
  const state = useQuery({
    queryKey: queryKeys.resource(statePath),
    queryFn: ({ signal }) => api<TState>(statePath, { signal }),
    staleTime: LIVE_STALE_MS,
  })
  if (content.isPending || state.isPending) return <Page><SkeletonList count={4} /></Page>
  if (!content.data || !state.data || content.error || state.error) {
    return <Page><StatusBanner tone="warning" title="Data could not load" message="Retry this page request." /></Page>
  }
  const workspace = Object.assign(createEmptyWorkspace(currentUser, profile), map(content.data, state.data), {
    refresh: async () => { await Promise.all([content.refetch(), state.refetch()]) },
  })
  return children(workspace)
}
