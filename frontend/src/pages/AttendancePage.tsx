import type { WorkspaceData } from '../app/types'
import { EmptyState, Page, PageHeader, SectionHeading, SkeletonList, StatCard } from '../components/ui'
import { attendanceStatusLabel, attendanceSummary, hasActiveSubjectAccess, subjectLabel } from '../utils/student'
import { formatDate, numeric } from '../utils/format'

export function AttendancePage({ data }: { data: WorkspaceData }) {
  const activeAttendanceRecords = data.attendanceRecords.filter((record) => {
    const session = data.attendanceSessions.find((item) => item.id === record.session)
    return session ? hasActiveSubjectAccess(data, session.subject) : true
  })
  const summary = attendanceSummary(activeAttendanceRecords)
  const totalAttendancePoints = activeAttendanceRecords.reduce(
    (sum, record) => sum + numeric(record.points_earned),
    0,
  )

  return (
    <Page>
      <PageHeader
        eyebrow="Presence record"
        title="Attendance"
        description="Review attendance status, earned points, remarks, and session notes by subject."
      />

      <section className="stat-grid">
        <StatCard
          icon="check"
          label="Present"
          value={summary.present}
          detail={`${summary.rate}% attendance rate`}
        />
        <StatCard
          icon="calendar"
          label="Late or excused"
          value={summary.late + summary.excused}
          detail={`${summary.late} late, ${summary.excused} excused`}
        />
        <StatCard
          icon="warning"
          label="Absent"
          value={summary.absent}
          detail="Recorded absences"
        />
        <StatCard
          icon="spark"
          label="Points earned"
          value={totalAttendancePoints.toFixed(1)}
          detail="Attendance score"
        />
      </section>

      <section className="section-block">
        <SectionHeading
          subtitle={`${activeAttendanceRecords.length} recorded session${activeAttendanceRecords.length === 1 ? '' : 's'}`}
          title="Attendance History"
        />
        <div className="attendance-list">
          {data.loading ? (
            <SkeletonList count={5} />
          ) : activeAttendanceRecords.length ? (
            activeAttendanceRecords.map((record) => {
              const session = data.attendanceSessions.find(
                (item) => item.id === record.session,
              )

              return (
                <article className="attendance-row" key={record.id}>
                  <span className={`attendance-status attendance-status--${record.status.toLowerCase()}`}>
                    {attendanceStatusLabel(record.status)}
                  </span>
                  <div>
                    <strong>
                      {session ? subjectLabel(data, session.subject) : 'Attendance session'}
                    </strong>
                    <span>
                      {session?.title || 'Class meeting'} ·{' '}
                      {session?.date ? formatDate(session.date) : 'No date'}
                    </span>
                    {record.remarks || session?.notes ? (
                      <small>{record.remarks || session?.notes}</small>
                    ) : null}
                  </div>
                  <strong className="attendance-points">
                    {numeric(record.points_earned).toFixed(1)} pts
                  </strong>
                </article>
              )
            })
          ) : (
            <EmptyState
              icon="calendar"
              title="No attendance records"
              message="Attendance records for your active classes will appear here."
            />
          )}
        </div>
      </section>
    </Page>
  )
}
