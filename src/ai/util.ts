import superagent from 'superagent';

/**
 * Util: API details
 * @export
 */
export type API = {
  url: string;
  name?: string;
  key?: string;
  headers?: any;
};

export const apiCall = <APIType extends API, Request extends object, Response>(
  api: APIType,
  json: Request
): Promise<Response> => {
  const headers = {
    ...api.headers,
  };
  if (api.key) {
    headers.Authorization = `Bearer ${api.key}`;
  }

  return new Promise(function (resolve) {
    return superagent
      .post(api.name ? new URL(api.name, api.url).href : api.url)
      .send(json)
      .set(headers)
      .type('json')
      .accept('json')
      .retry(3)
      .then(({ body: data }) => resolve(data));
  });
};

export const apiCallWithUpload = <APIType extends API, Request, Response>(
  api: APIType,
  json: Request,
  file: string
): Promise<Response> => {
  const headers = {
    Authorization: `Bearer ${api.key}`,
    ...api.headers,
  };

  if (!file) {
    throw new Error('File is required');
  }

  return new Promise(function (resolve) {
    let sa = superagent
      .post(api.name ? new URL(api.name, api.url).href : api.url)
      .retry(3)
      .attach('file', file)
      .set(headers);

    let k: keyof Request;
    for (k in json) {
      if (json[k]) {
        sa = sa.field(k, json[k] as any);
      }
    }

    return sa.then(({ body: data }) => resolve(data));
  });
};
