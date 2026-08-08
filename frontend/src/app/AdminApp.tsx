import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { AuthedRequest, WorkspaceDataWithRefresh } from './types'
import { MobileHeader, MobileTabbar, Sidebar } from '../components/navigation'
import type { NavItem } from '../components/navigation'
import { SkeletonList, StatusBanner } from '../components/ui'
import { AdminAssessmentsPage } from '../pages/admin/AdminAssessmentsPage'
import { AdminAttendancePage } from '../pages/admin/AdminAttendancePage'
import { AdminCodingPage } from '../pages/admin/AdminCodingPage'
import { AdminDashboardPage } from '../pages/admin/AdminDashboardPage'
import { AdminGradebookPage } from '../pages/admin/AdminGradebookPage'
import { AdminGradesPage } from '../pages/admin/AdminGradesPage'
import { AdminLessonEditorPage } from '../pages/admin/AdminLessonEditorPage'
import { AdminModuleEditorPage } from '../pages/admin/AdminModuleEditorPage'
import { AdminModulesPage } from '../pages/admin/AdminModulesPage'
import { AdminStudentsPage } from '../pages/admin/AdminStudentsPage'
import { AdminTopicEditorPage } from '../pages/admin/AdminTopicEditorPage'
import { LessonPresentationPage } from '../pages/admin/LessonPresentationPage'
import { ModuleProgressPage } from '../pages/admin/ModuleProgressPage'

const AdminClassesPage = lazy(() =>
  import('../pages/admin/AdminClassesPage').then((module) => ({
    default: module.AdminClassesPage,
  })),
)

const adminNavItems: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: 'dashboard' },
  { to: '/admin/students', label: 'Students', icon: 'users' },
  { to: '/admin/classes', label: 'Classes', icon: 'calendar' },
  { to: '/admin/modules', label: 'Modules', icon: 'module' },
  { to: '/admin/coding', label: 'Coding', icon: 'code' },
  { to: '/admin/assessments', label: 'Assessments', icon: 'assessment' },
  { to: '/admin/gradebook', label: 'Gradebook', icon: 'grade' },
  { to: '/admin/grades', label: 'Grades', icon: 'grade' },
]

const adminMobileNavItems: NavItem[] = [
  { to: '/admin', label: 'Home', icon: 'dashboard' },
  { to: '/admin/students', label: 'Students', icon: 'users' },
  { to: '/admin/classes', label: 'Classes', icon: 'calendar' },
  { to: '/admin/assessments', label: 'Tests', icon: 'assessment' },
  { to: '/admin/grades', label: 'Grades', icon: 'grade' },
]

export function AdminApp({
  api,
  onLogout,
  workspace,
}: {
  api: AuthedRequest
  onLogout: () => void
  workspace: WorkspaceDataWithRefresh
}) {
  const queueCount =
    workspace.submissions.filter((submission) => submission.score === null).length +
    workspace.answers.filter((answer) => answer.points_earned === null).length +
    workspace.codeSubmissions.filter((submission) => submission.score === null).length

  return (
    <div className="app-shell">
      <Sidebar
        badgePath="/admin/grades"
        currentUser={workspace.currentUser}
        items={adminNavItems}
        pendingCount={queueCount}
        profile={workspace.profile}
        workspaceLabel="Teacher console"
        onLogout={onLogout}
      />

      <main className="app-main">
        <MobileHeader
          currentUser={workspace.currentUser}
          pendingCount={queueCount}
          onLogout={onLogout}
        />

        {workspace.error ? (
          <StatusBanner
            tone="warning"
            title="Some admin data could not load"
            message={workspace.error}
          />
        ) : null}

        <Routes>
          <Route
            path="/admin"
            element={
              <AdminDashboardPage
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/students"
            element={
              <AdminStudentsPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/classes"
            element={
              <Suspense fallback={<SkeletonList count={4} />}>
                <AdminClassesPage
                  api={api}
                  data={workspace}
                  refresh={workspace.refresh}
                />
              </Suspense>
            }
          />
          <Route
            path="/admin/academic-setup"
            element={<Navigate replace to="/admin/classes" />}
          />
          <Route
            path="/admin/modules"
            element={
              <AdminModulesPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/modules/new"
            element={
              <AdminModuleEditorPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/modules/:moduleId/edit"
            element={
              <AdminModuleEditorPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/modules/:moduleId/topics/new"
            element={
              <AdminTopicEditorPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/modules/:moduleId/topics/:topicId/edit"
            element={
              <AdminTopicEditorPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/modules/:moduleId/topics/:topicId/lessons/new"
            element={
              <AdminLessonEditorPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/modules/:moduleId/topics/:topicId/lessons/:lessonId/edit"
            element={
              <AdminLessonEditorPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/modules/:moduleId/present"
            element={<LessonPresentationPage data={workspace} />}
          />
          <Route
            path="/admin/modules/:moduleId/progress"
            element={<ModuleProgressPage api={api} data={workspace} />}
          />
          <Route
            path="/admin/coding"
            element={
              <AdminCodingPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/assessments"
            element={
              <AdminAssessmentsPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/attendance"
            element={
              <AdminAttendancePage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/grades"
            element={
              <AdminGradesPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/gradebook"
            element={
              <AdminGradebookPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>

      <MobileTabbar
        badgePath="/admin/grades"
        items={adminMobileNavItems}
        pendingCount={queueCount}
      />
    </div>
  )
}
