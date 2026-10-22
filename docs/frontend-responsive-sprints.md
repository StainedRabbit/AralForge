# Frontend responsive audit sprints

## Goal and acceptance

Keep the existing workflows intact while making phone, tablet, desktop, wide-screen, landscape, and short-height layouts usable. At each audited viewport, the document must have no horizontal overflow, page content must stay centered in the available desktop area, and primary actions must stay clear of fixed navigation and save bars. Wide tables may scroll inside their own containers.

## Sprint 1 — Header alignment and breakpoint defects

- [x] Align responsive `PageHeader` titles, descriptions, and actions beside the orange marker at widths up to 900px. Preserve the desktop layout and override the higher-specificity Classes rule.
- [x] Add marker, title, description, and action geometry checks at 320, 390, 768, 900, and 901px for student Modules, teacher Classes, the module editor, and Gradebook.
- [x] Make the Gradebook controls use two columns from 901 through 1280px and stack the Gradebook panels from 901 through 1050px.
- [x] Reflow Quiz grading assignments into two columns at narrow desktop widths so the editor stays inside the page.

### Confirmed defects and evidence

| Priority | Route and viewport | Reproduction and observed result | Screenshot | Acceptance check |
| --- | --- | --- | --- | --- |
| P1 | `/modules`, `/admin/classes`, `/admin/modules/:id/edit`; phone and tablet widths through 900px | Open a page with a `PageHeader` at 390 or 768px. The title and sometimes its actions appear centered while the orange marker remains on the left. The Classes rule overrides the shared mobile alignment. | Corrected-layout screenshots: [student Modules](responsive-evidence/student-modules-tablet-768x1024.png), [teacher Classes](responsive-evidence/teacher-classes-tablet-768x1024.png), [module editor](responsive-evidence/teacher-module-editor-mobile-430x932.png). | Title and description share a left edge, actions start at that edge, and all sit to the right of the marker at 320, 390, 768, and 900px. The 901px header keeps its desktop row layout. |
| P1 | `/admin/gradebook`; 901px wide desktop viewport | Open Gradebook with the desktop sidebar at 901px. Its four minimum-width controls exceed the available content area; the document measured 1,079px wide. | [Corrected layout](responsive-evidence/teacher-gradebook-901x844.png). | No document-level horizontal overflow at 901, 1024, 1160, 1161, 1280, or 1281px; controls and panels fit their available width. |
| P1 | `/admin/modules/:moduleId/topics/:topicId/lessons/:lessonId/edit`, Quiz Grading tab; 901px | Open a lesson with a Quiz main activity, select Grading, and resize to 901px. The assignment rows retain wide desktop minimum columns, pushing the document to 1,152px. | [Corrected layout](responsive-evidence/quiz-grading-901x700.png). | The grading heading and assignment rows fit at the audited narrow desktop widths, with no document-level horizontal overflow and usable per-class controls. |

## Sprint 2 — Device and state audit

- [x] Audit login and all six legal pages, the student dashboard, classes, modules, module workspace, activity workspace, attendance, grades, and profile.
- [x] Audit the teacher dashboard, students, classes, attendance, modules, module/topic/lesson editors, presentation, progress, grades, and Gradebook. The submission review empty state is covered; a populated review is covered when a fixture link is available.
- [x] Audit the Quiz grading tab at the same representative device widths.
- [x] Audit the class schedule drawer and the class attendance and scores dialogs.
- [x] Check representative 320, 390, 430, 768, 844 landscape, 900, 901, 1024, 1160, 1161, 1280, 1281, 1440, and 1920px viewports for document overflow and desktop centering. Include a 430×500 short-height state.
- [x] Fix and retest the confirmed Gradebook overflow found at the 900/901px breakpoint.
- [ ] Extend the audit to populated submission review, all Quiz editor tabs, active attendance entry, large roster and long localized text states. Record a defect here only after reproducing it with a route, viewport, steps, screenshot, priority, and acceptance check.
- [ ] Inspect internal table scrolling, clipped text, touch targets, and save or dialog controls for each populated state; fix confirmed defects in priority order and retest.

## Verification

- [x] Add automated responsive route, header, drawer, and dialog geometry checks in `frontend/e2e/responsive-audit.spec.ts`.
- [x] Run `npm run test:e2e -- e2e/responsive-audit.spec.ts` (3 passed).
- [x] Run the responsive audit, `visual-refresh.spec.ts`, and `mobile-navigation.spec.ts` together (7 passed).
- [x] Check the Quiz assignment action remains reachable above the editor save bar at every audited viewport.
- [x] Run `npm run build` in `frontend`.

The automated sweep checks layout geometry. Visual review and interaction checks for the remaining populated states are still required before declaring the whole device audit complete. Do not log unverified CSS risks as defects.
