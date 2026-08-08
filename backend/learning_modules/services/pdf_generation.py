import os
import logging
import re
from pathlib import Path
from urllib.parse import unquote, urlparse

from django.conf import settings
from django.core.files.base import ContentFile
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.text import slugify

from learning_modules.models import ModuleActivity


logger = logging.getLogger(__name__)

LESSON_SECTION_FIELDS = (
    ("What We'll Learn", ('learning_targets', 'objectives')),
    ('Before We Start', ('before_you_start',)),
    ("Let's Understand", ('short_discussion', 'overview')),
    ("Let's Practice", ('lets_practice',)),
    ('Challenge Task', ('challenge_task',)),
    ('Student Activities', ('student_activities',)),
    ('Resources / References', ('resources',)),
)


def generate_module_pdf(module):
    module = module.__class__.objects.select_related('subject').prefetch_related(
        'topics__lessons__lesson_examples',
        'activities',
        'subjects',
    ).get(pk=module.pk)
    topics = list(module.topics.filter(is_published=True).order_by('order', 'id'))
    activities_by_topic = {}
    for activity in module.activities.filter(
        is_published=True,
        lesson_id__isnull=True,
    ).order_by('order', 'id'):
        activities_by_topic.setdefault(activity.topic_id, []).append(activity)

    rendered_topics = []
    for topic in topics:
        lessons = [
            lesson_context(lesson)
            for lesson in topic.lessons.filter(is_published=True).order_by('order', 'id')
        ]
        rendered_topics.append({
            'activities': [
                activity_context(activity)
                for activity in activities_by_topic.get(topic.id, [])
            ],
            'lessons': lessons,
            'meta': compact_join(topic.unit, topic.competency_code),
            'sections': [
                content_section('Overview', topic.overview),
                content_section('Essential Question', topic.essential_question),
                content_section('Performance Task', topic.performance_task),
                content_section('Success Criteria', topic.success_criteria),
            ],
            'title': topic.title,
        })

    module_level_activities = [
        activity_context(activity)
        for activity in module.activities.filter(
            is_published=True,
            topic_id__isnull=True,
        ).order_by('order', 'id')
    ]

    return render_pdf_to_model(
        module,
        f'{slugify(module.slug or module.title) or "module"}-printable.pdf',
        {
            'context_label': subject_label(module),
            'generated_at': timezone.now(),
            'kind': 'module',
            'module': module,
            'module_level_activities': module_level_activities,
            'sections': [
                content_section('Description', module.description),
                content_section('Content', module.content),
                content_section('Learning Objectives', module.learning_objectives),
                content_section('Lesson Overview', module.lesson_overview),
                content_section('Detailed Discussion', module.detailed_discussion),
                content_section('Examples', module.examples),
                content_section('Student Activities', module.student_activities),
                content_section('Resources / References', module.resources),
            ],
            'title': module.title,
            'topics': rendered_topics,
        },
    )


def generate_lesson_pdf(lesson):
    lesson = lesson.__class__.objects.select_related(
        'topic',
        'topic__module',
        'topic__module__subject',
    ).prefetch_related('lesson_examples').get(pk=lesson.pk)
    module = lesson.topic.module

    return render_pdf_to_model(
        lesson,
        f'{slugify(lesson.title) or "lesson"}-printable.pdf',
        {
            'context_label': compact_join(subject_label(module), module.title, lesson.topic.title),
            'generated_at': timezone.now(),
            'kind': 'lesson',
            'lesson': lesson_context(lesson),
            'module': module,
            'title': lesson.title,
            'topics': [],
        },
    )


