import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import type { AuthedRequest } from '../../app/types'
import { asArray } from '../../api'
import { Page, PageHeader, SkeletonList } from '../../components/ui'
import { createEmptyWorkspace } from '../../queries/useScopedWorkspace'
import type { ApiList, StudentProfile, SubjectSchedule, TeacherGradebookPage, User } from '../../types'
import { toErrorMessage } from '../../utils/format'
import { AdminGradebookPage, type GradebookPaginationState } from './AdminGradebookPage'

export function AdminGradebookRoute({ api, currentUser, profile }: {
  api: AuthedRequest
  currentUser: User
  profile: StudentProfile | null
}) {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const scheduleList = useQuery({
    queryKey: ['gradebook-schedules'],
    queryFn: ({ signal }) => api<ApiList<SubjectSchedule>>('/subjects/subject-schedules/?status=active&limit=100', { signal }),
    staleTime: 60_000,
  })
  const schedules = asArray(scheduleList.data ?? [])
  const scheduleId = searchParams.get('schedule') ?? schedules[0]?.id.toString() ?? ''
  const period = searchParams.get('period') ?? 'PRELIM'
  const category = searchParams.get('category') ?? ''
  const item = searchParams.get('item') ?? ''
  const student = searchParams.get('student') ?? ''
  const filter = searchParams.get('filter') ?? 'ALL'
  const search = useDebouncedValue(searchParams.get('q') ?? '', 300)
  const gradebookKey = ['teacher-gradebook', scheduleId, period, category, item, student, filter, search] as const
  const gradebook = useInfiniteQuery({
    enabled: Boolean(scheduleId),
    initialPageParam: 0,
    queryKey: gradebookKey,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        schedule: scheduleId,
        period,
        filter,
        limit: '50',
        offset: String(pageParam),
      })
      if (category) params.set('category', category)
      if (item) params.set('item', item)
      if (student) params.set('student', student)
      if (search.trim()) params.set('search', search.trim())
      return api<TeacherGradebookPage>(`/grades/gradebook/?${params.toString()}`, { signal })
    },
    getNextPageParam: (page) => paginationOffset(page.next),
    retry: false,
    staleTime: 30_000,
  })

  const data = useMemo(() => {
    const workspace = createEmptyWorkspace(currentUser, profile)
    const pages = gradebook.data?.pages ?? []
    const first = pages[0]
    if (!first) {
      workspace.schedules = schedules
      return workspace
    }
    workspace.schedules = uniqueById([...schedules, first.schedule])
    workspace.enrollments = pages.flatMap((page) => page.enrollments)
    workspace.gradeCategories = first.categories
    workspace.gradeItems = first.items
    workspace.gradeItemScores = pages.flatMap((page) => page.scores)
    workspace.categoryGrades = pages.flatMap((page) => page.category_grades)
    workspace.modules = first.modules
    workspace.activities = first.activities
    workspace.activityAttempts = pages.flatMap((page) => page.activity_attempts)
    workspace.attendanceSessions = first.attendance_sessions
    workspace.users = uniqueById([currentUser, ...pages.flatMap((page) => page.users)])
    return workspace
  }, [currentUser, gradebook.data?.pages, profile, schedules])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ exact: true, queryKey: gradebookKey }),
      queryClient.invalidateQueries({ queryKey: ['teacher-grades-overview'] }),
    ])
  }
  const firstPage = gradebook.data?.pages[0]
  const pagination: GradebookPaginationState = {
    count: firstPage?.count ?? 0,
    totalCount: firstPage?.total_count ?? 0,
    loaded: data.enrollments.length,
    hasNextPage: Boolean(gradebook.hasNextPage),
    isFetchingNextPage: gradebook.isFetchingNextPage,
    isFetchNextPageError: gradebook.isFetchNextPageError,
    isRefreshing: gradebook.isFetching && !gradebook.isPending && !gradebook.isFetchingNextPage,
    statusCounts: firstPage?.status_counts,
    loadMore: () => gradebook.fetchNextPage().then(() => undefined),
    retry: () => gradebook.refetch().then(() => undefined),
  }

  if (scheduleList.isPending || (scheduleId && gradebook.isPending)) {
    return <Page><PageHeader eyebrow="Grades" title="Gradebook" description="Loading the selected class roster..." /><SkeletonList count={6} /></Page>
  }
  if (scheduleList.error || gradebook.error) {
    return <Page><PageHeader eyebrow="Grades" title="Gradebook" description="The selected class could not be loaded." /><div className="section-block progressive-resource__feedback" role="alert"><p>{toErrorMessage(scheduleList.error ?? gradebook.error)}</p><button className="button button--secondary" onClick={() => void (scheduleList.error ? scheduleList.refetch() : gradebook.refetch())} type="button">Retry</button></div></Page>
  }
  return <AdminGradebookPage api={api} data={data} pagination={pagination} refresh={refresh} />
}

function paginationOffset(next: number | string | null) {
  if (typeof next === 'number') return next
  if (!next) return undefined
  try {
    const offset = new URL(next).searchParams.get('offset')
    return offset === null ? undefined : Number(offset)
  } catch {
    return undefined
  }
}

function uniqueById<T extends { id: number }>(rows: T[]) {
  return [...new Map(rows.map((row) => [row.id, row])).values()]
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timeout)
  }, [delay, value])
  return debounced
}
