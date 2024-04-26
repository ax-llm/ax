export const trimNonAlphaNum = (str: string) => {
  return str.replace(/^\W+|\W+$/g, '');
};

export const splitIntoTwo = (
  str: string,
  separator: Readonly<RegExp | string>
): string[] => {
  const index = str.search(separator);
  if (index === -1) {
    return [str]; // No separator found, return the original string as the only part
  }
  const matchResult = str.match(separator);
  if (!matchResult) {
    throw new Error('Match failed unexpectedly.');
  }
  const firstPart = str.substring(0, index);
  const secondPart = str.substring(index + matchResult[0].length);
  return [firstPart, secondPart];
};

export const dedup = (seq: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const x of seq) {
    if (!seen.has(x)) {
      seen.add(x);
      result.push(x);
    }
  }

  return result;
};
