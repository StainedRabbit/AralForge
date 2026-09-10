# AralForge Legal and Privacy Launch

Last updated: 2026-09-10

Status: **First implementation slice complete. Production clearance remains blocked.**

This document tracks AralForge's Philippines-first legal and privacy launch work. It is an engineering and operational checklist, not legal advice and not a declaration of compliance.

## Confirmed launch scope

- Invitation-only access for the operator's own college students, who are expected to be at least 18 years old.
- No public registration.
- Payment processing, subscriptions, refunds, advertising, analytics, marketing, and marketing trackers are excluded from this launch scope. AralForge is not represented as permanently free; future commercial features require separate legal, product, and technical approval.
- The school is expected to be the primary controller of official student records. Final controller and processor roles for the school, AralForge, and the operator must be established through written school authorization and the applicable data-processing agreement.

## Current architecture and data inventory

AralForge is a React/Vite frontend with a Django REST API. Production planning identifies Cloudflare for frontend delivery and private object storage, Railway for the API and background workers, Supabase PostgreSQL, and Redis-backed background processing. Provider contracts, subprocessors, locations, and transfer safeguards are not yet verified.

The application handles protected personal data including:

- Names, usernames, student numbers, optional email addresses, account roles, status, and password-derived credentials.
- School years, terms, subjects, schedules, sections, class membership, and module access.
- Attendance sessions and individual attendance records.
- Grade items, scores, computed grades, feedback, remarks, and override reasons.
- Assessment questions, student answers, attempts, submission timestamps, progress, and completion history.
- Student-uploaded activity files and teacher-uploaded lesson assets and PDFs.
- Administrative actions, queue jobs, timestamps, application logs, and hosting-layer request metadata.
- Browser storage for JWT access/refresh tokens, lesson and activity drafts, presentation preferences, roster-import result acknowledgments, migrated legacy keys, and the essential-storage notice acknowledgment.

The inventory describes education records as protected personal data. It does not assert that every education-related field has the same statutory classification; the applicable treatment depends on the field, purpose, context, and law.

## Applicable Philippine baseline

- Republic Act No. 10173, the Data Privacy Act of 2012: <https://privacy.gov.ph/data-privacy-act/>
- Implementing Rules and Regulations, including security and breach notification: <https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/>
- National Privacy Commission data-subject rights: <https://privacy.gov.ph/data-subject-rights/>
- NPC guidance on the right to be informed and privacy-notice content: <https://privacy.gov.ph/the-right-to-be-informed/>
- NPC guidance for creating a Privacy Manual: <https://privacy.gov.ph/creating-a-privacy-manual/>
- NPC Circular No. 2022-04 on DPO and Data Processing System registration: <https://privacy.gov.ph/wp-content/uploads/2023/05/Circular-2022-04.pdf>
- NPC Privacy Impact Assessment guide: <https://privacy.gov.ph/wp-content/uploads/2022/01/NPC_PIA_0618.pdf>

## Progress

### Slice 1 — public disclosure foundation

- [x] Confirm launch boundaries and corrected legal positioning.
- [x] Inventory current application data and browser storage.
- [x] Add typed legal configuration with production validation.
- [x] Add public Legal Center and six launch documents.
- [x] Add logged-out, desktop, mobile, and profile legal links.
- [x] Add a non-blocking, reopenable essential-storage notice.
- [x] Add targeted Playwright coverage.
- [x] Run lint, production build, targeted legal tests, and existing navigation/session tests.
- [x] Record final verification results and mark Slice 1 complete.

### Slice 2 — accountable notices and privacy requests

- [ ] Version legal documents and record immutable Terms/AUP agreement and Privacy Notice acknowledgment.
- [ ] Require updated agreement or acknowledgment after material revisions.
- [ ] Add authenticated access, correction, portability, objection, and erasure/blocking requests.
- [ ] Restrict request administration and exports to an ADMIN/DPO role and add audit history.

### Slice 3 — authentication, retention, and governance hardening

- [ ] Move refresh tokens to rotated, revocable Secure/HttpOnly cookies and keep access tokens in memory.
- [ ] Add logout revocation, authentication throttling, CSP, and production security headers.
- [ ] Replace immediate account deletion with deactivation, school-authorized return/export, legal-hold checks, and retention-based purging.
- [ ] Add the school agreement, data-processing agreement, Privacy Manual, PIA, processing/vendor register, retention schedule, rights-request procedure, incident register, and breach workflow.

## Production launch blockers

The site is not cleared for production until all items below are completed and evidenced:

- [ ] Populate the real operator legal name, school name, service address, support email, privacy/DPO email, effective date, and approved retention wording.
- [ ] Obtain written school authorization.
- [ ] Establish final controller/processor roles in the applicable data-processing agreement.
- [ ] Designate and publish the appropriate DPO/privacy contact.
- [ ] Approve a category-specific retention, return, deletion, backup-expiry, and legal-hold schedule.
- [ ] Complete and approve a Privacy Impact Assessment.
- [ ] Assess and complete any required DPO/Data Processing System registration; do not display an NPC seal unless issued.
- [ ] Review provider contracts, subprocessors, hosting regions, security terms, breach-notification terms, and cross-border safeguards.
- [ ] Confirm ownership or permission for all learning materials, brand assets, and uploaded seed content.
- [ ] Complete security and authorization testing with production-equivalent infrastructure.
- [ ] Obtain review and approval from the school and qualified Philippine counsel.

## Verification record

Completed on 2026-09-10:

- `npm run lint` — passed.
- `npm run build` with complete non-placeholder test legal configuration — passed, including TypeScript compilation, Vite production output, and bundle budgets.
- `npm run build` with `VITE_LEGAL_OPERATOR_NAME=replace-me` — rejected as expected by the production legal-configuration gate.
- `npm run test:e2e -- legal.spec.ts mobile-navigation.spec.ts session-recovery.spec.ts rebrand.spec.ts` — 21 passed.

No backend schema or API code changed in Slice 1, so the backend test suite was not required for this slice.
