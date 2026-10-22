import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import type { Session } from '../api'
import type { StudentProfile, ThemePreference, User } from '../types'
import { applyTheme, rememberThemePreference } from '../theme'
import { toErrorMessage } from '../utils/format'
import type { LearningContextMetadata } from './types'
import { Icon } from '../components/Icon'
import { MobileNavigation, Sidebar } from '../components/navigation'
import { RouteWorkspace } from '../components/RouteWorkspace'
import { EndpointWorkspace, SplitEndpointWorkspace } from '../components/EndpointWorkspace'
import { Page, PageHeader, SkeletonList, StatusBanner } from '../components/ui'
import { useAuthenticatedRequest } from '../hooks/useAuthenticatedRequest'
import { queryKeys } from '../queries/queryKeys'
import { LIVE_STALE_MS, startPersistentCache } from '../queries/persistentCache'
import type { FinalGrade, GradeCategory, LevelRule, MainActivityState, Module, ModuleActivity, ModuleActivityAttempt, ModuleActivitySubmission, ModuleLesson, ModuleLessonExample, ModuleLessonProgress, ModuleTopic, PeriodGrade, PointLedger, ScheduleStudent, StudentCategoryGrade, Subject, SubjectSchedule } from '../types'

const AdminApp = lazy(() => import('./AdminApp').then(module => ({ default: module.AdminApp })))
const ActivityDetailPage = lazy(() => import('../pages/ActivityDetailPage').then(module => ({ default: module.ActivityDetailPage })))
const AttendancePage = lazy(() => import('../pages/AttendancePage').then(module => ({ default: module.AttendancePage })))
const ClassesPage = lazy(() => import('../pages/ClassesPage').then(module => ({ default: module.ClassesPage })))
const DashboardPage = lazy(() => import('../pages/DashboardPage').then(module => ({ default: module.DashboardPage })))
const GradesPage = lazy(() => import('../pages/GradesPage').then(module => ({ default: module.GradesPage })))
const ModuleDetailPage = lazy(() => import('../pages/ModuleDetailPage').then(module => ({ default: module.ModuleDetailPage })))
const ModulesPage = lazy(() => import('../pages/ModulesPage').then(module => ({ default: module.ModulesPage })))
const ProfilePage = lazy(() => import('../pages/ProfilePage').then(module => ({ default: module.ProfilePage })))

type Identity = { user: User; student_profile: StudentProfile | null }
type Navigation = { role: 'student' | 'teacher'; pending_count: number }

