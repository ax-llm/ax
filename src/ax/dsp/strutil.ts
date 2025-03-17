const trimNonAlphaNum = (str: string) => {
  return str.replace(/^\W+|\W+$/g, '')
}

const splitIntoTwo = (
  str: string,
  separator: Readonly<RegExp | string>
): string[] => {
  const index = str.search(separator)
  if (index === -1) {
    return [str] // No separator found, return the original string as the only part
  }
  const matchResult = str.match(separator)
  if (!matchResult) {
    throw new Error('Match failed unexpectedly.')
  }
  const firstPart = str.substring(0, index)
  const secondPart = str.substring(index + matchResult[0].length)
  return [firstPart, secondPart]
}

const dedup = (seq: readonly string[]): string[] => {
  const seen = new Set<string>()
  const result: string[] = []

  for (const x of seq) {
    if (!seen.has(x)) {
      seen.add(x)
      result.push(x)
    }
  }

  return result
}

const extractIdAndText = (input: string): { id: number; text: string } => {
  const match = input.match(/^(\d+)[.,\s]+(.*)$/)
  if (!match || match.length < 3) {
    throw new Error(
      'line must start with a number, a dot and then text. e.g. "1. hello"'
    )
  }

  const id = parseInt(match[1] as string, 10)
  const text = (match[2] as string).trim()
  return { id, text }
}

const extractIndexPrefixedText = (input: string): string => {
  const match = input.match(/^(\d+)[.,\s]+(.*)$/)
  // Check if match is not null and if the second capturing group is present
  if (match && match[2] !== undefined) {
    return match[2].trim()
  }
  return input
}

const batchArray = <T>(arr: readonly T[], size: number): T[][] => {
  const chunkedArr: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunkedArr.push(arr.slice(i, i + size))
  }
  return chunkedArr
}

export const AxStringUtil = {
  trimNonAlphaNum,
  splitIntoTwo,
  dedup,
  extractIdAndText,
  extractIndexPrefixedText,
  batchArray,
}