def render_pdf_to_model(instance, filename, context):
    html = render_to_string('learning_modules/printable_pdf.html', context)
    logger.debug(
        'Printable PDF final HTML for %s %s before WeasyPrint:\n%s',
        instance.__class__.__name__,
        instance.pk,
        html,
    )
    pdf_bytes = render_pdf(html)
    instance.pdf_file.save(filename, ContentFile(pdf_bytes), save=False)
    instance.pdf_generated_at = timezone.now()
    instance.pdf_is_outdated = False
    instance.save(update_fields=['pdf_file', 'pdf_generated_at', 'pdf_is_outdated'])
    return instance


def render_pdf(html):
    add_weasyprint_dll_directory()
    try:
        from weasyprint import HTML
    except ImportError as error:
        raise RuntimeError(
            'WeasyPrint is not installed. Install requirements.txt and the '
            'native libraries required by WeasyPrint before generating PDFs.'
        ) from error

    return HTML(string=html, base_url=str(settings.BASE_DIR)).write_pdf()


def add_weasyprint_dll_directory():
    dll_directory = os.getenv('WEASYPRINT_DLL_DIRECTORIES')
    candidates = [dll_directory] if dll_directory else []
    candidates.append(r'C:\msys64\mingw64\bin')
    for candidate in candidates:
        if candidate and os.path.isdir(candidate):
            os.add_dll_directory(candidate)
            return


def lesson_context(lesson):
    examples = [
        {
            'body': markdown_html(example.body),
            'common_mistake': markdown_html(example.common_mistake),
            'image': media_file_context(example.image, example.alt_text or example.title),
            'title': example.title,
        }
        for example in lesson.lesson_examples.filter(is_published=True).order_by('order', 'id')
    ]
    sections = lesson_sections(lesson)
    if examples:
        sections.insert(4, {
            'content': '',
            'examples': examples,
            'title': "Let's Look at Examples",
        })

    return {
        'assessment_url': lesson.assessment_url,
        'examples': examples,
        'main_activity': main_activity_context(lesson),
        'order': lesson.order,
        'sections': sections,
        'title': lesson.title,
    }


def lesson_sections(lesson):
    sections = []
    for title, fields in LESSON_SECTION_FIELDS:
        content = first_value(lesson, fields)
        if content:
            sections.append(content_section(title, content))
    return sections


def activity_context(activity):
    return {
        'activity_type': activity.get_activity_type_display(),
        'instructions': markdown_html(activity.instructions),
        'questions': activity_questions_context(activity),
        'title': activity.title,
    }


def main_activity_context(lesson):
    activity = ModuleActivity.objects.filter(
        lesson=lesson,
        activity_type=ModuleActivity.ActivityType.INTERACTIVE,
        is_published=True,
    ).first()
    if not activity:
        return None
    return activity_context(activity)


def activity_questions_context(activity):
    return [
        activity_question_context(question)
        for question in activity.questions.filter(is_published=True)
        .prefetch_related('choices', 'matching_pairs')
        .order_by('order', 'id')
    ]


def activity_question_context(question):
    choices = list(question.choices.all())
    pairs = list(question.matching_pairs.all())
    context = {
        'choices': [],
        'code_snippet': question.code_snippet,
        'matching_options': [],
        'matching_prompts': [],
        'prompt': markdown_html(question.prompt),
        'question_type': question.get_question_type_display(),
    }

    if question.question_type in {
        question.QuestionType.MULTIPLE_CHOICE,
        question.QuestionType.TRUE_FALSE,
    }:
        context['choices'] = [
            choice.text
            for choice in sorted(choices, key=lambda choice: (choice.order, choice.id))
        ]
    elif question.question_type == question.QuestionType.ORDERING:
        context['choices'] = [
            choice.text
            for choice in sorted(choices, key=lambda choice: (choice.text.lower(), choice.id))
        ]
    elif question.question_type == question.QuestionType.MATCHING:
        context['matching_prompts'] = [
            pair.left_text
            for pair in sorted(pairs, key=lambda pair: (pair.order, pair.id))
        ]
        context['matching_options'] = [
            pair.right_text
            for pair in sorted(pairs, key=lambda pair: (pair.right_text.lower(), pair.id))
        ]

    return context


