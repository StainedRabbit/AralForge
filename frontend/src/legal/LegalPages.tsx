import type { ReactNode } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { BrandMark } from '../components/navigation'
import { LegalLinks } from './LegalLinks'
import { LEGAL_DOCUMENT_VERSION, legalConfig, STORAGE_NOTICE_KEY } from './legalConfig'

type LegalDocumentProps = {
  children: ReactNode
  description: string
  title: string
}

export function LegalRoutes() {
  return (
    <Routes>
      <Route index element={<LegalCenter />} />
      <Route path="privacy" element={<PrivacyNotice />} />
      <Route path="terms" element={<TermsOfUse />} />
      <Route path="storage" element={<StorageNotice />} />
      <Route path="acceptable-use" element={<AcceptableUse />} />
      <Route path="copyright" element={<CopyrightPolicy />} />
      <Route path="accessibility" element={<AccessibilityStatement />} />
      <Route path="*" element={<Navigate to="/legal" replace />} />
    </Routes>
  )
}

function LegalCenter() {
  const cards = [
    ['/legal/privacy', 'Privacy Notice', 'How AralForge handles protected personal data and supports privacy rights.'],
    ['/legal/terms', 'Terms of Use', 'Rules for invitation-only access to the learning platform.'],
    ['/legal/storage', 'Cookie and Browser Storage Notice', 'The essential browser storage used in this launch.'],
    ['/legal/acceptable-use', 'Acceptable Use', 'Academic integrity, safety, and responsible-use expectations.'],
    ['/legal/copyright', 'Copyright and Takedown', 'Ownership, limited licenses, and reporting concerns.'],
    ['/legal/accessibility', 'Accessibility and Contact', 'Accessibility goals, known limitations, and help channels.'],
  ] as const

  return (
    <LegalDocument title="Legal and privacy center" description="Plain-language information for AralForge students, teachers, schools, and visitors.">
      <div className="legal-card-grid">
        {cards.map(([to, title, description]) => (
          <Link className="legal-card" key={to} to={to}>
            <strong>{title}</strong>
            <span>{description}</span>
          </Link>
        ))}
      </div>
      <LegalCallout>
        These documents are implementation drafts pending written school authorization, confirmation of the parties’ privacy roles,
        approved retention terms, and Philippine legal review. They do not claim that AralForge has completed every launch requirement.
      </LegalCallout>
    </LegalDocument>
  )
}

function PrivacyNotice() {
  return (
    <LegalDocument title="Privacy Notice" description="How AralForge collects, uses, shares, retains, and protects personal data.">
      <LegalCallout>
        The school is expected to be the primary controller of official student records. The final controller and processor roles of
        {` ${legalConfig.schoolName}`} and {legalConfig.operatorName} must be established in written school authorization and the applicable data-processing agreement.
      </LegalCallout>
      <LegalSection title="Who operates AralForge">
        <p>Service operator: {legalConfig.operatorName}</p>
        <p>Expected school/controller: {legalConfig.schoolName}</p>
        {legalConfig.serviceAddress ? <p>Service address: {legalConfig.serviceAddress}</p> : null}
        <p>Privacy contact: <PrivacyContact /></p>
      </LegalSection>
      <LegalSection title="Personal data we handle">
        <ul>
          <li>Identity and account data, such as names, usernames, student numbers, email addresses when provided, roles, and account status.</li>
          <li>Class and education records, including subjects, schedules, enrollment, attendance, grades, feedback, assessment answers, learning progress, and activity history.</li>
          <li>Student and teacher content, including written responses, uploaded files, lesson materials, and administrative notes.</li>
          <li>Security and technical data needed to deliver and protect the service, such as authentication records, timestamps, request metadata, error logs, and device/browser information available to hosting providers.</li>
          <li>Essential browser storage described in the Cookie and Browser Storage Notice.</li>
        </ul>
        <p>These records are protected personal data. Their precise legal treatment depends on the data item, purpose, context, and applicable law.</p>
      </LegalSection>
      <LegalSection title="Where the data comes from and why we use it">
        <p>Data may come from the school, authorized teachers or administrators, the student, and activity generated through use of AralForge.</p>
        <p>It is used to provide accounts and classes; deliver lessons and assessments; record attendance, progress, and grades; review submissions; secure and troubleshoot the service; meet school and legal obligations; handle requests and disputes; and maintain reliable backups.</p>
        <p>Applicable processing grounds must be documented by the school and operator. Privacy acknowledgment is not presented as blanket consent, and optional future uses require their own lawful basis and review.</p>
      </LegalSection>
      <LegalSection title="Who may receive or process data">
        <p>Access is limited to the student, authorized school personnel, the service operator, and contracted providers that support hosting and storage. Current infrastructure categories include Cloudflare frontend and private object storage, Railway application and worker hosting, Supabase PostgreSQL, and Redis/background processing. Provider contracts, locations, subprocessors, and transfer safeguards must be verified before production.</p>
        <p>AralForge does not sell student data. Advertising, analytics, marketing trackers, payment processing, subscriptions, refunds, and public registration are excluded from this launch scope. Future commercial features require separate review and approval.</p>
      </LegalSection>
      <LegalSection title="Retention and security">
        <p>{legalConfig.retentionPolicy}</p>
        <p>AralForge uses role-based access, private media storage with time-limited links, password protections, encrypted network transport in production, backups, and restricted administrative access. No online service can promise perfect security or uninterrupted availability.</p>
      </LegalSection>
      <LegalSection title="Your privacy rights">
        <p>Subject to applicable law and the school’s records obligations, individuals may request information, access, correction, portability, objection, or erasure/blocking and may file a complaint with the Philippine National Privacy Commission. Some records may need to be retained or handled by the school rather than deleted immediately.</p>
        <p>Submit requests through <PrivacyContact />. The requester’s identity and authority may need to be verified before protected records are released or changed.</p>
      </LegalSection>
    </LegalDocument>
  )
}

