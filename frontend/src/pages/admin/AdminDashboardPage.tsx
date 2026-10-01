import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { AuthedRequest } from '../../app/types'
import { Icon, type IconName } from '../../components/Icon'
import { EmptyState, Page, PageHeader, SectionHeading, SkeletonList, StatCard, StatusBanner } from '../../components/ui'
import { queryKeys } from '../../queries/queryKeys'
import type { User } from '../../types'
import { formatDateTime, formatTime, toErrorMessage } from '../../utils/format'
import { fullName } from '../../utils/student'

type AttendanceStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE'
type BackupJob = {
  id: string
  job_type: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  progress: number
  total: number
  error: string
}

type AttentionItem = {
  id: number
  student_name: string
  activity_title: string
  module_title: string
  submitted_at: string
  has_file: boolean
}

type TodayClass = {
  schedule_id: number
  subject_code: string
  subject_name: string
  section: string
  room: string
  start_time: string
  end_time: string
  active_student_count: number
  attendance_status: AttendanceStatus
}

type RecentActivity = {
  kind: 'ACTIVITY_ATTEMPT' | 'SUBMISSION_REVIEW' | 'ATTENDANCE'
  id: number
  title: string
  detail: string
  occurred_at: string
  module_id: number | null
  submission_id: number | null
  schedule_id: number | null
  attendance_session_id: number | null
}

type TeacherDashboard = {
  role: 'teacher'
  metrics: {
    attention_count: number
    today_class_count: number
    attendance_complete_count: number
    active_class_count: number
    active_student_count: number
  }
  attention_items: AttentionItem[]
  today_classes: TodayClass[]
  recent_activity: RecentActivity[]
}

