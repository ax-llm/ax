import superagent from 'superagent';
/**
 * Util: API details
 * @export
 */
export type API = {
  name?: string;
  headers?: Record<string, string>;
  put?: boolean;
};

export const apiCall = async <Request = unknown, Response = unknown>(
  api: Readonly<API & { url: string }>,
  json: Request
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

  const headers = api.headers;
  const request = api.put ? superagent.put(apiUrl) : superagent.post(apiUrl);

  try {
    const res = await request
      .send(json as object)
      .set(headers ?? {})
      .type('json')
      .accept('json')
      .retry(3);
    return res.body;
  } catch (e) {
    const err = e as SuperAgentError;
    throw httpError(`apiCall:`, apiUrl, json, err);
  }
};

export const apiCallWithUpload = async <
  Request,
  Response,
  APIType extends API & { url: string }
>(
  api: Readonly<APIType>,
  json: Request,
  file: string
): Promise<Response> => {
  if (!file) {
    throw new Error('File is required');
  }

  const headers = api.headers;
  const baseUrl = api.url;
  const apiPath = api.name ?? '/';
  const apiUrl = new URL(apiPath, baseUrl).toString();

  try {
    const data = await superagent
      .post(apiUrl)
      .retry(3)
      .attach('file', file)
      .set(headers ?? {})
      .field(json as { [fieldName: string]: string });

    return data.body;
  } catch (e) {
    throw httpError('apiCallWithUpload', apiUrl, null, e as SuperAgentError);
  }
};

export type SuperAgentError = {
  response: superagent.Response;
  code: unknown;
  syscall: unknown;
  address: unknown;
  port: unknown;
  request: unknown;
};

export const httpError = (
  message: string,
  apiUrl: string,
  json: unknown,
  { response, code, syscall, address, port }: Readonly<SuperAgentError>
) => {
  const err = new Error(message) as Error & { data: unknown };

  if (!response) {
    err.data = {
      apiUrl,
      code,
      syscall,
      address,
      port,
      request: json
    };
    return err;
  }

  const { headers, status, body } = response;
  err.data = {
    apiUrl,
    statusCode: status,
    headers,
    request: json,
    response: body,
    error: body.error
  };
  return err;
};