function TermsOfUse() {
  return (
    <LegalDocument title="Terms of Use" description="The conditions for using this invitation-only educational service.">
      <LegalSection title="Eligibility and accounts">
        <p>This launch is for invited college students, teachers, and administrators who are at least 18 years old. There is no public registration. Users must provide accurate account information, keep credentials private, and promptly report suspected account misuse.</p>
      </LegalSection>
      <LegalSection title="Educational service">
        <p>AralForge supports lessons, activities, attendance, grading, and progress tracking under the school’s authorized educational arrangements. It does not replace official school policies, teacher judgment, required records systems, or appeal procedures.</p>
        <p>Payment processing, subscriptions, refunds, advertising, analytics, marketing, and public registration are outside this launch scope. Any future commercial feature requires separate review and approval.</p>
      </LegalSection>
      <LegalSection title="Your content and AralForge content">
        <p>Students and schools retain ownership of content they lawfully provide. They grant only the limited permission needed to host, reproduce, display, back up, and process that content for the authorized educational service. This permission ends when the content is lawfully deleted, subject to backups, school instructions, and legal retention.</p>
        <p>AralForge software, branding, and original learning materials remain owned by their respective rights holders. Access does not transfer ownership or permit redistribution, resale, scraping, or creation of competing content collections.</p>
      </LegalSection>
      <LegalSection title="Availability, suspension, and responsibility">
        <p>Users must comply with the Acceptable Use Policy. Access may be limited or suspended to protect users, investigate misuse, comply with school instructions or law, or maintain the service. When practical, affected users and the school will be informed.</p>
        <p>The service is provided with reasonable care but without a promise of uninterrupted operation, perfect security, or particular academic results. Nothing in these terms excludes rights or liabilities that cannot lawfully be excluded.</p>
      </LegalSection>
      <LegalSection title="Questions and applicable rules">
        <p>These terms are governed by applicable Philippine law together with controlling school policies and agreements. Service concerns should first be sent through <SupportContact />; privacy complaints should use <PrivacyContact />. Statutory complaint and court rights remain available.</p>
      </LegalSection>
    </LegalDocument>
  )
}

function StorageNotice() {
  return (
    <LegalDocument title="Cookie and Browser Storage Notice" description="What AralForge currently stores in your browser and why.">
      <LegalCallout>AralForge uses essential storage only in this launch. There are no advertising, analytics, or marketing trackers.</LegalCallout>
      <LegalSection title="Current browser storage">
        <ul>
          <li>A rotated refresh credential is stored in a Secure, HttpOnly cookie so an invited user can remain signed in. JavaScript cannot read this cookie. The short-lived access token is held only in memory and disappears when the page closes or reloads.</li>
          <li><code>aralforge:lesson-draft:*</code> and <code>aralforge.main-activity-draft.*</code> protect authorized editing work from accidental loss.</li>
          <li><code>aralforge:presentation-text-size</code> remembers a presentation display preference.</li>
          <li><code>aralforge:roster-import-acknowledged:*</code> prevents an administrator from being shown the same completed roster-import result repeatedly.</li>
          <li><code>{STORAGE_NOTICE_KEY}</code> remembers the version of this notice acknowledged on the device.</li>
        </ul>
      </LegalSection>
      <LegalSection title="Cookies and hosting controls">
        <p>The student-facing application does not set optional cookies in this launch. It uses only authentication and request-security cookies. Infrastructure providers may use strictly necessary security or delivery controls. Their exact production behavior must be verified and this notice updated before deployment.</p>
      </LegalSection>
      <LegalSection title="Your controls">
        <p>You may clear site data through your browser. Clearing authentication data signs you out, and clearing unsaved drafts may permanently remove them from that device. Essential storage cannot be disabled through a preference toggle without preventing the associated feature from working.</p>
      </LegalSection>
    </LegalDocument>
  )
}