export function AdminDashboardPage({ api, currentUser }: { api: AuthedRequest; currentUser: User }) {
  const queryClient = useQueryClient()
  const [backupId, setBackupId] = useState(() => localStorage.getItem('aralforge-backup-job') ?? '')
  const [backupError, setBackupError] = useState('')
  const [startingBackup, setStartingBackup] = useState(false)
  const backupQuery = useQuery({
    queryKey: ['full-backup', backupId],
    queryFn: ({ signal }) => api<BackupJob>(`/jobs/${backupId}/`, { signal }),
    enabled: currentUser.role === 'ADMIN' && Boolean(backupId),
    refetchInterval: query => ['PENDING', 'RUNNING'].includes(query.state.data?.status ?? '') ? 2000 : false,
  })

  const query = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: ({ signal }) => api<TeacherDashboard>('/overview/dashboard/', { signal }),
    staleTime: 30_000,
  })

  if (query.isPending) return <Page><SkeletonList count={4} /></Page>
  if (!query.data || query.error) {
    return <Page><StatusBanner tone="warning" title="Overview could not load" message="Retry the overview request." /></Page>
  }

  const { attention_items: attentionItems, metrics, recent_activity: recentActivity, today_classes: todayClasses } = query.data
  const attendanceDetail = metrics.today_class_count
    ? `${metrics.attendance_complete_count} of ${metrics.today_class_count} complete`
    : 'No classes scheduled'
  const currentBackup = backupQuery.data?.job_type === 'BACKUP' ? backupQuery.data : undefined

  async function startBackup() {
    setBackupError('')
    setStartingBackup(true)
    try {
      const job = await api<BackupJob>('/jobs/backups/', { method: 'POST' })
      setBackupId(job.id)
      localStorage.setItem('aralforge-backup-job', job.id)
      await queryClient.invalidateQueries({ queryKey: ['full-backup', job.id] })
    } catch (error) {
      setBackupError(toErrorMessage(error))
    } finally {
      setStartingBackup(false)
    }
  }

  async function downloadBackup() {
    if (!backupId) return
    setBackupError('')
    try {
      const blob = await api<Blob>(`/jobs/${backupId}/backup-download/`)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `aralforge-backup-${backupId}.zip`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setBackupError(toErrorMessage(error))
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Overview"
        title={`Welcome back, ${fullName(currentUser)}.`}
        description={overviewSummary(metrics)}
        actions={
          <button className="button button--secondary" onClick={() => query.refetch()} type="button">
            <Icon name="spark" />
            <span>Refresh</span>
          </button>
        }
      />

      {currentUser.role === 'ADMIN' ? (
        <section className="section-block">
          <SectionHeading subtitle="Download a PostgreSQL backup and uploaded media as one ZIP. Backups expire after 24 hours." title="Full backup" />
          <div className="toolbar">
            <button className="button button--secondary" disabled={startingBackup || ['PENDING', 'RUNNING'].includes(currentBackup?.status ?? '')} onClick={() => void startBackup()} type="button">
              <Icon name="download" /><span>{startingBackup ? 'Starting backup...' : 'Download full backup'}</span>
            </button>
            {currentBackup && ['PENDING', 'RUNNING'].includes(currentBackup.status) ? (
              <span role="status">Preparing backup: {currentBackup.progress} of {currentBackup.total || 'media files'} complete.</span>
            ) : null}
            {currentBackup?.status === 'SUCCEEDED' ? (
              <button className="button button--primary" onClick={() => void downloadBackup()} type="button">
                <Icon name="download" /><span>Download ready backup</span>
              </button>
            ) : null}
          </div>
          {backupError || currentBackup?.status === 'FAILED' ? <StatusBanner tone="warning" title="Backup unavailable" message={backupError || currentBackup?.error || 'The backup could not be completed.'} /> : null}
        </section>
      ) : null}

      <section className="stat-grid">
        <StatCard icon="grade" label="Needs review" value={metrics.attention_count} detail="Text and file submissions" />
        <StatCard icon="calendar" label="Classes today" value={metrics.today_class_count} detail={`${metrics.active_class_count} active classes`} />
        <StatCard icon="check" label="Attendance complete" value={metrics.attendance_complete_count} detail={attendanceDetail} />
        <StatCard icon="users" label="Active students" value={metrics.active_student_count} detail="Across active classes" />
      </section>

      <div className="teacher-overview-grid">
        <section className="section-block teacher-overview-panel">
          <SectionHeading subtitle={`${metrics.attention_count} waiting for review`} title="Needs attention" />
          {attentionItems.length ? (
            <div className="teacher-overview-list">
              {attentionItems.map((item) => (
                <article className="teacher-overview-row" key={item.id}>
                  <span aria-hidden="true" className="teacher-overview-row__icon"><Icon name={item.has_file ? 'file' : 'activity'} /></span>
                  <div className="teacher-overview-row__body">
                    <strong>{item.student_name}</strong>
                    <span>{item.activity_title}</span>
                    <small>{item.module_title} · {formatDateTime(item.submitted_at)}</small>
                  </div>
                  <Link className="button button--primary button--compact" to={`/admin/submissions/${item.id}`}>
                    <span>Review</span><Icon name="arrow-right" />
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon="check" title="You're all caught up" message="New text and file submissions will appear here for review." />
          )}
        </section>

        <section className="section-block teacher-overview-panel">
          <SectionHeading subtitle={`${todayClasses.length} scheduled`} title="Today's classes" />
          {todayClasses.length ? (
            <div className="teacher-overview-list">
              {todayClasses.map((classItem) => (
                <article className="teacher-class-row" key={classItem.schedule_id}>
                  <div className="teacher-class-row__time">
                    <strong>{formatTime(classItem.start_time)}</strong>
                    <small>{formatTime(classItem.end_time)}</small>
                  </div>
                  <div className="teacher-class-row__body">
                    <strong>{classItem.subject_code} · {classItem.section || 'No section'}</strong>
                    <span>{classItem.subject_name}</span>
                    <small>{classItem.room || 'Room not set'} · {classItem.active_student_count} student{classItem.active_student_count === 1 ? '' : 's'}</small>
                  </div>
                  <div className="teacher-class-row__action">
                    <span className={`overview-status overview-status--${classItem.attendance_status.toLowerCase().replace('_', '-')}`}>
                      {attendanceStatusLabel(classItem.attendance_status)}
                    </span>
                    <Link className="button button--secondary button--compact" to={`/admin/classes?schedule=${classItem.schedule_id}&action=attendance`}>
                      <span>{classItem.attendance_status === 'COMPLETE' ? 'Review' : 'Take attendance'}</span>
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon="calendar" title="No classes today" message="Your next scheduled class will appear here on its meeting day." />
          )}
        </section>
      </div>

      <section className="section-block teacher-recent-panel">
        <SectionHeading subtitle="Latest classroom updates" title="Recent activity" />
        {recentActivity.length ? (
          <div className="teacher-recent-list">
            {recentActivity.map((item) => {
              const target = recentTarget(item)
              const content = <><span aria-hidden="true" className="teacher-overview-row__icon"><Icon name={recentIcon(item.kind)} /></span><span><strong>{item.title}</strong><small>{item.detail} · {formatDateTime(item.occurred_at)}</small></span></>
              return target
                ? <Link className="teacher-recent-item" key={`${item.kind}-${item.id}`} to={target}>{content}<Icon name="arrow-right" /></Link>
                : <div className="teacher-recent-item" key={`${item.kind}-${item.id}`}>{content}</div>
            })}
          </div>
        ) : (
          <p className="admin-empty-line">Classroom activity will appear here as students submit work and attendance is recorded.</p>
        )}
      </section>
    </Page>
  )
}

function overviewSummary(metrics: TeacherDashboard['metrics']) {
  if (metrics.attention_count) {
    return `${metrics.attention_count} submission${metrics.attention_count === 1 ? '' : 's'} need your review today.`
  }
  if (metrics.today_class_count) return `You're caught up on reviews. ${metrics.today_class_count} class${metrics.today_class_count === 1 ? '' : 'es'} on today's schedule.`
  return "You're caught up, with no classes scheduled today."
}

function attendanceStatusLabel(status: AttendanceStatus) {
  return { COMPLETE: 'Complete', IN_PROGRESS: 'In progress', NOT_STARTED: 'Not started' }[status]
}

function recentIcon(kind: RecentActivity['kind']): IconName {
  if (kind === 'ATTENDANCE') return 'calendar'
  if (kind === 'SUBMISSION_REVIEW') return 'grade'
  return 'activity'
}

function recentTarget(item: RecentActivity) {
  if (item.submission_id) return `/admin/submissions/${item.submission_id}`
  if (item.schedule_id) {
    const params = new URLSearchParams({ schedule: String(item.schedule_id) })
    if (item.attendance_session_id) params.set('session', String(item.attendance_session_id))
    return `/admin/attendance?${params.toString()}`
  }
  if (item.module_id) return `/admin/modules/${item.module_id}/edit`
  return null
}
