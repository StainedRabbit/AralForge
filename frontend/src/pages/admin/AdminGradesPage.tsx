import { useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthedRequest, WorkspaceData } from '../../app/types'
import {
  AdminResourcePanel,
  type AdminField,
} from '../../components/admin/AdminResourcePanel'
import { Icon } from '../../components/Icon'
import { Page, PageHeader, SectionHeading } from '../../components/ui'
import type {
  Badge,
  FinalGrade,
  GradeCategory,
  GradingTemplate,
  GradingTemplateItem,
  LevelRule,
  PeriodGrade,
  PointLedger,
  StudentBadge,
  StudentCategoryGrade,
} from '../../types'
import {
  badgeName,
  booleanLabel,
  compactDateTime,
  gradeCategoryName,
  gradeCategoryOptions,
  gradingPeriodOptions,
  gradingTemplateName,
  pointSourceOptions,
  studentUsers,
  subjectName,
  templateItemName,
  toOptions,
  userName,
} from '../../admin/adminHelpers'
import { displayScore, numeric, toErrorMessage } from '../../utils/format'
import { fullName } from '../../utils/student'

export function AdminGradesPage({
  api,
  data,
  refresh,
}: {
  api: AuthedRequest
  data: WorkspaceData
  refresh: () => Promise<void>
}) {
  const subjectOptions = toOptions(
    data.subjects,
    (subject) => subject.id,
    (subject) => `${subject.code} ${subject.name}`,
  )
  const studentOptions = toOptions(studentUsers(data.users), (user) => user.id, fullName)
  const templateOptions = toOptions(
    data.gradingTemplates,
    (template) => template.id,
    (template) => template.name,
  )
  const templateItemOptions = toOptions(
    data.gradingTemplateItems,
    (item) => item.id,
    (item) => templateItemName(data.gradingTemplateItems, item.id),
  )
  const gradeCategoryOptionsList = toOptions(
    data.gradeCategories,
    (category) => category.id,
    (category) => gradeCategoryName(data.gradeCategories, data.subjects, category.id),
  )
  const badgeOptions = toOptions(data.badges, (badge) => badge.id, (badge) => badge.name)

  return (
    <Page>
      <PageHeader
        eyebrow="Grades and rewards"
        title="Grades"
        description="Configure grade structures, record scores, compute grade records, and maintain gamified rewards."
      />

      <ApplyTemplatePanel
        api={api}
        onRefresh={refresh}
        subjectOptions={subjectOptions}
        templateOptions={templateOptions}
      />

      <AdminResourcePanel<GradingTemplate>
        api={api}
        columns={[
          { header: 'Name', render: (template) => template.name },
          { header: 'Default', render: (template) => booleanLabel(template.is_default) },
          { header: 'Items', render: (template) => template.items.length },
        ]}
        endpoint="/grades/templates/"
        fields={templateFields}
        getSearchText={(template) => `${template.name} ${template.description}`}
        items={data.gradingTemplates}
        noun="Template"
        onRefresh={refresh}
        title="Grading Templates"
      />

      <AdminResourcePanel<GradingTemplateItem>
        api={api}
        columns={[
          { header: 'Template', render: (item) => gradingTemplateName(data.gradingTemplates, item.template) },
          { header: 'Period', render: (item) => item.grading_period },
          { header: 'Category', render: (item) => item.category },
          { header: 'Weight', render: (item) => `${numeric(item.weight)}%` },
        ]}
        endpoint="/grades/template-items/"
        fields={templateItemFields(templateOptions)}
        getSearchText={(item) => `${item.name} ${item.category} ${item.grading_period}`}
        items={data.gradingTemplateItems}
        noun="Template item"
        onRefresh={refresh}
        title="Template Items"
      />

      <AdminResourcePanel<GradeCategory>
        api={api}
        columns={[
          { header: 'Subject', render: (category) => subjectName(data.subjects, category.subject) },
          { header: 'Period', render: (category) => category.grading_period },
          { header: 'Name', render: (category) => category.name },
          { header: 'Weight', render: (category) => `${numeric(category.weight)}%` },
        ]}
        endpoint="/grades/categories/"
        fields={gradeCategoryFields(subjectOptions, templateItemOptions)}
        getSearchText={(category) =>
          `${category.name} ${category.category} ${category.grading_period}`
        }
        items={data.gradeCategories}
        noun="Grade category"
        onRefresh={refresh}
        title="Grade Categories"
      />

      <AdminResourcePanel<StudentCategoryGrade>
        api={api}
        columns={[
          { header: 'Student', render: (grade) => userName(data.users, grade.student) },
          { header: 'Category', render: (grade) => gradeCategoryName(data.gradeCategories, data.subjects, grade.grade_category) },
          { header: 'Raw', render: (grade) => `${numeric(grade.raw_score)}/${numeric(grade.total_score)}` },
          { header: 'Transmuted', render: (grade) => displayScore(grade.transmuted_grade) },
          { header: 'Weighted', render: (grade) => displayScore(grade.weighted_score) },
        ]}
        endpoint="/grades/student-categories/"
        fields={studentCategoryGradeFields(subjectOptions, studentOptions, gradeCategoryOptionsList)}
        getSearchText={(grade) =>
          `${userName(data.users, grade.student)} ${gradeCategoryName(data.gradeCategories, data.subjects, grade.grade_category)}`
        }
        items={data.categoryGrades}
        noun="Student category grade"
        onRefresh={refresh}
        title="Student Category Grades"
      />

      <AdminResourcePanel<PeriodGrade>
        api={api}
        columns={[
          { header: 'Student', render: (grade) => userName(data.users, grade.student) },
          { header: 'Subject', render: (grade) => subjectName(data.subjects, grade.subject) },
          { header: 'Period', render: (grade) => grade.grading_period },
          { header: 'Raw score', render: (grade) => displayScore(grade.raw_score) },
          { header: 'Computed', render: (grade) => compactDateTime(grade.computed_at) },
        ]}
        endpoint="/grades/periods/"
        fields={periodGradeFields(subjectOptions, studentOptions)}
        getSearchText={(grade) =>
          `${userName(data.users, grade.student)} ${subjectName(data.subjects, grade.subject)} ${grade.grading_period}`
        }
        items={data.periodGrades}
        noun="Period grade"
        onRefresh={refresh}
        title="Period Grades"
      />

      <AdminResourcePanel<FinalGrade>
        api={api}
        columns={[
          { header: 'Student', render: (grade) => userName(data.users, grade.student) },
          { header: 'Subject', render: (grade) => subjectName(data.subjects, grade.subject) },
          { header: 'Final', render: (grade) => displayScore(grade.final_grade) },
          { header: 'Remarks', render: (grade) => grade.remarks || 'None' },
        ]}
        endpoint="/grades/finals/"
        fields={finalGradeFields(subjectOptions, studentOptions)}
        getSearchText={(grade) =>
          `${userName(data.users, grade.student)} ${subjectName(data.subjects, grade.subject)} ${grade.remarks}`
        }
        items={data.finalGrades}
        noun="Final grade"
        onRefresh={refresh}
        title="Final Grades"
      />

      <AdminResourcePanel<PointLedger>
        api={api}
        columns={[
          { header: 'Student', render: (point) => userName(data.users, point.student) },
          { header: 'Source', render: (point) => point.source },
          { header: 'Points', render: (point) => point.points },
          { header: 'Created', render: (point) => compactDateTime(point.created_at) },
        ]}
        endpoint="/gamification/points/"
        fields={pointFields(studentOptions)}
        getSearchText={(point) => `${point.source} ${point.description}`}
        items={data.points}
        noun="Point entry"
        onRefresh={refresh}
        title="Point Ledger"
      />

      <AdminResourcePanel<Badge>
        api={api}
        columns={[
          { header: 'Name', render: (badge) => badge.name },
          { header: 'Required', render: (badge) => badge.points_required },
          { header: 'Active', render: (badge) => booleanLabel(badge.is_active) },
        ]}
        endpoint="/gamification/badges/"
        fields={badgeFields}
        getSearchText={(badge) => `${badge.name} ${badge.description} ${badge.icon}`}
        items={data.badges}
        noun="Badge"
        onRefresh={refresh}
        title="Badges"
      />

      <AdminResourcePanel<StudentBadge>
        api={api}
        columns={[
          { header: 'Student', render: (badge) => userName(data.users, badge.student) },
          { header: 'Badge', render: (badge) => badgeName(data.badges, badge.badge) },
          { header: 'Awarded', render: (badge) => compactDateTime(badge.awarded_at) },
        ]}
        endpoint="/gamification/student-badges/"
        fields={studentBadgeFields(studentOptions, badgeOptions)}
        getSearchText={(badge) =>
          `${userName(data.users, badge.student)} ${badgeName(data.badges, badge.badge)}`
        }
        items={data.studentBadges}
        noun="Student badge"
        onRefresh={refresh}
        title="Student Badges"
      />

      <AdminResourcePanel<LevelRule>
        api={api}
        columns={[
          { header: 'Level', render: (level) => level.level },
          { header: 'Name', render: (level) => level.name },
          { header: 'Points required', render: (level) => level.points_required },
        ]}
        endpoint="/gamification/levels/"
        fields={levelFields}
        getSearchText={(level) => `${level.level} ${level.name}`}
        items={data.levels}
        noun="Level rule"
        onRefresh={refresh}
        title="Level Rules"
      />
    </Page>
  )
}