def content_section(title, value):
    if not value:
        return None
    return {
        'content': markdown_html(value),
        'title': title,
    }


def first_value(instance, fields):
    for field in fields:
        value = getattr(instance, field, '')
        if isinstance(value, str) and value.strip():
            return value
    return ''


def markdown_html(value):
    if not value:
        return ''
    try:
        import bleach
        import markdown
        from bleach.css_sanitizer import CSSSanitizer
    except ImportError as error:
        raise RuntimeError(
            'Markdown and bleach are required before generating printable PDFs.'
        ) from error

    normalized = normalize_markdown(value)
    logger.debug('Printable PDF normalized Markdown before conversion:\n%s', normalized)

    html = markdown.markdown(
        normalized,
        extensions=['extra', 'sane_lists', 'tables', 'fenced_code'],
        output_format='html5',
    )
    allowed_tags = set(bleach.sanitizer.ALLOWED_TAGS) | {
        'br',
        'code',
        'del',
        'div',
        'figcaption',
        'figure',
        'h1',
        'h2',
        'h3',
        'h4',
        'hr',
        'img',
        'p',
        'pre',
        'span',
        'svg',
        'table',
        'tbody',
        'td',
        'th',
        'thead',
        'tr',
        'use',
    }
    svg_tags = {
        'circle',
        'clipPath',
        'defs',
        'ellipse',
        'g',
        'line',
        'linearGradient',
        'marker',
        'mask',
        'path',
        'polygon',
        'polyline',
        'rect',
        'stop',
        'text',
        'title',
        'tspan',
    }
    allowed_tags |= svg_tags
    svg_attrs = [
        'aria-hidden',
        'aria-labelledby',
        'class',
        'clip-path',
        'cx',
        'cy',
        'd',
        'fill',
        'fill-opacity',
        'font-family',
        'font-size',
        'font-weight',
        'height',
        'id',
        'marker-end',
        'markerHeight',
        'markerUnits',
        'markerWidth',
        'mask',
        'offset',
        'orient',
        'points',
        'preserveAspectRatio',
        'r',
        'refX',
        'refY',
        'role',
        'rx',
        'ry',
        'stroke',
        'stroke-linecap',
        'stroke-width',
        'style',
        'text-anchor',
        'transform',
        'viewBox',
        'width',
        'x',
        'x1',
        'x2',
        'xlink:href',
        'xmlns',
        'xmlns:xlink',
        'y',
        'y1',
        'y2',
    ]
    allowed_attrs = {
        **bleach.sanitizer.ALLOWED_ATTRIBUTES,
        'a': ['href', 'title'],
        'img': ['alt', 'src', 'title'],
        **{tag: svg_attrs for tag in svg_tags | {'svg', 'use'}},
        'th': ['align'],
        'td': ['align'],
    }
    cleaned = bleach.clean(
        html,
        attributes=allowed_attrs,
        css_sanitizer=CSSSanitizer(
            allowed_css_properties=[
                'color',
                'fill',
                'fill-opacity',
                'font-family',
                'font-size',
                'font-weight',
                'height',
                'stroke',
                'stroke-linecap',
                'stroke-width',
                'width',
            ],
        ),
        protocols=['http', 'https', 'mailto', 'file', 'data'],
        strip=True,
        tags=allowed_tags,
    )
    rewritten = rewrite_image_sources(cleaned)
    logger.debug('Printable PDF rendered Markdown HTML before WeasyPrint:\n%s', rewritten)
    return rewritten


