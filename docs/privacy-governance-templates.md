# AralForge School Privacy Governance Pack

Status: internal working templates for school DPO and Philippine counsel review. Do not commit signatures, personal contact details, provider credentials, completed incident records, or executed agreements. Store signed copies in the school's approved records system and record only document version, approval date, and custodian in the launch register.

## Privacy and data-processing addendum

Complete this addendum against the dean's existing written authorization.

1. Parties and authority: identify the school, AralForge operator, signatories, and the instrument establishing each signatory's authority.
2. Roles: state the agreed personal information controller/personal information processor allocation for each processing activity. The launch position is that the school is expected to control official student records, subject to this written allocation.
3. Instructions and purpose: invitation-only teaching, class administration, attendance, learning activities, private draft grading, explicit grade publication, student support, security, and privacy-rights handling.
4. Authorized data: identity and student number; class membership; attendance; answers, submissions and uploads; progress; draft and published grades; account/security and audit metadata. Birth dates are excluded.
5. Data subjects: institutionally verified invited college students attested by an administrator to be at least 18, plus authorized staff.
6. Recipients and subprocessors: list Cloudflare, Railway, Supabase/PostgreSQL, Redis and object-storage providers only after contract, region, subprocessor and transfer review.
7. Security: least privilege, assigned-class authorization, DPO separation, encrypted transport/storage, private object storage, token rotation/revocation, throttling, logs, tested backup/restore, vulnerability handling and staff access procedures.
8. Overseas processing: document locations, transfer basis and safeguards; require advance notice and review of material location or subprocessor changes.
9. Rights: route access, correction, portability, objection and erasure/blocking requests to the school DPO; AralForge assists and does not independently deny a request.
10. Incidents: define reporting channel, immediate containment duties, evidence preservation, decision authority, contractual notification interval and NPC/data-subject notification responsibilities.
11. Retention/return/deletion: attach the approved category schedule; require verified official-record transfer, export SHA-256, DPO approval, legal-hold checks, dry run, approved purge and backup expiry evidence.
12. Audit and assistance: authorize proportionate audit evidence, PIA cooperation, regulator cooperation and secure return at termination.
13. End of service: deactivate access, revoke sessions, return/export authorized records, preserve holds, purge approved copies, and certify completion without retaining educational content.
14. Liability, governing law, precedence, term and signatures: counsel to complete.

## Processing and vendor register

For each activity record: owner; purpose; data fields; data subjects; source; legal basis identified by counsel/DPO; systems; recipients; provider and subprocessors; processing regions; transfer safeguards; access roles; retention rule; security controls; incident contact; agreement version; review date.

Do not mark a provider approved until the school has reviewed its data-processing terms, confidentiality, security commitments, deletion/return behavior, breach notice, subprocessor changes, regions and cross-border safeguards.

## Privacy Impact Assessment worksheet

Record the project scope and data flow; necessity and proportionality; student expectations; grading and academic-impact risks; unauthorized teacher/student/DPO access; account takeover; insecure uploads; accidental publication; cross-border/vendor risk; retention and backup risk; minors; incident scenarios; existing controls; likelihood/impact before and after controls; control owner; due date; evidence; residual-risk acceptance and DPO approval.

Required diagrams/evidence should cover browser, Cloudflare delivery, Railway API/worker, Supabase PostgreSQL, Redis, private object storage, logs/backups, school export channel, privacy-request flow, and purge flow.

## Category retention schedule

The DPO must supply durations; developers must not choose them. Record a separate rule and trigger for accounts, class membership, attendance, answers/attempts, uploads, progress, draft grades, published snapshots, exports, audit/security logs, privacy requests, incidents, legal acknowledgments, caches and backups. Each rule needs an owner, justification, official-record destination, legal-hold behavior, deletion method, backup expiry and completion evidence.

## Rights-request procedure

1. Student submits a request in AralForge or an established official school channel.
2. DPO acknowledges and verifies identity using proportionate information already held.
3. DPO assigns, assesses exceptions and records the decision; internal notes remain DPO/admin restricted.
4. Administrator performs only the approved export, correction, deactivation or purge.
5. DPO verifies completion and communicates through the official channel.
6. Preserve immutable public status history and audit events; do not place unnecessary personal data in notes.

## Incident and breach procedure

Immediately contain access, preserve logs, rotate/revoke affected credentials, identify data/people/systems/time range, notify the DPO and school incident lead, assess harm and notification duties, coordinate provider evidence, document decisions and remediation, and conduct a post-incident review. Only the authorized school/DPO team communicates with students, the NPC, providers or the public.

Incident register fields: incident ID; reporter/time; systems; data categories; affected people estimate; containment; evidence custodian; provider tickets; risk assessment; notification decision and times; recovery validation; root cause; corrective actions; owner; closure approval.

## Approval register (metadata only)

| Document | Version | Approval date | Approver role | Custodian/location reference | Next review |
|---|---|---|---|---|---|
| Dean authorization | | | Dean/authorized signatory | Off-repository | |
| Privacy/data-processing addendum | | | School + operator | Off-repository | |
| Privacy Manual | | | DPO/school | Off-repository | |
| PIA | | | DPO/risk owner | Off-repository | |
| Retention schedule | | | DPO/school | Off-repository | |
| Vendor register | | | DPO/procurement | Off-repository | |
| Incident procedure | | | DPO/security | Off-repository | |
| Counsel review | | | Philippine counsel | Off-repository | |
