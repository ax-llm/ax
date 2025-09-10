export async function fetchJSON<T>(
  url: string,
  headers?: Record<string, string>
): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok)
    throw new Error(`HTTP ${res.status} fetching ${url}: ${res.statusText}`);
  return (await res.json()) as T;
}

export function toQuery(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) usp.set(k, v);
  }
  return usp.toString();
}

export function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
