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
