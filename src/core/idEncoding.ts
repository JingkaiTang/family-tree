type IdSeparator = '+' | '|'

const separatorEscape: Record<IdSeparator, string> = { '+': '%2B', '|': '%7C' }

/** Locale collation can equate different IDs; canonical sets need a total order. */
export function compareIds(left: string, right: string): number {
  return left.localeCompare(right) || (left < right ? -1 : left > right ? 1 : 0)
}

/** Keep ordinary IDs stable while encoding every tuple boundary unambiguously. */
export function encodeIdTuple(parts: readonly string[], separator: IdSeparator = '+'): string {
  return parts.map(part => part === '' ? '%e'
    : part.replaceAll('%', '%25').replaceAll(separator, separatorEscape[separator]))
    .join(separator)
}

/** Invalid/noncanonical persisted keys must not be guessed into member identities. */
export function decodeIdTuple(value: string, separator: IdSeparator = '+'): string[] | null {
  if (value === '') return []
  const parts = value.split(separator).map(part => part === '%e' ? ''
    : part.replace(/%25|%2B|%7C/g, escape => escape === '%25' ? '%'
      : escape === '%2B' ? '+' : '|'))
  return encodeIdTuple(parts, separator) === value ? parts : null
}
