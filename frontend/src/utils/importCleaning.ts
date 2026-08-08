function cleanSingleLineValue(value: string) {
  return value.trim().replace(/\s+/gu, ' ')
}

export function cleanImportedName(value: string) {
  return cleanSingleLineValue(value).replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase())
}

export function cleanImportedPersonName(value: string) {
  return cleanSingleLineValue(value).replace(
    /(^|[\s\-'\u2019])(\p{L})/gu,
    (_match, boundary: string, letter: string) => `${boundary}${letter.toLocaleUpperCase()}`,
  )
}
