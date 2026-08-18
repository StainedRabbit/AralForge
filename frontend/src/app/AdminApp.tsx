import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { AuthedRequest } from './types'
import type { StudentProfile, User } from '../types'
import { MobileHeader, MobileTabbar, Sidebar, type NavItem } from '../components/navigation'
import { RouteWorkspace } from '../components/RouteWorkspace'
import type { WorkspaceResource } from '../queries/useScopedWorkspace'
import { SkeletonList } from '../components/ui'
const AdminAssessmentsPage = lazy(() => import('../pages/admin/AdminAssessmentsPage').then(module => ({ default: module.AdminAssessmentsPage })))
const AdminAttendancePage = lazy(() => import('../pages/admin/AdminAttendancePage').then(module => ({ default: module.AdminAttendancePage })))
const AdminCodingPage = lazy(() => import('../pages/admin/AdminCodingPage').then(module => ({ default: module.AdminCodingPage })))
const AdminDashboardPage = lazy(() => import('../pages/admin/AdminDashboardPage').then(module => ({ default: module.AdminDashboardPage })))
const AdminGradebookPage = lazy(() => import('../pages/admin/AdminGradebookPage').then(module => ({ default: module.AdminGradebookPage })))
const AdminGradesPage = lazy(() => import('../pages/admin/AdminGradesPage').then(module => ({ default: module.AdminGradesPage })))
const AdminLessonEditorPage = lazy(() => import('../pages/admin/AdminLessonEditorPage').then(module => ({ default: module.AdminLessonEditorPage })))
const AdminModuleEditorPage = lazy(() => import('../pages/admin/AdminModuleEditorPage').then(module => ({ default: module.AdminModuleEditorPage })))
const AdminModulesPage = lazy(() => import('../pages/admin/AdminModulesPage').then(module => ({ default: module.AdminModulesPage })))
const AdminStudentsPage = lazy(() => import('../pages/admin/AdminStudentsPage').then(module => ({ default: module.AdminStudentsPage })))
const AdminTopicEditorPage = lazy(() => import('../pages/admin/AdminTopicEditorPage').then(module => ({ default: module.AdminTopicEditorPage })))
const LessonPresentationPage = lazy(() => import('../pages/admin/LessonPresentationPage').then(module => ({ default: module.LessonPresentationPage })))
const ModuleProgressPage = lazy(() => import('../pages/admin/ModuleProgressPage').then(module => ({ default: module.ModuleProgressPage })))
const AdminClassesPage = lazy(() => import('../pages/admin/AdminClassesPage').then(module => ({ default: module.AdminClassesPage })))
const nav: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: 'dashboard' }, { to: '/admin/students', label: 'Students', icon: 'users' },
  { to: '/admin/classes', label: 'Classes', icon: 'calendar' }, { to: '/admin/modules', label: 'Modules', icon: 'module' },
  { to: '/admin/coding', label: 'Coding', icon: 'code' }, { to: '/admin/assessments', label: 'Assessments', icon: 'assessment' },
  { to: '/admin/gradebook', label: 'Gradebook', icon: 'grade' }, { to: '/admin/grades', label: 'Grades', icon: 'grade' },
]
const mobile = nav.filter(item => ['/admin','/admin/students','/admin/classes','/admin/assessments','/admin/grades'].includes(item.to)).map(item => item.to === '/admin' ? { ...item, label: 'Home' } : item)