function ApplyTemplatePanel({
  api,
  onRefresh,
  subjectOptions,
  templateOptions,
}: {
  api: AuthedRequest
  onRefresh: () => Promise<void>
  subjectOptions: { label: string; value: number | string }[]
  templateOptions: { label: string; value: number | string }[]
}) {
  const [templateId, setTemplateId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  async function applyTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      await api(`/grades/templates/${templateId}/apply-to-subject/`, {
        body: JSON.stringify({ subject: Number(subjectId) }),
        method: 'POST',
      })
      setMessage('Template applied.')
      await onRefresh()
    } catch (caughtError) {
      setMessage(toErrorMessage(caughtError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-resource section-block">
      <SectionHeading subtitle="Sync template items into one subject." title="Apply Template" />
      <form className="admin-inline-form" onSubmit={applyTemplate}>
        <label className="admin-field">
          <span>Template</span>
          <select
            onChange={(event) => setTemplateId(event.target.value)}
            required
            value={templateId}
          >
            <option value="">Select</option>
            {templateOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Subject</span>
          <select
            onChange={(event) => setSubjectId(event.target.value)}
            required
            value={subjectId}
          >
            <option value="">Select</option>
            {subjectOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button className="button button--primary" disabled={saving} type="submit">
          <Icon name="save" />
          <span>{saving ? 'Applying...' : 'Apply'}</span>
        </button>
        {message ? <p className="admin-message">{message}</p> : null}
      </form>
    </section>
  )
}

const templateFields: AdminField<GradingTemplate>[] = [
  { label: 'Name', name: 'name', required: true, type: 'text' },
  { label: 'Description', name: 'description', rows: 3, type: 'textarea' },
  { defaultValue: false, label: 'Default', name: 'is_default', type: 'checkbox' },
]

function templateItemFields(templateOptions: { label: string; value: number | string }[]) {
  return [
    {
      label: 'Template',
      name: 'template',
      options: templateOptions,
      parse: Number,
      required: true,
      type: 'select',
    },
    { defaultValue: 'PRELIM', label: 'Period', name: 'grading_period', options: gradingPeriodOptions, required: true, type: 'select' },
    { defaultValue: 'QUIZ', label: 'Category', name: 'category', options: gradeCategoryOptions, required: true, type: 'select' },
    { label: 'Name', name: 'name', required: true, type: 'text' },
    { defaultValue: '0.00', label: 'Weight', name: 'weight', required: true, type: 'number' },
  ] satisfies AdminField<GradingTemplateItem>[]
}

function gradeCategoryFields(
  subjectOptions: { label: string; value: number | string }[],
  templateItemOptions: { label: string; value: number | string }[],
) {
  return [
    { label: 'Subject', name: 'subject', options: subjectOptions, parse: Number, required: true, type: 'select' },
    {
      label: 'Template item',
      name: 'template_item',
      nullable: true,
      options: templateItemOptions,
      parse: (value) => (value ? Number(value) : null),
      type: 'select',
    },
    { defaultValue: 'PRELIM', label: 'Period', name: 'grading_period', options: gradingPeriodOptions, required: true, type: 'select' },
    { defaultValue: 'QUIZ', label: 'Category', name: 'category', options: gradeCategoryOptions, required: true, type: 'select' },
    { label: 'Name', name: 'name', required: true, type: 'text' },
    { defaultValue: '0.00', label: 'Weight', name: 'weight', required: true, type: 'number' },
  ] satisfies AdminField<GradeCategory>[]
}

function studentCategoryGradeFields(
  subjectOptions: { label: string; value: number | string }[],
  studentOptions: { label: string; value: number | string }[],
  categoryOptions: { label: string; value: number | string }[],
) {
  return [
    { label: 'Subject', name: 'subject', options: subjectOptions, parse: Number, required: true, type: 'select' },
    { label: 'Student', name: 'student', options: studentOptions, parse: Number, required: true, type: 'select' },
    { label: 'Grade category', name: 'grade_category', options: categoryOptions, parse: Number, required: true, type: 'select' },
    { defaultValue: '0.00', label: 'Raw score', name: 'raw_score', type: 'number' },
    { defaultValue: '0.00', label: 'Total score', name: 'total_score', type: 'number' },
  ] satisfies AdminField<StudentCategoryGrade>[]
}

function periodGradeFields(
  subjectOptions: { label: string; value: number | string }[],
  studentOptions: { label: string; value: number | string }[],
) {
  return [
    { label: 'Subject', name: 'subject', options: subjectOptions, parse: Number, required: true, type: 'select' },
    { label: 'Student', name: 'student', options: studentOptions, parse: Number, required: true, type: 'select' },
    { defaultValue: 'PRELIM', label: 'Period', name: 'grading_period', options: gradingPeriodOptions, required: true, type: 'select' },
    { label: 'Remarks', name: 'remarks', type: 'text' },
  ] satisfies AdminField<PeriodGrade>[]
}

function finalGradeFields(
  subjectOptions: { label: string; value: number | string }[],
  studentOptions: { label: string; value: number | string }[],
) {
  return [
    { label: 'Subject', name: 'subject', options: subjectOptions, parse: Number, required: true, type: 'select' },
    { label: 'Student', name: 'student', options: studentOptions, parse: Number, required: true, type: 'select' },
    { label: 'Prelim', name: 'prelim_grade', nullable: true, type: 'number' },
    { label: 'Midterm', name: 'midterm_grade', nullable: true, type: 'number' },
    { label: 'Prefinal', name: 'prefinal_grade', nullable: true, type: 'number' },
    { label: 'Final period', name: 'final_period_grade', nullable: true, type: 'number' },
    { label: 'Remarks', name: 'remarks', type: 'text' },
  ] satisfies AdminField<FinalGrade>[]
}

function pointFields(studentOptions: { label: string; value: number | string }[]) {
  return [
    { label: 'Student', name: 'student', options: studentOptions, parse: Number, required: true, type: 'select' },
    { defaultValue: 'MANUAL', label: 'Source', name: 'source', options: pointSourceOptions, required: true, type: 'select' },
    { defaultValue: '0', label: 'Points', name: 'points', required: true, type: 'number' },
    { label: 'Description', name: 'description', type: 'text' },
  ] satisfies AdminField<PointLedger>[]
}

const badgeFields: AdminField<Badge>[] = [
  { label: 'Name', name: 'name', required: true, type: 'text' },
  { label: 'Description', name: 'description', rows: 3, type: 'textarea' },
  { label: 'Icon', name: 'icon', type: 'text' },
  { defaultValue: '0', label: 'Points required', name: 'points_required', type: 'number' },
  { defaultValue: true, label: 'Active', name: 'is_active', type: 'checkbox' },
]

function studentBadgeFields(
  studentOptions: { label: string; value: number | string }[],
  badgeOptions: { label: string; value: number | string }[],
) {
  return [
    { label: 'Student', name: 'student', options: studentOptions, parse: Number, required: true, type: 'select' },
    { label: 'Badge', name: 'badge', options: badgeOptions, parse: Number, required: true, type: 'select' },
  ] satisfies AdminField<StudentBadge>[]
}

const levelFields: AdminField<LevelRule>[] = [
  { label: 'Level', name: 'level', required: true, type: 'number' },
  { label: 'Name', name: 'name', required: true, type: 'text' },
  { label: 'Points required', name: 'points_required', required: true, type: 'number' },
]
