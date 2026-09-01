import type { ModuleLessonExample } from '../types'
import { resolveMediaUrl } from '../utils/format'
import { RichLessonText, ZoomableLessonImage } from './RichLessonText'

type LessonExampleCardData = Pick<
  ModuleLessonExample,
  | 'id'
  | 'order'
  | 'title'
  | 'image'
  | 'alt_text'
  | 'body'
  | 'common_mistake'
  | 'is_published'
>

export function LessonExampleCards({
  examples,
  variant = 'default',
}: {
  examples: LessonExampleCardData[]
  variant?: 'default' | 'presentation'
}) {
  const visibleExamples = examples
    .filter((example) => example.is_published)
    .sort((first, second) => first.order - second.order || first.id - second.id)

  if (!visibleExamples.length) {
    return null
  }

  return (
    <div className={variant === 'presentation' ? 'lesson-example-list lesson-example-list--presentation' : 'lesson-example-list'}>
      {visibleExamples.map((example) => (
        <article className="lesson-example-card" key={example.id}>
          <div>
            <p className="eyebrow">Example {example.order || '-'}</p>
            <h3>{example.title}</h3>
          </div>
          {example.image ? (
            <ZoomableLessonImage
              alt={example.alt_text || example.title}
              caption={example.alt_text}
              className="lesson-example-card__media"
              src={resolveMediaUrl(example.image)}
            />
          ) : null}
          {example.body ? <RichLessonText value={example.body} variant={variant} /> : null}
          {example.common_mistake ? (
            <div className="lesson-example-card__note">
              <strong>Common mistake</strong>
              <RichLessonText value={example.common_mistake} variant={variant} />
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}
