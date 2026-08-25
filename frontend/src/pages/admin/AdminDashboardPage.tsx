import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { AuthedRequest } from '../../app/types'
import type { AssessmentAttempt, AttendanceSession, ModuleAccess, ModuleActivitySubmission, User } from '../../types'
import { Icon } from '../../components/Icon'
import { Page, PageHeader, SectionHeading, SkeletonList, StatCard, StatusBanner } from '../../components/ui'
import { queryKeys } from '../../queries/queryKeys'
import { formatDateTime } from '../../utils/format'
import { fullName } from '../../utils/student'

type TeacherDashboard = { role: 'teacher'; metrics: Record<string, number>; ungraded_submissions: ModuleActivitySubmission[]; recent_attempts: AssessmentAttempt[]; recent_module_access: ModuleAccess[]; recent_attendance: AttendanceSession[] }

export function AdminDashboardPage({ api, currentUser }: { api: AuthedRequest; currentUser: User }) {
  const query = useQuery({ queryKey: queryKeys.dashboard, queryFn: ({ signal }) => api<TeacherDashboard>('/overview/dashboard/', { signal }), staleTime: 30_000 })
  if (query.isPending) return <Page><SkeletonList count={4} /></Page>
  if (!query.data || query.error) return <Page><StatusBanner tone="warning" title="Dashboard could not load" message="Retry the dashboard request." /></Page>
  const { metrics, ungraded_submissions: submissions, recent_attempts: attempts, recent_module_access: grants, recent_attendance: attendance } = query.data
  return <Page>
    <PageHeader eyebrow="Admin workspace" title={`Teacher Console, ${fullName(currentUser)}.`} description="Manage students, classes, modules, assessments, attendance, grades, and rewards." actions={<button className="button button--secondary" onClick={() => query.refetch()} type="button"><Icon name="spark" /><span>Refresh</span></button>} />
    <section className="stat-grid"><StatCard icon="users" label="Students" value={metrics.student_count} detail={`${metrics.profile_count} profiles`} /><StatCard icon="module" label="Modules" value={metrics.module_count} detail={`${metrics.published_modules} published`} /><StatCard icon="assessment" label="Assessments" value={metrics.assessment_count} detail={`${metrics.question_count} questions`} /><StatCard icon="grade" label="Grade queue" value={metrics.grade_queue} detail="Ungraded work" /></section>
    <section className="admin-quick-grid"><Quick to="/admin/students" icon="shield" label="Module access" detail={`${metrics.module_grants} grants`} /><Quick to="/admin/classes" icon="calendar" label="Classes" detail={`${metrics.schedule_count} schedules`} /><Quick to="/admin/coding" icon="code" label="Coding lab" detail={`${metrics.problem_count} problems`} /><Quick to="/admin/grades" icon="grade" label="Grades" detail="Open grade management" /></section>
    <section className="content-grid"><Feed title="Submission Queue" empty="No ungraded module submissions.">{submissions.map((item) => <div className="admin-feed__item" key={item.id}><Icon name="activity" /><span><strong>Submission #{item.id}</strong><small>{formatDateTime(item.submitted_at)}</small></span><Link to="/admin/modules">Grade</Link></div>)}</Feed><Feed title="Assessment Activity" empty="No assessment attempts yet.">{attempts.map((item) => <div className="admin-feed__item" key={item.id}><Icon name="assessment" /><span><strong>Student #{item.student}</strong><small>{formatDateTime(item.started_at)}</small></span></div>)}</Feed></section>
    <section className="content-grid"><Feed title="Module Access" empty="No module grants yet.">{grants.map((item) => <div className="admin-feed__item" key={item.id}><Icon name="shield" /><span><strong>{item.student_name}</strong><small>{item.is_available ? 'Available' : 'Inactive'}</small></span></div>)}</Feed><Feed title="Attendance" empty="No attendance sessions yet.">{attendance.map((item) => <div className="admin-feed__item" key={item.id}><Icon name="calendar" /><span><strong>{item.title || 'Class meeting'}</strong><small>{item.date}</small></span></div>)}</Feed></section>
  </Page>
}

function Quick({ to, icon, label, detail }: { to: string; icon: 'calendar'|'code'|'grade'|'shield'; label: string; detail: string }) { return <Link className="admin-quick-link" to={to}><span className="stat-card__icon"><Icon name={icon} /></span><span><strong>{label}</strong><small>{detail}</small></span></Link> }
function Feed({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { return <div className="section-block"><SectionHeading subtitle="Recent activity" title={title} /><div className="admin-feed">{children || <p className="admin-empty-line">{empty}</p>}</div></div> }
