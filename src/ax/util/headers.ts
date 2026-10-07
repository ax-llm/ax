/** Merge HTTP headers in precedence order; names are case-insensitive. */
export function mergeHeaders(
  ...groups: readonly (Readonly<Record<string, string>> | undefined)[]
): Record<string, string> {
  const entries = new Map<string, readonly [string, string]>();
  for (const group of groups) {
    for (const [name, value] of Object.entries(group ?? {})) {
      entries.set(name.toLowerCase(), [name, value]);
    }
  }
  return Object.fromEntries(entries.values());
}
