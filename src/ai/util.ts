import superagent from 'superagent';

export type API = {
  key: string;
  name: string;
  url: string;
  headers?: any;
};

export const apiCall = <APIType extends API, Request, Response>(
  api: APIType,
  json: Request
): Promise<Response> => {
  const headers = {
    Authorization: `Bearer ${api.key}`,
    ...api.headers,
  };

  return new Promise(function (resolve) {
    return superagent
      .post(new URL(api.name, api.url).href)
      .send(json)
      .set(headers)
      .type('json')
      .accept('json')
      .then(({ body: data }) => resolve(data));
  });
};