export function AuthenticatedApp({ session, setSession, onLogout, onSessionExpired }: {
  session: Session; setSession: (session: Session) => void; onLogout: () => void; onSessionExpired: () => void
}) {
  const api = useAuthenticatedRequest(session, setSession, onSessionExpired)
  const location = useLocation()
  const identity = useQuery({ queryKey: queryKeys.me, queryFn: ({ signal }) => api<Identity>('/accounts/users/me/', { signal }), staleTime: LIVE_STALE_MS })
  const queryClient = useQueryClient()
  const [cacheReadyFor, setCacheReadyFor] = useState<number | null>(null)
  const verifiedUserId = identity.data?.user.id
  useEffect(() => {
    if (!verifiedUserId) return
    let disposed = false
    let stop: () => void = () => undefined
    void startPersistentCache(queryClient, verifiedUserId).then((unsubscribe) => {
      if (disposed) unsubscribe()
      else {
        stop = unsubscribe
        setCacheReadyFor(verifiedUserId)
      }
    })
    return () => { disposed = true; stop() }
  }, [queryClient, verifiedUserId])
  useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: ({ signal }) => api<unknown>('/overview/dashboard/', { signal }),
    staleTime: LIVE_STALE_MS,
    enabled: location.pathname === '/',
  })
  const [selectedTheme, setSelectedTheme] = useState<ThemePreference | null>(null)
  const [savingTheme, setSavingTheme] = useState(false)
  const [themeError, setThemeError] = useState('')
  const themePreference = selectedTheme ?? identity.data?.user.theme_preference ?? 'system'
  useLayoutEffect(() => {
    if (!identity.data) return
    applyTheme(themePreference)
    rememberThemePreference(themePreference)
  }, [identity.data, themePreference])
  async function changeTheme(next: ThemePreference) {
    if (savingTheme || next === themePreference) return
    setSelectedTheme(next)
    setSavingTheme(true)
    setThemeError('')
    try {
      await api<{ theme_preference: ThemePreference }>('/accounts/users/me/theme/', {
        method: 'PATCH',
        body: JSON.stringify({ theme_preference: next }),
      })
      queryClient.setQueryData<Identity>(queryKeys.me, (current) => current
        ? { ...current, user: { ...current.user, theme_preference: next } } : current)
    } catch (error) {
      setThemeError(`Appearance could not be saved. ${toErrorMessage(error)}`)
    } finally {
      setSelectedTheme(null)
      setSavingTheme(false)
    }
  }
  const isAdminTeacher = Boolean(
    identity.data?.user.is_admin_teacher || identity.data?.user.role === 'ADMIN',
  )
  const navigation = useQuery({ queryKey: queryKeys.navigation, queryFn: ({ signal }) => api<Navigation>('/overview/navigation/', { signal }), staleTime: LIVE_STALE_MS, enabled: isAdminTeacher })

  if (identity.isPending) return <main className="app-main"><Page><SkeletonList count={4} /></Page></main>
  if (!identity.data || identity.error) return <main className="app-main"><Page><StatusBanner tone="warning" title="Account could not load" message="Please try loading your account again." /><button className="button button--secondary" type="button" disabled={identity.isFetching} onClick={() => void identity.refetch()}>{identity.isFetching ? 'Retrying…' : 'Retry'}</button></Page></main>
  if (cacheReadyFor !== identity.data.user.id) return <main className="app-main"><Page><SkeletonList count={4} /></Page></main>
  const { user, student_profile: profile } = identity.data
  const pendingCount = navigation.data?.pending_count ?? 0
  if (isAdminTeacher) return <Suspense fallback={<main className="app-main"><Page><SkeletonList count={4} /></Page></main>}><AdminApp api={api} currentUser={user} profile={profile} pendingCount={pendingCount} onLogout={onLogout} themePreference={themePreference} onThemeChange={changeTheme} themeSaving={savingTheme} themeError={themeError} /></Suspense>

  const scoped = (resources: Parameters<typeof RouteWorkspace>[0]['resources'], render: Parameters<typeof RouteWorkspace>[0]['children']) =>
    <RouteWorkspace api={api} currentUser={user} profile={profile} resources={resources}>{render}</RouteWorkspace>

  return <div className="app-shell">
    <Sidebar currentUser={user} pendingCount={0} onLogout={onLogout} themePreference={themePreference} onThemeChange={changeTheme} themeSaving={savingTheme} themeError={themeError} />
    <main className="app-main">
      <MobileNavigation currentUser={user} pendingCount={0} onLogout={onLogout} showAccountAvatar={false} stickyHeader={false} themePreference={themePreference} onThemeChange={changeTheme} themeSaving={savingTheme} themeError={themeError} />
      <Suspense fallback={<Page><SkeletonList count={4} /></Page>}>
        <Routes>
          <Route path="/" element={<DashboardPage api={api} currentUser={user} />} />
          <Route path="/classes" element={scoped(['schedules','enrollments'], data => <ClassesPage data={data} />)} />
          <Route path="/modules" element={scoped(['modules','moduleTopics','moduleLessons','lessonProgress','subjects','enrollments'], data => <ModulesPage api={api} data={data} />)} />
          <Route path="/modules/:moduleId" element={<ModuleWorkspaceRoute api={api} currentUser={user} profile={profile} />} />
          <Route path="/activities/:activityId" element={<ActivityWorkspaceRoute api={api} currentUser={user} profile={profile} />} />
          <Route path="/assessments/*" element={<Navigate to="/modules" replace />} />
          <Route path="/attendance" element={scoped(['attendanceSessions','attendanceRecords','schedules','enrollments'], data => <AttendancePage data={data} />)} />
          <Route path="/grades" element={<GradeOverviewRoute api={api} currentUser={user} profile={profile} />} />
          <Route path="/profile" element={scoped([], data => <ProfilePage api={api} data={data} />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </main>
  </div>
}

type WorkspaceRouteProps = { api: ReturnType<typeof useAuthenticatedRequest>; currentUser: User; profile: StudentProfile | null }
type ModuleWorkspace = { module: Module; topics: ModuleTopic[]; lessons: ModuleLesson[]; lesson_examples: ModuleLessonExample[]; lesson_progress: ModuleLessonProgress[]; activities: ModuleActivity[]; activity_attempts: ModuleActivityAttempt[]; activity_states: MainActivityState[]; subjects: Subject[]; learning_context: LearningContextMetadata; legacy_history_counts: Record<number, number> }
type ModuleContent = Pick<ModuleWorkspace, 'module' | 'topics' | 'lessons' | 'lesson_examples' | 'activities' | 'subjects'>
type ModuleState = Pick<ModuleWorkspace, 'lesson_progress' | 'activity_attempts' | 'activity_states' | 'learning_context' | 'legacy_history_counts'>
function ModuleWorkspaceRoute({ api, currentUser, profile }: WorkspaceRouteProps) {
  const { moduleId } = useParams()
  const [searchParams] = useSearchParams()
  const requestedSchedule = searchParams.get('schedule')
  const requestedContext = searchParams.get('context')
  if (!requestedSchedule && requestedContext !== 'PERSONAL') {
    return <Page><StatusBanner tone="warning" title="Choose a learning context" message="Open this module from Modules and select an active class or Personal Study first." /><Link className="button button--primary" to="/modules">Back to Modules</Link></Page>
  }
  const context = requestedSchedule
    ? `schedule=${requestedSchedule}`
    : 'context=PERSONAL'
  const path = `/modules/modules/${Number(moduleId)}/workspace/?${context}`
  return <SplitEndpointWorkspace<ModuleContent, ModuleState> api={api} currentUser={currentUser} profile={profile} contentPath={`${path}&view=content`} statePath={`${path}&view=state`} map={(content, state) => ({ modules: [content.module], moduleTopics: content.topics, moduleLessons: content.lessons, lessonExamples: content.lesson_examples, lessonProgress: state.lesson_progress, activities: content.activities, activityAttempts: state.activity_attempts, activityStates: state.activity_states, subjects: content.subjects, learningContext: state.learning_context, legacyHistoryCounts: state.legacy_history_counts })}>{data => <ModuleDetailPage api={api} data={data} refresh={data.refresh} />}</SplitEndpointWorkspace>
}

type ActivityWorkspace = { activity: ModuleActivity; module: Module; attempts: ModuleActivityAttempt[]; submissions: ModuleActivitySubmission[] }
type ActivityContent = Pick<ActivityWorkspace, 'activity' | 'module'>
type ActivityState = Pick<ActivityWorkspace, 'attempts' | 'submissions'>
function ActivityWorkspaceRoute({ api, currentUser, profile }: WorkspaceRouteProps) {
  const { activityId } = useParams()
  const [searchParams] = useSearchParams()
  const requestedSchedule = searchParams.get('schedule')
  const requestedContext = searchParams.get('context')
  if (!requestedSchedule && requestedContext !== 'PERSONAL') {
    return <ActivityContextResolver api={api} activityId={activityId ?? ''} />
  }
  const context = requestedSchedule
    ? `schedule=${requestedSchedule}`
    : 'context=PERSONAL'
  const path = `/modules/activities/${Number(activityId)}/workspace/?${context}`
  return <SplitEndpointWorkspace<ActivityContent, ActivityState> api={api} currentUser={currentUser} profile={profile} contentPath={`${path}&view=content`} statePath={`${path}&view=state`} map={(content, state) => ({ activities: [content.activity], modules: [content.module], activityAttempts: state.attempts, submissions: state.submissions })}>{data => <ActivityDetailPage api={api} data={data} refresh={data.refresh} />}</SplitEndpointWorkspace>
}

type ActivityContextOption = { context_type: 'CLASS' | 'PERSONAL'; schedule: number | null; label: string }
type ActivityContextOptions = { contexts: ActivityContextOption[] }

function activityContextTarget(activityId: string, context: ActivityContextOption) {
  return context.context_type === 'CLASS' && context.schedule
    ? `/activities/${activityId}?schedule=${context.schedule}`
    : `/activities/${activityId}?context=PERSONAL`
}

function ActivityContextResolver({ api, activityId }: { api: WorkspaceRouteProps['api']; activityId: string }) {
  const path = `/modules/activities/${Number(activityId)}/context-options/`
  const query = useQuery({
    queryKey: queryKeys.resource(path),
    queryFn: ({ signal }) => api<ActivityContextOptions>(path, { signal }),
    staleTime: LIVE_STALE_MS,
  })

  if (query.isPending) return <Page><SkeletonList count={3} /></Page>
  if (query.error || !query.data) {
    return <Page><StatusBanner tone="warning" title="Activity could not load" message="This activity may no longer be available to your account." /><Link className="button button--primary" to="/modules">Back to Modules</Link></Page>
  }
  if (query.data.contexts.length === 1) {
    return <Navigate replace to={activityContextTarget(activityId, query.data.contexts[0])} />
  }
  if (!query.data.contexts.length) {
    return <Page><StatusBanner tone="warning" title="No active learning context" message="This activity is available only through an active class or Personal Study module." /><Link className="button button--primary" to="/modules">Back to Modules</Link></Page>
  }

  return <Page>
    <PageHeader eyebrow="Activity" title="Choose a learning context" description="Select the class or Personal Study space where you want to open this activity." />
    <section aria-label="Available learning contexts" className="card-list">
      {query.data.contexts.map((context) => <Link className="resource-row" key={`${context.context_type}-${context.schedule ?? 'personal'}`} to={activityContextTarget(activityId, context)}>
        <span className="resource-row__icon"><Icon name={context.context_type === 'CLASS' ? 'module' : 'book'} /></span>
        <div><strong>{context.label}</strong><span>{context.context_type === 'CLASS' ? 'Class activity workspace' : 'Personal Study workspace'}</span></div>
      </Link>)}
    </section>
    <Link className="button button--secondary" to="/modules">Back to Modules</Link>
  </Page>
}

type GradeOverview = { enrollments: ScheduleStudent[]; schedules: SubjectSchedule[]; categories: GradeCategory[]; category_grades: StudentCategoryGrade[]; period_grades: PeriodGrade[]; final_grades: FinalGrade[]; points: PointLedger[]; levels: LevelRule[] }
function GradeOverviewRoute({ api, currentUser, profile }: WorkspaceRouteProps) {
  const path = '/grades/overview/'
  return <EndpointWorkspace<GradeOverview> api={api} currentUser={currentUser} profile={profile} path={path} map={payload => ({ enrollments: payload.enrollments, schedules: payload.schedules, gradeCategories: payload.categories, categoryGrades: payload.category_grades, periodGrades: payload.period_grades, finalGrades: payload.final_grades, points: payload.points, levels: payload.levels })}>{workspace => <GradesPage data={workspace} />}</EndpointWorkspace>
}