def normalize_markdown(value):
    text = str(value).replace('\r\n', '\n').replace('\r', '\n')
    lines = text.split('\n')
    normalized = []
    in_fence = False

    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('```'):
            in_fence = not in_fence
            normalized.append(line)
            continue

        if not in_fence:
            previous = normalized[-1] if normalized else ''
            next_line = lines[index + 1] if index + 1 < len(lines) else ''

            if is_markdown_image_line(line) and previous.strip():
                normalized.append('')

            if is_markdown_list_item(line) and previous.strip() and not is_markdown_list_item(previous):
                normalized.append('')

            normalized.append(line)

            if is_markdown_image_line(line) and next_line.strip():
                normalized.append('')
            elif (
                is_markdown_list_item(line)
                and next_line.strip()
                and not is_markdown_list_item(next_line)
            ):
                normalized.append('')
            continue

        normalized.append(line)

    return '\n'.join(normalized).strip()


def is_markdown_list_item(line):
    return bool(re.match(r'^\s*(?:[-*+]\s+|\d+[.)]\s+)', line))


def is_markdown_image_line(line):
    return bool(re.match(r'^\s*!\[[^\]]*\]\([^)]+\)\s*$', line))


def rewrite_image_sources(html):
    return re.sub(
        r'(<img\b[^>]*?\bsrc=["\'])([^"\']+)(["\'][^>]*>)',
        replace_image_source,
        html,
        flags=re.IGNORECASE,
    )


def replace_image_source(match):
    prefix, source, suffix = match.groups()
    resolved = resolve_media_source(source)
    if not resolved:
        logger.warning('PDF image source could not be resolved: %s', source)
        return (
            '<p class="pdf-missing-media">'
            f'Image unavailable: {escape_html(source)}'
            '</p>'
        )
    logger.debug('PDF image source resolved: %s -> %s', source, resolved)
    return f'{prefix}{resolved}{suffix}'


def media_file_context(file_field, alt_text=''):
    if not file_field:
        return None
    source = resolve_media_source(file_field.url or file_field.name)
    if not source:
        logger.warning('PDF uploaded media file could not be resolved: %s', file_field.name)
        return {
            'alt_text': alt_text,
            'missing': True,
            'name': file_field.name,
            'src': '',
        }
    return {
        'alt_text': alt_text,
        'missing': False,
        'name': file_field.name,
        'src': source,
    }


def resolve_media_source(source):
    source = unquote((source or '').strip())
    if not source:
        return ''

    parsed = urlparse(source)
    if parsed.scheme in {'http', 'https', 'data', 'file'}:
        return source

    path = parsed.path or source
    candidate_paths = []
    media_url = settings.MEDIA_URL if settings.MEDIA_URL.startswith('/') else f'/{settings.MEDIA_URL}'
    if path.startswith(media_url):
        candidate_paths.append(Path(settings.MEDIA_ROOT) / path.removeprefix(media_url).lstrip('/\\'))
    if path.startswith('/media/'):
        candidate_paths.append(Path(settings.MEDIA_ROOT) / path.removeprefix('/media/').lstrip('/\\'))
    if path.startswith('/lesson-assets/'):
        candidate_paths.append(settings.BASE_DIR.parent / 'frontend' / 'public' / path.lstrip('/\\'))
    if path.startswith('lesson-assets/'):
        candidate_paths.append(settings.BASE_DIR.parent / 'frontend' / 'public' / path)
    candidate_paths.append(Path(settings.MEDIA_ROOT) / path.lstrip('/\\'))
    candidate_paths.append(settings.BASE_DIR.parent / 'frontend' / 'public' / path.lstrip('/\\'))
    candidate_paths.append(settings.BASE_DIR / path.lstrip('/\\'))

    for candidate in candidate_paths:
        if candidate.exists():
            return candidate.resolve().as_uri()

    return ''


def escape_html(value):
    return (
        value.replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
        .replace("'", '&#x27;')
    )


def subject_label(module):
    if module.subject:
        return compact_join(module.subject.code, module.subject.name)
    subjects = list(module.subjects.all())
    if subjects:
        return compact_join(subjects[0].code, subjects[0].name)
    return ''


def compact_join(*values):
    return ' / '.join(str(value) for value in values if value)
