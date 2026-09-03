export type ImportedTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

export type DecodedTextFile = {
  encoding: ImportedTextEncoding
  text: string
  usedCompatibilityFallback: boolean
}

const UTF8_BOM = [0xef, 0xbb, 0xbf]
const UTF16_LE_BOM = [0xff, 0xfe]
const UTF16_BE_BOM = [0xfe, 0xff]

function startsWithBytes(bytes: Uint8Array, signature: number[]) {
  return signature.every((byte, index) => bytes[index] === byte)
}

function decode(bytes: Uint8Array, encoding: ImportedTextEncoding, fatal = false) {
  return new TextDecoder(encoding, { fatal }).decode(bytes)
}

export async function decodeTextFile(file: Blob): Promise<DecodedTextFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())

  if (startsWithBytes(bytes, UTF8_BOM)) {
    return {
      encoding: 'utf-8',
      text: decode(bytes, 'utf-8'),
      usedCompatibilityFallback: false,
    }
  }

  if (startsWithBytes(bytes, UTF16_LE_BOM)) {
    return {
      encoding: 'utf-16le',
      text: decode(bytes, 'utf-16le'),
      usedCompatibilityFallback: false,
    }
  }

  if (startsWithBytes(bytes, UTF16_BE_BOM)) {
    return {
      encoding: 'utf-16be',
      text: decode(bytes, 'utf-16be'),
      usedCompatibilityFallback: false,
    }
  }

  try {
    return {
      encoding: 'utf-8',
      text: decode(bytes, 'utf-8', true),
      usedCompatibilityFallback: false,
    }
  } catch {
    return {
      encoding: 'windows-1252',
      text: decode(bytes, 'windows-1252'),
      usedCompatibilityFallback: true,
    }
  }
}

export function countReplacementCharacters(text: string) {
  let count = 0
  for (const character of text) {
    if (character === '\uFFFD') count += 1
  }
  return count
}

export function replacementCharacterWarning(count: number) {
  return `Found ${count} unknown replacement character${count === 1 ? '' : 's'} (\uFFFD). Correct ${count === 1 ? 'it' : 'them'} before continuing.`
}

export function compatibilityEncodingNotice(filename: string) {
  return `${filename} was decoded using Windows-1252 compatibility mode. Review its punctuation before applying the import.`
}
