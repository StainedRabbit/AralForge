import type { RouteData } from '../app/types'
import { getApiBaseUrl } from '../api'
import { EmptyState, MetaStrip, Page, PageHeader, SectionHeading } from '../components/ui'
import { formatDateTime } from '../utils/format'
import { fullName, initials } from '../utils/student'

export function ProfilePage({ data }: { data: RouteData }) {
  const user = data.currentUser
  const profile = data.profile

  return (
    <Page>
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Your authenticated user and student profile returned by the Django accounts API."
      />

      <section className="content-grid">
        <div className="profile-panel">
          <div className="profile-avatar">{initials(user)}</div>
          <div>
            <h2>{fullName(user)}</h2>
            <p className="muted">@{user?.username ?? 'user'}</p>
          </div>
          <MetaStrip
            items={[
              ['Role', user?.role ?? 'Unknown'],
              ['Email', user?.email || 'Not set'],
              ['Status', user?.is_active ? 'Active' : 'Inactive'],
              ['API', getApiBaseUrl()],
            ]}
          />
        </div>

        <div className="section-block">
          <SectionHeading subtitle="Student profile details." title="Enrollment" />
          {profile ? (
            <MetaStrip
              stacked
              items={[
                ['Student number', profile.student_number],
                ['Joined', formatDateTime(profile.joined_at)],
              ]}
            />
          ) : (
            <EmptyState
              icon="profile"
              title="No student profile"
              message="Admin and teacher accounts may not have a student profile."
            />
          )}
        </div>
      </section>
    </Page>
  )
}
