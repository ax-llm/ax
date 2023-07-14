import superagent from 'superagent';

/**
 * Util: API details
 * @export
 */
export type API = {
  url: string;
  name?: string;
  key?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  headers?: any;
};

export const apiCall = <APIType extends API, Request extends object, Response>(
  api: APIType,
  json: Request
): Promise<Response> => {
  const headers = {
    ...api.headers,
    Authorization: api.key ? `Bearer ${api.key}` : undefined,
  };

  // eslint-disable-next-line no-promise-executor-return
  return new Promise((resolve) => superagent
      .post(api.name ? new URL(api.name, api.url).href : api.url)
      .send(json)
      .set(headers)
      .type('json')
      .accept('json')
      .retry(3)
      .then(({ body: data }) => resolve(data)));
};

export const apiCallWithUpload = <APIType extends API, Request, Response>(
  api: APIType,
  json: Request,
  file: string
): Promise<Response> => {
  const headers = {
    ...api.headers,
    Authorization: api.key ? `Bearer ${api.key}` : undefined,
  };

  if (!file) {
    throw new Error('File is required');
  }

  return new Promise((resolve) => {
    let sa = superagent
      .post(api.name ? new URL(api.name, api.url).href : api.url)
      .retry(3)
      .attach('file', file)
      .set(headers);

    let k: keyof Request;
    // eslint-disable-next-line no-restricted-syntax
    for (k in json) {
      if (json[k]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sa = sa.field(k, json[k] as any);
      }
    }

    // eslint-disable-next-line no-promise-executor-return
    return sa.then(({ body: data }) => resolve(data));
  });
};
