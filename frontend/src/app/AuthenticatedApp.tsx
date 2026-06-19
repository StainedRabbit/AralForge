import { Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '../api'
import { AdminApp } from './AdminApp'
import { MobileHeader, MobileTabbar, Sidebar } from '../components/navigation'
import { Page, SkeletonList, StatusBanner } from '../components/ui'
import { useAuthenticatedRequest } from '../hooks/useAuthenticatedRequest'
import { useWorkspaceData } from '../hooks/useWorkspaceData'
import { ActivityDetailPage } from '../pages/ActivityDetailPage'
import { AssessmentsPage, AssessmentDetailPage } from '../pages/AssessmentsPage'
import { AttendancePage } from '../pages/AttendancePage'
import { ClassesPage } from '../pages/ClassesPage'
import { CodingPage } from '../pages/CodingPage'
import { CodingProblemPage } from '../pages/CodingProblemPage'
import { DashboardPage } from '../pages/DashboardPage'
import { GradesPage } from '../pages/GradesPage'
import { ModuleDetailPage } from '../pages/ModuleDetailPage'
import { ModulesPage } from '../pages/ModulesPage'
import { ProfilePage } from '../pages/ProfilePage'
import { countPendingActivities } from '../utils/student'

export function AuthenticatedApp({
  session,
  setSession,
  onLogout,
}: {
  session: Session
  setSession: (session: Session) => void
  onLogout: () => void
}) {
  const api = useAuthenticatedRequest(session, setSession, onLogout)
  const workspace = useWorkspaceData(api, session.access)
  const pendingCount = countPendingActivities(workspace)

  if (workspace.loading) {
    return (
      <main className="app-main">
        <Page>
          <SkeletonList count={4} />
        </Page>
      </main>
    )
  }

  if (
    workspace.currentUser?.is_admin_teacher ||
    workspace.currentUser?.role === 'ADMIN'
  ) {
    return <AdminApp api={api} workspace={workspace} onLogout={onLogout} />
  }

  return (
    <div className="app-shell">
      <Sidebar
        currentUser={workspace.currentUser}
        profile={workspace.profile}
        pendingCount={pendingCount}
        onLogout={onLogout}
      />

      <main className="app-main">
        <MobileHeader
          currentUser={workspace.currentUser}
          pendingCount={pendingCount}
          onLogout={onLogout}
        />

        {workspace.error ? (
          <StatusBanner
            tone="warning"
            title="Some data could not load"
            message={workspace.error}
          />
        ) : null}

        <Routes>
          <Route
            path="/"
            element={<DashboardPage data={workspace} refresh={workspace.refresh} />}
          />
          <Route path="/classes" element={<ClassesPage data={workspace} />} />
          <Route path="/modules" element={<ModulesPage data={workspace} />} />
          <Route
            path="/modules/:moduleId"
            element={<ModuleDetailPage data={workspace} />}
          />
          <Route
            path="/activities/:activityId"
            element={
              <ActivityDetailPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route path="/coding" element={<CodingPage data={workspace} />} />
          <Route
            path="/coding/:problemId"
            element={
              <CodingProblemPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/assessments"
            element={
              <AssessmentsPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route
            path="/assessments/:assessmentId"
            element={
              <AssessmentDetailPage
                api={api}
                data={workspace}
                refresh={workspace.refresh}
              />
            }
          />
          <Route path="/attendance" element={<AttendancePage data={workspace} />} />
          <Route path="/grades" element={<GradesPage data={workspace} />} />
          <Route path="/profile" element={<ProfilePage data={workspace} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <MobileTabbar pendingCount={pendingCount} />
    </div>
  )
}
