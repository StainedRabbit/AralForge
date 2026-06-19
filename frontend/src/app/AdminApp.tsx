import { Navigate, Route, Routes } from 'react-router-dom'
import type { AuthedRequest, WorkspaceDataWithRefresh } from './types'
import { MobileHeader, MobileTabbar, Sidebar } from '../components/navigation'
import type { NavItem } from '../components/navigation'
import { StatusBanner } from '../components/ui'
import { AdminAcademicSetupPage } from '../pages/admin/AdminAcademicSetupPage'
import { AdminAssessmentsPage } from '../pages/admin/AdminAssessmentsPage'
import { AdminAttendancePage } from '../pages/admin/AdminAttendancePage'
import { AdminClassesPage } from '../pages/admin/AdminClassesPage'
import { AdminCodingPage } from '../pages/admin/AdminCodingPage'
import { AdminDashboardPage } from '../pages/admin/AdminDashboardPage'
import { AdminGradebookPage } from '../pages/admin/AdminGradebookPage'
import { AdminGradesPage } from '../pages/admin/AdminGradesPage'
import { AdminModuleEditorPage } from '../pages/admin/AdminModuleEditorPage'
import { AdminModulesPage } from '../pages/admin/AdminModulesPage'
import { AdminStudentsPage } from '../pages/admin/AdminStudentsPage'

const adminNavItems: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: 'dashboard' },
  { to: '/admin/students', label: 'Students', icon: 'users' },
  { to: '/admin/classes', label: 'Classes', icon: 'calendar' },
  { to: '/admin/academic-setup', label: 'Academic Setup', icon: 'book' },
  { to: '/admin/modules', label: 'Modules', icon: 'module' },
  { to: '/admin/coding', label: 'Coding', icon: 'code' },
  { to: '/admin/assessments', label: 'Assessments', icon: 'assessment' },
  { to: '/admin/attendance', label: 'Attendance', icon: 'check' },
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
              <AdminClassesPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/admin/academic-setup"
            element={
              <AdminAcademicSetupPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
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