function AcceptableUse() {
  return (
    <LegalDocument title="Acceptable Use and Academic Integrity" description="Rules that help keep AralForge safe, fair, and useful.">
      <LegalSection title="Use AralForge for authorized learning">
        <p>Use only your assigned account and authorized classes. Follow school rules, teacher instructions, assessment conditions, and applicable law. Do not impersonate another person or share credentials.</p>
      </LegalSection>
      <LegalSection title="Prohibited conduct">
        <ul>
          <li>Cheating, unauthorized collaboration, answer sharing, plagiarism, or misrepresenting authorship.</li>
          <li>Harassment, threats, discrimination, exploitation, or publication of another person’s protected information.</li>
          <li>Uploading malware, unlawful material, secrets, unnecessary personal data, or content you have no right to use.</li>
          <li>Bypassing access controls, probing for vulnerabilities without written authorization, disrupting service, scraping records, or accessing another user’s data.</li>
        </ul>
      </LegalSection>
      <LegalSection title="Reports and enforcement">
        <p>Report safety or security concerns through <SupportContact />. Suspected violations may be preserved and referred to authorized school personnel, investigated proportionately, and handled under school procedures and applicable law.</p>
      </LegalSection>
    </LegalDocument>
  )
}

function CopyrightPolicy() {
  return (
    <LegalDocument title="Copyright and Takedown Policy" description="How ownership is respected and concerns are reported.">
      <LegalSection title="Ownership and permitted use">
        <p>AralForge branding, software, and original materials are protected by their respective rights. School, teacher, and student submissions remain owned by their lawful owners. Content may be used inside AralForge only as needed for authorized teaching, learning, review, storage, backup, and administration.</p>
      </LegalSection>
      <LegalSection title="Report a concern">
        <p>Send a sufficiently detailed notice through <SupportContact /> identifying the protected work, the AralForge material or location at issue, your contact details, the basis of your claim, and any authority to act for the owner. Do not include unrelated personal data.</p>
      </LegalSection>
      <LegalSection title="Review and response">
        <p>The operator may restrict access while reviewing a credible report, consult the school or uploader, request supporting information, restore material when appropriate, and preserve records needed to resolve the issue. Knowingly false or abusive notices may violate these terms or applicable law.</p>
      </LegalSection>
    </LegalDocument>
  )
}

function AccessibilityStatement() {
  return (
    <LegalDocument title="Accessibility and Contact" description="How to request help accessing AralForge or its legal information.">
      <LegalSection title="Our approach">
        <p>AralForge aims to support keyboard navigation, readable contrast, responsive layouts, clear labels, and assistive-technology semantics. This statement does not claim formal certification or that every page is free of barriers.</p>
      </LegalSection>
      <LegalSection title="Request assistance">
        <p>If a feature, file, assessment, or legal document is difficult to access, contact <SupportContact />. Include the page or task, the barrier encountered, and the format or accommodation that would help. Avoid sending passwords or unnecessary protected records.</p>
      </LegalSection>
      <LegalSection title="Other contacts">
        {legalConfig.serviceAddress ? <p>Service address: {legalConfig.serviceAddress}</p> : null}
        <p>Privacy matters: <PrivacyContact /></p>
      </LegalSection>
    </LegalDocument>
  )
}

function LegalDocument({ children, description, title }: LegalDocumentProps) {
  return (
    <div className="legal-site">
      <header className="legal-site__header">
        <BrandMark compact />
        <Link className="button button--secondary" to="/">Return to AralForge</Link>
      </header>
      <main className="legal-document">
        <div className="legal-document__heading">
          <p className="eyebrow">Legal and privacy</p>
          <h1>{title}</h1>
          <p>{description}</p>
          <div className="legal-document__meta">
            <span>Effective {legalConfig.effectiveDate}</span>
            <span>Version {LEGAL_DOCUMENT_VERSION}</span>
            <span>Launch draft</span>
          </div>
        </div>
        <div className="legal-document__body">{children}</div>
      </main>
      <footer className="legal-site__footer">
        <LegalLinks />
        <p>
          Support: <SupportContact />
          {' · '}
          Privacy: <PrivacyContact />
        </p>
        <p>© {new Date().getFullYear()} {legalConfig.operatorName}. Legal rights are reserved where applicable.</p>
      </footer>
    </div>
  )
}

function LegalSection({ children, title }: { children: ReactNode; title: string }) {
  return <section className="legal-section"><h2>{title}</h2>{children}</section>
}

function LegalCallout({ children }: { children: ReactNode }) {
  return <div className="legal-callout">{children}</div>
}

function SupportContact() {
  return legalConfig.supportEmail
    ? <a href={`mailto:${legalConfig.supportEmail}`}>{legalConfig.supportEmail}</a>
    : <>your school administrator or established official school channel</>
}

function PrivacyContact() {
  return legalConfig.privacyEmail
    ? <a href={`mailto:${legalConfig.privacyEmail}`}>{legalConfig.privacyEmail}</a>
    : <>your school administrator or established official school privacy channel</>
}
