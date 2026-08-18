import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { asArray } from '../api'
import type { AuthedRequest, RouteData } from '../app/types'
import type { ApiList, StudentProfile, User } from '../types'
import { queryKeys } from './queryKeys'
import { toErrorMessage } from '../utils/format'

export type WorkspaceResource = Exclude<keyof RouteData,
  'currentUser' | 'profile' | 'loading' | 'error'
>

const paths: Record<WorkspaceResource, string> = {
  users: '/accounts/users/', profiles: '/accounts/students/',
  subjects: '/subjects/subjects/', schoolYears: '/subjects/school-years/',
  terms: '/subjects/school-year-semesters/', schedules: '/subjects/subject-schedules/',
  enrollments: '/subjects/schedule-students/', modules: '/modules/modules/',
  moduleTopics: '/modules/topics/', moduleLessons: '/modules/lessons/',
  lessonAssets: '/modules/lesson-assets/', lessonExamples: '/modules/lesson-examples/',
  lessonProgress: '/modules/lesson-progress/', moduleAccess: '/modules/access/',
  activities: '/modules/activities/', activityQuestions: '/modules/activity-questions/',
  activityChoices: '/modules/activity-choices/', activityMatchingPairs: '/modules/activity-matching-pairs/',
  activityAttempts: '/modules/activity-attempts/?view=summary', activityAnswers: '/modules/activity-answers/',
  submissions: '/modules/submissions/', progress: '/modules/progress/',
  topicProgress: '/modules/topic-progress/', problems: '/coding/problems/',
  testCases: '/coding/test-cases/', codeSubmissions: '/coding/submissions/',
  codeBlankAnswers: '/coding/blank-answers/', assessments: '/assessments/assessments/',
  attempts: '/assessments/attempts/', attemptQuestions: '/assessments/attempt-questions/',
  questions: '/assessments/questions/', choices: '/assessments/choices/',
  answers: '/assessments/answers/', attendanceSessions: '/attendance/sessions/',
  attendanceRecords: '/attendance/records/', gradingTemplates: '/grades/templates/',
  subjectGradingPolicies: '/grades/subject-policies/', gradingTemplateItems: '/grades/template-items/',
  gradeCategories: '/grades/categories/', gradeItems: '/grades/items/',
  categoryGrades: '/grades/student-categories/', gradeItemScores: '/grades/item-scores/',
  periodGrades: '/grades/periods/', finalGrades: '/grades/finals/',
  points: '/gamification/points/', badges: '/gamification/badges/',
  studentBadges: '/gamification/student-badges/', levels: '/gamification/levels/',
}

export function useScopedWorkspace(
  api: AuthedRequest,
  resources: readonly WorkspaceResource[],
  currentUser: User,
  profile: StudentProfile | null,
) {
  const queryClient = useQueryClient()
  const queries = useQueries({
    queries: resources.map((resource) => {
      const path = withLimit(paths[resource])
      return {
        queryKey: queryKeys.resource(path),
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          fetchAllPages(api, paths[resource], signal),
        staleTime: 60_000,
      }
    }),
  })

  const data = createEmptyWorkspace(currentUser, profile)
  resources.forEach((resource, index) => {
    ;(data as unknown as Record<string, unknown>)[resource] = queries[index].data ?? []
  })
  data.loading = queries.some((query) => query.isPending)
  data.error = queries.find((query) => query.error)?.error
    ? toErrorMessage(queries.find((query) => query.error)?.error)
    : ''

  const refresh = async () => {
    await Promise.all(resources.map((resource) => {
      const path = withLimit(paths[resource])
      return queryClient.invalidateQueries({ queryKey: queryKeys.resource(path) })
    }))
  }

  return { ...data, refresh }
}

export function usePaginatedResource<T>(
  api: AuthedRequest,
  path: string | null,
) {
  return useQuery({
    queryKey: queryKeys.resource(path ?? 'disabled'),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      fetchAllPages<T>(api, path!, signal),
    enabled: Boolean(path),
    staleTime: 60_000,
  })
}

export async function fetchAllPages<T>(
  api: AuthedRequest,
  path: string,
  signal?: AbortSignal,
) {
  const first = await api<ApiList<T>>(withPage(path, 0), { signal })
  if (Array.isArray(first)) {
    return first
  }

  const rows = [...first.results]
  const offsets: number[] = []
  for (let offset = PAGE_LIMIT; offset < first.count; offset += PAGE_LIMIT) {
    offsets.push(offset)
  }

  for (let index = 0; index < offsets.length; index += PAGE_CONCURRENCY) {
    const pages = await Promise.all(
      offsets.slice(index, index + PAGE_CONCURRENCY).map((offset) =>
        api<ApiList<T>>(withPage(path, offset), { signal }),
      ),
    )
    pages.forEach((page) => rows.push(...asArray(page)))
  }
  return rows.slice(0, first.count)
}

const PAGE_LIMIT = 100
const PAGE_CONCURRENCY = 3

function withLimit(path: string) {
  return `${path}${path.includes('?') ? '&' : '?'}limit=${PAGE_LIMIT}`
}

function withPage(path: string, offset: number) {
  const [pathname, query = ''] = path.split('?', 2)
  const params = new URLSearchParams(query)
  params.set('limit', String(PAGE_LIMIT))
  params.set('offset', String(offset))
  return `${pathname}?${params.toString()}`
}

export function createEmptyWorkspace(currentUser: User, profile: StudentProfile | null): RouteData {
  return {
    users: [], currentUser, profiles: profile ? [profile] : [], profile,
    subjects: [], schoolYears: [], terms: [], schedules: [], enrollments: [], modules: [],
    moduleTopics: [], moduleLessons: [], lessonAssets: [], lessonExamples: [], lessonProgress: [],
    moduleAccess: [], activities: [], activityQuestions: [], activityChoices: [],
    activityMatchingPairs: [], activityAttempts: [], activityAnswers: [], submissions: [],
    progress: [], topicProgress: [], problems: [], testCases: [], codeSubmissions: [],
    codeBlankAnswers: [], assessments: [], attempts: [], attemptQuestions: [], questions: [],
    choices: [], answers: [], attendanceSessions: [], attendanceRecords: [], gradingTemplates: [],
    subjectGradingPolicies: [], gradingTemplateItems: [], gradeCategories: [], gradeItems: [],
    categoryGrades: [], gradeItemScores: [], periodGrades: [], finalGrades: [], points: [],
    badges: [], studentBadges: [], levels: [], loading: false, error: '',
  }
}
