from collections import defaultdict

from learning_modules.models import (
    ModuleActivity,
    ModuleLesson,
    ModuleLessonAsset,
    ModuleLessonExample,
    ModuleTopic,
)


MODULE_TEXT_FIELDS = (
    ('Description', 'description'),
    ('Content', 'content'),
    ('Learning Objectives', 'learning_objectives'),
    ('Lesson Overview', 'lesson_overview'),
    ('Detailed Discussion', 'detailed_discussion'),
    ('Examples', 'examples'),
    ('Teacher Notes', 'teacher_notes'),
    ('Student Activities', 'student_activities'),
    ('Resources', 'resources'),
)

TOPIC_TEXT_FIELDS = (
    ('Competency Code', 'competency_code'),
    ('Competency Text', 'competency_text'),
    ('Unit', 'unit'),
    ('Overview', 'overview'),
    ('Essential Question', 'essential_question'),
    ('Enduring Understanding', 'enduring_understanding'),
    ('Performance Task', 'performance_task'),
    ('Success Criteria', 'success_criteria'),
    ('Values Focus', 'values_focus'),
)

LESSON_TEXT_FIELDS = (
    ('Learning Targets', 'learning_targets'),
    ('Before You Start', 'before_you_start'),
    ('Short Discussion', 'short_discussion'),
    ('Guided Examples', 'guided_examples'),
    ("Let's Practice", 'lets_practice'),
    ('Challenge Task', 'challenge_task'),
    ('Objectives', 'objectives'),
    ('Overview', 'overview'),
    ('Subtopics', 'subtopics'),
    ('Acquisition', 'acquisition'),
    ('Making Meaning', 'making_meaning'),
    ('Transfer', 'transfer'),
    ('Examples', 'examples'),
    ('Teacher Notes', 'teacher_notes'),
    ('Answer Key', 'answer_key'),
    ('Expected Outputs', 'expected_outputs'),
    ('Common Misconceptions', 'common_misconceptions'),
    ('Teaching Tips', 'teaching_tips'),
    ('Remediation', 'remediation'),
    ('Enrichment', 'enrichment'),
    ('Student Activities', 'student_activities'),
    ('Resources', 'resources'),
)


def module_markdown(module):
    """Return a complete, deterministic Markdown backup for a module."""
    topics = list(ModuleTopic.objects.filter(module=module).order_by('order', 'id'))
    lessons = list(ModuleLesson.objects.filter(
        topic__module=module,
    ).order_by('topic__order', 'topic_id', 'order', 'id'))
    lesson_ids = [lesson.id for lesson in lessons]
    examples_by_lesson = _group_by_lesson(ModuleLessonExample.objects.filter(
        lesson_id__in=lesson_ids,
    ).order_by('lesson_id', 'order', 'id'))
    assets_by_lesson = _group_by_lesson(ModuleLessonAsset.objects.filter(
        lesson_id__in=lesson_ids,
    ).order_by('lesson_id', 'id'))
    activities = list(ModuleActivity.objects.filter(module=module).prefetch_related(
        'questions__choices',
        'questions__matching_pairs',
    ).order_by('topic__order', 'topic_id', 'lesson__order', 'lesson_id', 'order', 'id'))

    lessons_by_topic = defaultdict(list)
    for lesson in lessons:
        lessons_by_topic[lesson.topic_id].append(lesson)
    activities_by_location = defaultdict(list)
    for activity in activities:
        activities_by_location[(activity.topic_id, activity.lesson_id)].append(activity)

    lines = [f'# {module.title}', '']
    _append_status(lines, 'Published', module.is_published)
    _append_text_fields(lines, MODULE_TEXT_FIELDS, module, level=2)
    _append_activities(lines, activities_by_location[(None, None)], level=2)

    for topic_index, topic in enumerate(topics, start=1):
        lines.extend((f'## Topic {topic_index}: {topic.title}', ''))
        _append_status(lines, 'Published', topic.is_published)
        _append_text_fields(lines, TOPIC_TEXT_FIELDS, topic, level=3)
        _append_activities(lines, activities_by_location[(topic.id, None)], level=3)

        for lesson_index, lesson in enumerate(lessons_by_topic[topic.id], start=1):
            lines.extend((f'### Lesson {lesson_index}: {lesson.title}', ''))
            _append_status(lines, 'Published', lesson.is_published)
            _append_text_fields(lines, LESSON_TEXT_FIELDS, lesson, level=4)
            _append_lesson_examples(lines, examples_by_lesson[lesson.id], level=4)
            _append_lesson_assets(lines, assets_by_lesson[lesson.id], level=4)
            _append_activities(lines, activities_by_location[(topic.id, lesson.id)], level=4)

    return '\n'.join(lines).rstrip() + '\n'


