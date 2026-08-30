import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { AuthedRequest } from './types'
import type { StudentProfile, User } from '../types'
import { MobileNavigation, Sidebar, type NavItem } from '../components/navigation'
import { RouteWorkspace } from '../components/RouteWorkspace'
import type { WorkspaceResource } from '../queries/useScopedWorkspace'
import { SkeletonList } from '../components/ui'
const AdminAttendancePage = lazy(() => import('../pages/admin/AdminAttendancePage').then(module => ({ default: module.AdminAttendancePage })))
const AdminDashboardPage = lazy(() => import('../pages/admin/AdminDashboardPage').then(module => ({ default: module.AdminDashboardPage })))
const AdminGradebookRoute = lazy(() => import('../pages/admin/AdminGradebookRoute').then(module => ({ default: module.AdminGradebookRoute })))
const AdminGradesPage = lazy(() => import('../pages/admin/AdminGradesScalablePage').then(module => ({ default: module.AdminGradesScalablePage })))
const AdminLessonEditorPage = lazy(() => import('../pages/admin/AdminLessonEditorPage').then(module => ({ default: module.AdminLessonEditorPage })))
const AdminModuleEditorPage = lazy(() => import('../pages/admin/AdminModuleEditorPage').then(module => ({ default: module.AdminModuleEditorPage })))
const AdminModulesPage = lazy(() => import('../pages/admin/AdminModulesPage').then(module => ({ default: module.AdminModulesPage })))
const AdminStudentsPage = lazy(() => import('../pages/admin/AdminStudentsPage').then(module => ({ default: module.AdminStudentsPage })))
const AdminSubmissionReviewPage = lazy(() => import('../pages/admin/AdminSubmissionReviewPage').then(module => ({ default: module.AdminSubmissionReviewPage })))
const AdminTopicEditorPage = lazy(() => import('../pages/admin/AdminTopicEditorPage').then(module => ({ default: module.AdminTopicEditorPage })))
const LessonPresentationPage = lazy(() => import('../pages/admin/LessonPresentationPage').then(module => ({ default: module.LessonPresentationPage })))
const ModuleProgressPage = lazy(() => import('../pages/admin/ModuleProgressPage').then(module => ({ default: module.ModuleProgressPage })))
const AdminClassesPage = lazy(() => import('../pages/admin/AdminClassesPage').then(module => ({ default: module.AdminClassesPage })))
const nav: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: 'dashboard' }, { to: '/admin/students', label: 'Students', icon: 'users' },
  { to: '/admin/classes', label: 'Classes', icon: 'calendar' }, { to: '/admin/modules', label: 'Modules', icon: 'module' },
  { to: '/admin/grades', label: 'Grades', icon: 'grade' },
]
const mobile: NavItem[] = [
  { to: '/admin', label: 'Home', icon: 'dashboard' },
  { to: '/admin/classes', label: 'Classes', icon: 'calendar', matchPrefixes: ['/admin/classes', '/admin/academic-setup'] },
  { to: '/admin/modules', label: 'Modules', icon: 'module', matchPrefixes: ['/admin/modules'] },
  { to: '/admin/grades', label: 'Grades', icon: 'grade', matchPrefixes: ['/admin/grades', '/admin/gradebook', '/admin/submissions'] },
]
const mobileMore: NavItem[] = [
  { to: '/admin/students', label: 'Students', icon: 'users' },
  { to: '/admin/attendance', label: 'Attendance', icon: 'check' },
  { to: '/admin/gradebook', label: 'Gradebook', icon: 'grade' },
]

const STUDENTS: WorkspaceResource[] = ['subjects','modules']
const CLASSES: WorkspaceResource[] = ['subjects','schoolYears','terms','modules']
const MODULES: WorkspaceResource[] = ['subjects','modules']
const MODULE_EDITOR: WorkspaceResource[] = MODULES
const TOPIC_EDITOR: WorkspaceResource[] = [...MODULES,'moduleTopics']
const PRESENTATION: WorkspaceResource[] = ['modules','moduleTopics','moduleLessons','lessonExamples']
const LESSON_EDITOR: WorkspaceResource[] = []
const ATTENDANCE: WorkspaceResource[] = ['users','subjects','terms','schedules','enrollments','attendanceSessions','attendanceRecords']

export function AdminApp({ api, currentUser, profile, pendingCount, onLogout }: { api: AuthedRequest; currentUser: User; profile: StudentProfile | null; pendingCount: number; onLogout: () => void }) {
  const scoped = (resources: readonly WorkspaceResource[], render: Parameters<typeof RouteWorkspace>[0]['children']) => <RouteWorkspace api={api} currentUser={currentUser} profile={profile} resources={resources}>{render}</RouteWorkspace>
  return <div className="app-shell">
    <Sidebar badgePath="/admin/grades" currentUser={currentUser} items={nav} pendingCount={pendingCount} workspaceLabel="Teacher console" onLogout={onLogout} />
    <main className="app-main"><MobileNavigation badgePath="/admin/grades" currentUser={currentUser} items={mobile} moreItems={mobileMore} pendingCount={pendingCount} workspaceLabel="Teacher console" onLogout={onLogout} />
      <Suspense fallback={<SkeletonList count={4} />}><Routes>
        <Route path="/admin" element={<AdminDashboardPage api={api} currentUser={currentUser} />} />
        <Route path="/admin/students" element={scoped(STUDENTS, data => <AdminStudentsPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/classes" element={scoped(CLASSES, data => <AdminClassesPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/academic-setup" element={<Navigate replace to="/admin/classes" />} />
        <Route path="/admin/modules" element={scoped(MODULES, data => <AdminModulesPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/new" element={scoped(MODULE_EDITOR, data => <AdminModuleEditorPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/:moduleId/edit" element={scoped(MODULE_EDITOR, data => <AdminModuleEditorPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/:moduleId/topics/new" element={scoped(TOPIC_EDITOR, data => <AdminTopicEditorPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/:moduleId/topics/:topicId/edit" element={scoped(TOPIC_EDITOR, data => <AdminTopicEditorPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/:moduleId/topics/:topicId/lessons/new" element={scoped(LESSON_EDITOR, data => <AdminLessonEditorPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/:moduleId/topics/:topicId/lessons/:lessonId/edit" element={scoped(LESSON_EDITOR, data => <AdminLessonEditorPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/:moduleId/present" element={scoped(PRESENTATION, data => <LessonPresentationPage data={data} />)} />
        <Route path="/admin/modules/:moduleId/progress" element={scoped(['modules'], data => <ModuleProgressPage api={api} data={data} />)} />
        <Route path="/admin/submissions/:submissionId" element={<AdminSubmissionReviewPage api={api} />} />
        <Route path="/admin/assessments/*" element={<Navigate replace to="/admin/gradebook" />} />
        <Route path="/admin/attendance" element={scoped(ATTENDANCE, data => <AdminAttendancePage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/grades" element={<AdminGradesPage api={api} />} />
        <Route path="/admin/gradebook" element={<AdminGradebookRoute api={api} currentUser={currentUser} profile={profile} />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes></Suspense>
    </main>
  </div>
}
