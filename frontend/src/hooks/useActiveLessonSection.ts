import { useEffect, useState } from 'react'

export function useActiveLessonSection(
  container: HTMLElement | null,
  sectionIds: string[],
) {
  const [activeSectionId, setActiveSectionId] = useState(sectionIds[0] ?? '')

  useEffect(() => {
    if (!container || !sectionIds.length) {
      return
    }

    const sections = sectionIds
      .map((sectionId) => container.querySelector<HTMLElement>(`#${sectionId}`))
      .filter((section): section is HTMLElement => Boolean(section))

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((first, second) => first.boundingClientRect.top - second.boundingClientRect.top)[0]

        if (visibleEntry?.target.id) {
          setActiveSectionId(visibleEntry.target.id)
        }
      },
      {
        rootMargin: '-150px 0px -60% 0px',
        threshold: [0, 0.1, 0.5],
      },
    )

    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [container, sectionIds])

  return sectionIds.includes(activeSectionId)
    ? activeSectionId
    : sectionIds[0] ?? ''
}