def _group_by_lesson(items):
    grouped = defaultdict(list)
    for item in items:
        grouped[item.lesson_id].append(item)
    return grouped


def _append_status(lines, label, value):
    lines.extend((f'- {label}: {"Yes" if value else "No"}', ''))


def _append_text_fields(lines, fields, instance, *, level):
    for label, attribute in fields:
        value = str(getattr(instance, attribute) or '').strip()
        if value:
            lines.extend((f"{'#' * level} {label}", '', value, ''))


def _append_lesson_examples(lines, examples, *, level):
    for index, example in enumerate(examples, start=1):
        lines.extend((f"{'#' * level} Example {index}: {example.title}", ''))
        _append_status(lines, 'Published', example.is_published)
        if example.image:
            alt_text = _escape_image_alt(example.alt_text or example.title)
            lines.extend((f'![{alt_text}]({example.image.url})', ''))
        if example.body.strip():
            lines.extend((example.body.strip(), ''))
        if example.common_mistake.strip():
            lines.extend((f"{'#' * (level + 1)} Common Mistake", '', example.common_mistake.strip(), ''))


def _append_lesson_assets(lines, assets, *, level):
    if not assets:
        return
    lines.extend((f"{'#' * level} Lesson Assets", ''))
    for asset in assets:
        label = asset.original_name or asset.file.name.rsplit('/', 1)[-1]
        suffix = f' "{asset.alt_text}"' if asset.alt_text else ''
        lines.append(f'[{label}]({asset.file.url}{suffix})')
    lines.append('')


def _append_activities(lines, activities, *, level):
    for activity_index, activity in enumerate(activities, start=1):
        lines.extend((f"{'#' * level} Activity {activity_index}: {activity.title}", ''))
        metadata = (
            ('Type', activity.get_activity_type_display()),
            ('Points Possible', activity.points_possible),
            ('Grading Period', activity.grading_period or ''),
            ('Maximum Attempts', activity.max_attempts),
            ('Passing Score', activity.passing_score if activity.passing_score is not None else ''),
            ('Opens At', activity.opens_at.isoformat() if activity.opens_at else ''),
            ('Due At', activity.due_at.isoformat() if activity.due_at else ''),
            ('Allow Late Submissions', activity.allow_late_submissions),
            ('Accepts Text', activity.accepts_text),
            ('Accepts File', activity.accepts_file),
            ('Published', activity.is_published),
        )
        for label, value in metadata:
            if value != '':
                rendered = 'Yes' if isinstance(value, bool) and value else 'No' if isinstance(value, bool) else value
                lines.append(f'- {label}: {rendered}')
        lines.append('')
        if activity.instructions.strip():
            lines.extend((f"{'#' * (level + 1)} Instructions", '', activity.instructions.strip(), ''))
        for question_index, question in enumerate(activity.questions.all(), start=1):
            lines.extend((
                f"{'#' * (level + 1)} Question {question_index}: {question.get_question_type_display()}",
                '',
                question.prompt.strip(),
                '',
                f'- Points: {question.points}',
                f'- Published: {"Yes" if question.is_published else "No"}',
                '',
            ))
            if question.code_snippet.strip():
                _append_code_block(lines, 'Code Snippet', question.code_snippet, level=level + 2)
            if question.expected_output.strip():
                _append_code_block(lines, 'Expected Output', question.expected_output, level=level + 2)
            if question.correct_text_answers:
                lines.extend((
                    f"{'#' * (level + 2)} Correct Text Answers",
                    '',
                    f'- Case Sensitive: {"Yes" if question.case_sensitive else "No"}',
                ))
                lines.extend(f'- {answer}' for answer in question.correct_text_answers)
                lines.append('')
            if question.choices.exists():
                lines.extend((f"{'#' * (level + 2)} Choices", ''))
                for choice in question.choices.all():
                    lines.append(f'- [{"x" if choice.is_correct else " "}] {choice.text}')
                lines.append('')
            if question.matching_pairs.exists():
                lines.extend((f"{'#' * (level + 2)} Matching Pairs", ''))
                for pair in question.matching_pairs.all():
                    lines.append(f'- {pair.left_text} → {pair.right_text}')
                lines.append('')
            if question.explanation.strip():
                lines.extend((f"{'#' * (level + 2)} Explanation", '', question.explanation.strip(), ''))


def _append_code_block(lines, label, value, *, level):
    fence = '```'
    while fence in value:
        fence += '`'
    lines.extend((f"{'#' * level} {label}", '', fence, value.strip(), fence, ''))


def _escape_image_alt(value):
    return value.replace('\\', '\\\\').replace('[', '\\[').replace(']', '\\]')