const STUDENTS: WorkspaceResource[] = ['users','profiles','subjects','schedules','enrollments','modules','moduleAccess']
const CLASSES: WorkspaceResource[] = ['users','profiles','subjects','schoolYears','terms','schedules','enrollments','modules','attendanceSessions','attendanceRecords','gradeCategories','gradeItems','gradeItemScores','categoryGrades','periodGrades','finalGrades']
const MODULES: WorkspaceResource[] = ['subjects','modules']
const EDITOR: WorkspaceResource[] = ['users','profiles','schedules','enrollments','gradeCategories','gradeItems',...MODULES,'moduleTopics','moduleLessons','lessonExamples','lessonAssets','activities','activityQuestions','activityChoices','activityMatchingPairs','problems','testCases','assessments','questions','choices']
const LESSON_EDITOR: WorkspaceResource[] = []
const CODING: WorkspaceResource[] = ['users','subjects','modules','moduleTopics','moduleLessons','problems','testCases','codeSubmissions','codeBlankAnswers','attempts','questions']
const ASSESSMENTS: WorkspaceResource[] = ['users','subjects','modules','assessments','questions','choices','attempts','attemptQuestions','answers']
const ATTENDANCE: WorkspaceResource[] = ['users','subjects','terms','schedules','enrollments','attendanceSessions','attendanceRecords']
const GRADES: WorkspaceResource[] = ['users','subjects','schedules','gradingTemplates','gradingTemplateItems','subjectGradingPolicies','gradeCategories','gradeItems','categoryGrades','periodGrades','finalGrades','points','badges','studentBadges','levels']
const GRADEBOOK: WorkspaceResource[] = ['users','schedules','enrollments','modules','activities','activityAttempts','assessments','problems','attendanceSessions','gradeCategories','gradeItems','gradeItemScores','categoryGrades']

export function AdminApp({ api, currentUser, profile, pendingCount, onLogout }: { api: AuthedRequest; currentUser: User; profile: StudentProfile | null; pendingCount: number; onLogout: () => void }) {
  const scoped = (resources: readonly WorkspaceResource[], render: Parameters<typeof RouteWorkspace>[0]['children']) => <RouteWorkspace api={api} currentUser={currentUser} profile={profile} resources={resources}>{render}</RouteWorkspace>
  return <div className="app-shell">
    <Sidebar badgePath="/admin/grades" currentUser={currentUser} items={nav} pendingCount={pendingCount} profile={profile} workspaceLabel="Teacher console" onLogout={onLogout} />
    <main className="app-main"><MobileHeader currentUser={currentUser} pendingCount={pendingCount} onLogout={onLogout} />
      <Suspense fallback={<SkeletonList count={4} />}><Routes>
        <Route path="/admin" element={<AdminDashboardPage api={api} currentUser={currentUser} />} />
        <Route path="/admin/students" element={scoped(STUDENTS, data => <AdminStudentsPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/classes" element={scoped(CLASSES, data => <AdminClassesPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/academic-setup" element={<Navigate replace to="/admin/classes" />} />
        <Route path="/admin/modules" element={scoped(MODULES, data => <AdminModulesPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/new" element={scoped(EDITOR, data => <AdminModuleEditorPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/:moduleId/edit" element={scoped(EDITOR, data => <AdminModuleEditorPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/:moduleId/topics/new" element={scoped(EDITOR, data => <AdminTopicEditorPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/:moduleId/topics/:topicId/edit" element={scoped(EDITOR, data => <AdminTopicEditorPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/:moduleId/topics/:topicId/lessons/new" element={scoped(LESSON_EDITOR, data => <AdminLessonEditorPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/:moduleId/topics/:topicId/lessons/:lessonId/edit" element={scoped(LESSON_EDITOR, data => <AdminLessonEditorPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/modules/:moduleId/present" element={scoped(EDITOR, data => <LessonPresentationPage data={data} />)} />
        <Route path="/admin/modules/:moduleId/progress" element={scoped(['modules'], data => <ModuleProgressPage api={api} data={data} />)} />
        <Route path="/admin/coding" element={scoped(CODING, data => <AdminCodingPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/assessments" element={scoped(ASSESSMENTS, data => <AdminAssessmentsPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/attendance" element={scoped(ATTENDANCE, data => <AdminAttendancePage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/grades" element={scoped(GRADES, data => <AdminGradesPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="/admin/gradebook" element={scoped(GRADEBOOK, data => <AdminGradebookPage api={api} data={data} refresh={data.refresh} />)} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes></Suspense>
    </main><MobileTabbar badgePath="/admin/grades" items={mobile} pendingCount={pendingCount} />
  </div>
}
