import { Link } from 'react-router-dom'
import type { RouteData } from '../app/types'
import { Icon } from '../components/Icon'
import { EmptyState, MetaStrip, Page, PageHeader, SkeletonCard, StatCard } from '../components/ui'
import type { ScheduleStudent, SubjectSchedule } from '../types'
import { getStudentEnrollments, scheduleTime } from '../utils/student'

const dayOrder = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const dayLabels: Record<string, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
}

type ClassEntry = {
  enrollment: ScheduleStudent
  schedule: SubjectSchedule
}

export function ClassesPage({ data }: { data: RouteData }) {
  const entries = getStudentEnrollments(data)
    .map((enrollment) => ({
      enrollment,
      schedule: data.schedules.find((item) => item.id === enrollment.schedule),
    }))
    .filter((entry): entry is ClassEntry => Boolean(entry.schedule))
    .sort(compareClassEntries)
  const activeEntries = entries.filter(
    ({ enrollment, schedule }) => enrollment.is_active && schedule.is_active,
  )
  const pastEntries = entries.filter(
    ({ enrollment, schedule }) => !enrollment.is_active || !schedule.is_active,
  )
  const uniqueSubjects = new Set(activeEntries.map(({ enrollment }) => enrollment.subject))
  const todayCode = browserDayCode()
  const todayCount = activeEntries.filter(({ schedule }) =>
    parseDayCodes(schedule.days).includes(todayCode),
  ).length

  return (
    <Page>
      <PageHeader
        eyebrow="My classes"
        title="Class Schedule"
        description="Review your current meeting schedule and open class-specific learning records."
      />

      <section className="stat-grid student-class-stats">
        <StatCard
          icon="users"
          label="Active classes"
          value={activeEntries.length}
          detail={`${uniqueSubjects.size} subject${uniqueSubjects.size === 1 ? '' : 's'}`}
        />
        <StatCard
          icon="calendar"
          label="Meeting today"
          value={todayCount}
          detail={todayCount ? 'Check the schedule below' : 'No class meetings today'}
        />
      </section>

      <section>
        <div className="student-class-section-heading">
          <div>
            <p className="eyebrow">Current enrollment</p>
            <h2>Active Classes</h2>
          </div>
          <span>{activeEntries.length} class{activeEntries.length === 1 ? '' : 'es'}</span>
        </div>
        <div className="class-grid">
          {data.loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : activeEntries.length ? (
            activeEntries.map((entry) => (
              <StudentClassCard entry={entry} key={entry.enrollment.id} todayCode={todayCode} />
            ))
          ) : (
            <EmptyState
              icon="users"
              title="No active classes"
              message="Your teacher will add your current classes to this page."
            />
          )}
        </div>
      </section>

      {!data.loading && pastEntries.length ? (
        <details className="student-past-classes section-block">
          <summary>
            <span>Past Classes</span>
            <small>{pastEntries.length} archived or inactive</small>
          </summary>
          <div className="class-grid">
            {pastEntries.map((entry) => (
              <StudentClassCard entry={entry} key={entry.enrollment.id} past todayCode={todayCode} />
            ))}
          </div>
        </details>
      ) : null}
    </Page>
  )
}

function StudentClassCard({
  entry,
  past = false,
  todayCode,
}: {
  entry: ClassEntry
  past?: boolean
  todayCode: string
}) {
  const { enrollment, schedule } = entry
  const meetsToday = parseDayCodes(schedule.days).includes(todayCode)

  return (
    <article className={past ? 'class-card class-card--past' : 'class-card'}>
      <div className="module-card__top">
        <span className="subject-chip">{enrollment.subject_code}</span>
        <span className={meetsToday && !past ? 'status-pill status-pill--today' : 'status-pill'}>
          <Icon name="calendar" />
          {meetsToday && !past ? 'Today' : formatClassDays(schedule.days)}
        </span>
      </div>
      <h2>{enrollment.subject_name}</h2>
      <MetaStrip
        items={[
          ['Days', formatClassDays(schedule.days)],
          ['Time', scheduleTime(schedule)],
          ['Section', schedule.section || 'Not set'],
          ['Room', schedule.room || 'Not set'],
          ['Term', enrollment.term_name || schedule.term_name || 'No term'],
        ]}
      />
      {!past ? (
        <div className="class-card__actions">
          <Link className="button button--secondary" to={`/modules?subject=${enrollment.subject}&schedule=${schedule.id}`}>
            <Icon name="book" />
            <span>Open lessons</span>
          </Link>
          <Link className="button button--secondary" to={`/attendance?schedule=${schedule.id}`}>
            <Icon name="check" />
            <span>Attendance</span>
          </Link>
        </div>
      ) : (
        <span className="status-pill">Past class</span>
      )}
    </article>
  )
}

function compareClassEntries(first: ClassEntry, second: ClassEntry) {
  const firstDay = firstScheduleDay(first.schedule.days)
  const secondDay = firstScheduleDay(second.schedule.days)
  return firstDay - secondDay
    || first.schedule.start_time.localeCompare(second.schedule.start_time)
    || first.enrollment.subject_code.localeCompare(second.enrollment.subject_code)
}

function firstScheduleDay(value: string) {
  const codes = parseDayCodes(value)
  return Math.min(...codes.map((code) => dayOrder.indexOf(code)).filter((index) => index >= 0), 7)
}

function parseDayCodes(value: string) {
  const normalized = value.trim().toUpperCase()
  const aliases: Record<string, string> = {
    F: 'FR', FR: 'FR', FRI: 'FR',
    M: 'MO', MO: 'MO', MON: 'MO',
    R: 'TH', TH: 'TH', THU: 'TH',
    S: 'SA', SA: 'SA', SAT: 'SA',
    SU: 'SU', SUN: 'SU',
    T: 'TU', TU: 'TU', TUE: 'TU',
    W: 'WE', WE: 'WE', WED: 'WE',
  }
  const selected = new Set<string>()
  if (/[,\s;/|-]/.test(normalized)) {
    normalized.split(/[,\s;/|-]+/).filter(Boolean).forEach((token) => {
      if (aliases[token]) selected.add(aliases[token])
    })
  } else {
    let index = 0
    while (index < normalized.length) {
      const pair = normalized.slice(index, index + 2)
      if (dayOrder.includes(pair)) {
        selected.add(pair)
        index += 2
      } else {
        const code = aliases[normalized[index]]
        if (code) selected.add(code)
        index += 1
      }
    }
  }
  return dayOrder.filter((code) => selected.has(code))
}

function formatClassDays(value: string) {
  return parseDayCodes(value).map((code) => dayLabels[code]).join(' / ') || 'Days not set'
}

function browserDayCode() {
  return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date().getDay()]
}
