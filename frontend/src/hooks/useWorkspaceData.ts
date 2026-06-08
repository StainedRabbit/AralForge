import { useCallback, useEffect, useState } from 'react'
import { asArray } from '../api'
import type { AuthedRequest, WorkspaceData } from '../app/types'
import { readJwtUserId } from '../services/session'
import type {
  ApiList,
  Answer,
  Assessment,
  AssessmentAttempt,
  AttendanceRecord,
  AttendanceSession,
  Badge,
  Choice,
  CodeSubmission,
  FinalGrade,
  GradeCategory,
  LevelRule,
  Module,
  ModuleAccess,
  ModuleActivity,
  ModuleActivitySubmission,
  ModuleProgress,
  PeriodGrade,
  PointLedger,
  ProgrammingProblem,
  Question,
  ScheduleStudent,
  SchoolYear,
  SchoolYearSemester,
  StudentBadge,
  StudentCategoryGrade,
  StudentProfile,
  Subject,
  SubjectSchedule,
  User,
} from '../types'
import { toErrorMessage } from '../utils/format'

const emptyData: WorkspaceData = {
  users: [],
  currentUser: null,
  profile: null,
  subjects: [],
  schoolYears: [],
  terms: [],
  schedules: [],
  enrollments: [],
  modules: [],
  moduleAccess: [],
  activities: [],
  submissions: [],
  progress: [],
  problems: [],
  codeSubmissions: [],
  assessments: [],
  attempts: [],
  questions: [],
  choices: [],
  answers: [],
  attendanceSessions: [],
  attendanceRecords: [],
  gradeCategories: [],
  categoryGrades: [],
  periodGrades: [],
  finalGrades: [],
  points: [],
  badges: [],
  studentBadges: [],
  levels: [],
  loading: true,
  error: '',
}

export function useWorkspaceData(api: AuthedRequest, accessToken: string) {
  const [state, setState] = useState<WorkspaceData>(emptyData)

  const load = useCallback(async () => {
    const errors: string[] = []

    const [
      users,
      profiles,
      subjects,
      schoolYears,
      terms,
      schedules,
      enrollments,
      modules,
      moduleAccess,
      activities,
      submissions,
      progress,
      problems,
      codeSubmissions,
      assessments,
      attempts,
      questions,
      choices,
      answers,
      attendanceSessions,
      attendanceRecords,
      gradeCategories,
      categoryGrades,
      periodGrades,
      finalGrades,
      points,
      badges,
      studentBadges,
      levels,
    ] = await Promise.all([
      safeLoad<User>(api, '/accounts/users/', errors),
      safeLoad<StudentProfile>(api, '/accounts/students/', errors),
      safeLoad<Subject>(api, '/subjects/subjects/', errors),
      safeLoad<SchoolYear>(api, '/subjects/school-years/', errors),
      safeLoad<SchoolYearSemester>(
        api,
        '/subjects/school-year-semesters/',
        errors,
      ),
      safeLoad<SubjectSchedule>(api, '/subjects/subject-schedules/', errors),
      safeLoad<ScheduleStudent>(api, '/subjects/schedule-students/', errors),
      safeLoad<Module>(api, '/modules/modules/', errors),
      safeLoad<ModuleAccess>(api, '/modules/access/', errors),
      safeLoad<ModuleActivity>(api, '/modules/activities/', errors),
      safeLoad<ModuleActivitySubmission>(api, '/modules/submissions/', errors),
      safeLoad<ModuleProgress>(api, '/modules/progress/', errors),
      safeLoad<ProgrammingProblem>(api, '/coding/problems/', errors),
      safeLoad<CodeSubmission>(api, '/coding/submissions/', errors),
      safeLoad<Assessment>(api, '/assessments/assessments/', errors),
      safeLoad<AssessmentAttempt>(api, '/assessments/attempts/', errors),
      safeLoad<Question>(api, '/assessments/questions/', errors),
      safeLoad<Choice>(api, '/assessments/choices/', errors),
      safeLoad<Answer>(api, '/assessments/answers/', errors),
      safeLoad<AttendanceSession>(api, '/attendance/sessions/', errors),
      safeLoad<AttendanceRecord>(api, '/attendance/records/', errors),
      safeLoad<GradeCategory>(api, '/grades/categories/', errors),
      safeLoad<StudentCategoryGrade>(api, '/grades/student-categories/', errors),
      safeLoad<PeriodGrade>(api, '/grades/periods/', errors),
      safeLoad<FinalGrade>(api, '/grades/finals/', errors),
      safeLoad<PointLedger>(api, '/gamification/points/', errors),
      safeLoad<Badge>(api, '/gamification/badges/', errors),
      safeLoad<StudentBadge>(api, '/gamification/student-badges/', errors),
      safeLoad<LevelRule>(api, '/gamification/levels/', errors),
    ])

    const userId = readJwtUserId(accessToken)
    const currentUser = users.find((user) => user.id === userId) ?? users[0] ?? null
    const profile =
      profiles.find((item) => item.user === currentUser?.id) ?? profiles[0] ?? null

    setState({
      users,
      currentUser,
      profile,
      subjects,
      schoolYears,
      terms,
      schedules,
      enrollments,
      modules,
      moduleAccess,
      activities,
      submissions,
      progress,
      problems,
      codeSubmissions,
      assessments,
      attempts,
      questions,
      choices,
      answers,
      attendanceSessions,
      attendanceRecords,
      gradeCategories,
      categoryGrades,
      periodGrades,
      finalGrades,
      points,
      badges,
      studentBadges,
      levels,
      loading: false,
      error: errors.slice(0, 3).join(' '),
    })
  }, [accessToken, api])

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(loadTimer)
  }, [load])

  return { ...state, refresh: load }
}

async function safeLoad<T>(
  api: AuthedRequest,
  path: string,
  errors: string[],
) {
  try {
    return asArray(await api<ApiList<T>>(path))
  } catch (caughtError) {
    errors.push(`${path}: ${toErrorMessage(caughtError)}`)
    return []
  }
}
