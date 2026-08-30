import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom'
import type { Session } from '../api'
import type { StudentProfile, User } from '../types'
import type { LearningContextMetadata } from './types'
import { MobileNavigation, Sidebar } from '../components/navigation'
import { RouteWorkspace } from '../components/RouteWorkspace'
import { EndpointWorkspace } from '../components/EndpointWorkspace'
import { Page, SkeletonList, StatusBanner } from '../components/ui'
import { useAuthenticatedRequest } from '../hooks/useAuthenticatedRequest'
import { queryKeys } from '../queries/queryKeys'
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

export function AuthenticatedApp({ session, setSession, onLogout }: {
  session: Session; setSession: (session: Session) => void; onLogout: () => void
}) {
  const api = useAuthenticatedRequest(session, setSession, onLogout)
  const identity = useQuery({ queryKey: queryKeys.me, queryFn: ({ signal }) => api<Identity>('/accounts/users/me/', { signal }), staleTime: 600_000 })
  const navigation = useQuery({ queryKey: queryKeys.navigation, queryFn: ({ signal }) => api<Navigation>('/overview/navigation/', { signal }), staleTime: 30_000, enabled: Boolean(identity.data) })

  if (identity.isPending) return <main className="app-main"><Page><SkeletonList count={4} /></Page></main>
  if (!identity.data || identity.error) return <main className="app-main"><Page><StatusBanner tone="warning" title="Account could not load" message="Please sign in again." /></Page></main>
  const { user, student_profile: profile } = identity.data
  const pendingCount = navigation.data?.pending_count ?? 0
  if (user.is_admin_teacher || user.role === 'ADMIN') return <Suspense fallback={<main className="app-main"><Page><SkeletonList count={4} /></Page></main>}><AdminApp api={api} currentUser={user} profile={profile} pendingCount={pendingCount} onLogout={onLogout} /></Suspense>

  const scoped = (resources: Parameters<typeof RouteWorkspace>[0]['resources'], render: Parameters<typeof RouteWorkspace>[0]['children']) =>
    <RouteWorkspace api={api} currentUser={user} profile={profile} resources={resources}>{render}</RouteWorkspace>

  return <div className="app-shell">
    <Sidebar currentUser={user} pendingCount={pendingCount} onLogout={onLogout} />
    <main className="app-main">
      <MobileNavigation currentUser={user} pendingCount={pendingCount} onLogout={onLogout} />
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
  return <EndpointWorkspace<ModuleWorkspace> api={api} currentUser={currentUser} profile={profile} path={path} map={payload => ({ modules: [payload.module], moduleTopics: payload.topics, moduleLessons: payload.lessons, lessonExamples: payload.lesson_examples, lessonProgress: payload.lesson_progress, activities: payload.activities, activityAttempts: payload.activity_attempts, activityStates: payload.activity_states, subjects: payload.subjects, learningContext: payload.learning_context, legacyHistoryCounts: payload.legacy_history_counts })}>{data => <ModuleDetailPage api={api} data={data} refresh={data.refresh} />}</EndpointWorkspace>
}

type ActivityWorkspace = { activity: ModuleActivity; module: Module; attempts: ModuleActivityAttempt[]; submissions: ModuleActivitySubmission[] }
function ActivityWorkspaceRoute({ api, currentUser, profile }: WorkspaceRouteProps) {
  const { activityId } = useParams()
  const [searchParams] = useSearchParams()
  const requestedSchedule = searchParams.get('schedule')
  const requestedContext = searchParams.get('context')
  if (!requestedSchedule && requestedContext !== 'PERSONAL') {
    return <Page><StatusBanner tone="warning" title="Choose a learning context" message="Open this activity from a class or Personal Study module." /><Link className="button button--primary" to="/modules">Back to Modules</Link></Page>
  }
  const context = requestedSchedule
    ? `schedule=${requestedSchedule}`
    : 'context=PERSONAL'
  const path = `/modules/activities/${Number(activityId)}/workspace/?${context}`
  return <EndpointWorkspace<ActivityWorkspace> api={api} currentUser={currentUser} profile={profile} path={path} map={payload => ({ activities: [payload.activity], modules: [payload.module], activityAttempts: payload.attempts, submissions: payload.submissions })}>{data => <ActivityDetailPage api={api} data={data} refresh={data.refresh} />}</EndpointWorkspace>
}

type GradeOverview = { enrollments: ScheduleStudent[]; schedules: SubjectSchedule[]; categories: GradeCategory[]; category_grades: StudentCategoryGrade[]; period_grades: PeriodGrade[]; final_grades: FinalGrade[]; points: PointLedger[]; levels: LevelRule[] }
function GradeOverviewRoute({ api, currentUser, profile }: WorkspaceRouteProps) {
  const path = '/grades/overview/'
  return <EndpointWorkspace<GradeOverview> api={api} currentUser={currentUser} profile={profile} path={path} map={payload => ({ enrollments: payload.enrollments, schedules: payload.schedules, gradeCategories: payload.categories, categoryGrades: payload.category_grades, periodGrades: payload.period_grades, finalGrades: payload.final_grades, points: payload.points, levels: payload.levels })}>{data => <GradesPage data={data} />}</EndpointWorkspace>
}
