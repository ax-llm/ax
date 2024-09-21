const _fetch = async <ARG = unknown, RES = unknown>(
  method: string,
  path: string,
  options?: Readonly<{ arg?: ARG; multiPart?: boolean }>
) => {
  const apiUrl = `/api${path}`;

  let headers = {};

  // if (!options?.arg) {
  //   throw new Error('arg is required')
  // }

  if (!options?.multiPart) {
    headers = { 'Content-Type': 'application/json' };
  }

  const body = options?.multiPart
    ? (options.arg as unknown as FormData)
    : JSON.stringify(options?.arg);

  const res = await fetch(apiUrl, {
    body,
    credentials: 'include',
    headers,
    method
  });

  if (!res.ok) {
    const error = new Error('Data fetching failed') as unknown as {
      info: string;
      status: number;
    };
    error.info = await res.text();
    error.status = res.status;

    throw error;
  }
  return await (res.json() as Promise<RES>);
};

export const getFetch = async <RES = unknown>(url: string) => {
  return await _fetch<unknown, RES>('GET', url);
};

export const postFetch = async <ARG = unknown, RES = unknown>(
  url: string,
  options: Readonly<{ arg: ARG }>
) => {
  const _options = { ...options };
  return await _fetch<ARG, RES>('POST', url, _options);
};

export const postFetchMP = async <RES = unknown>(
  url: string,
  options: Readonly<{ arg: FormData }>
) => {
  const _options = {
    multiPart: true,
    ...options
  };
  return await _fetch<FormData, RES>('POST', url, _options);
};
