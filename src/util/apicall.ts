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
  put?: boolean;
};

export const apiCall = async <
  Request extends object,
  Response,
  APIType extends API = API
>(
  api: APIType,
  json: Request | string
): Promise<Response> => {
  const useProxy =
    process.env.LLMCLIENT_PROXY ?? process.env.LLMC_PROXY === 'true';

  const isDev = process.env.DEV_MODE === 'true';

  const baseUrl = useProxy
    ? isDev
      ? 'http://127.0.0.1'
      : 'https://proxy.llmclient.com'
    : api.url;
  const apiPath = api.name ?? '/';
  const apiUrl = new URL(apiPath, baseUrl).toString();

  const headers = {
    ...api.headers,
    Authorization: api.key ? `Bearer ${api.key}` : undefined,
  };

  const request = api.put ? superagent.put(apiUrl) : superagent.post(apiUrl);

  const res = await request
    .send(json)
    .set(headers)
    .type('json')
    .accept('json')
    .retry(3)
    .catch(httpError(apiUrl, json));

  return res.body;
};

export const apiCallWithUpload = async <Request, Response, APIType extends API>(
  api: APIType,
  json: Request,
  file: string
): Promise<Response> => {
  if (!file) {
    throw new Error('File is required');
  }

  const headers = {
    ...api.headers,
    Authorization: api.key ? `Bearer ${api.key}` : undefined,
  };

  const baseUrl = api.url;
  const apiPath = api.name ?? '/';
  const apiUrl = new URL(apiPath, baseUrl).toString();

  const data = await superagent
    .post(apiUrl)
    .retry(3)
    .attach('file', file)
    .set(headers)
    .field(json as { [fieldName: string]: string })
    .catch(httpError(apiUrl));

  return data.body;
};

export const httpError =
  (apiUrl: string, json?: unknown) =>
  ({
    response,
    code,
    syscall,
    address,
    port,
  }: Readonly<{
    response: superagent.Response;
    code: unknown;
    syscall: unknown;
    address: unknown;
    port: unknown;
  }>) => {
    if (!response) {
      throw {
        apiUrl,
        code,
        syscall,
        address,
        port,
        request: json,
      };
    }

    const { headers, status, body } = response;
    throw {
      apiUrl,
      statusCode: status,
      headers,
      request: json,
      response: body,
    };
  };
