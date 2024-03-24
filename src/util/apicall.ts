import path from 'path';

import { JSONStringifyStream } from './transform.js';
/**
 * Util: API details
 * @export
 */
export type API = {
  name?: string;
  headers?: Record<string, string>;
  put?: boolean;
};

export const apiCall = async <TRequest = unknown, TResponse = unknown>(
  api: Readonly<API & { url: string; stream?: boolean; debug?: boolean }>,
  json: TRequest
): Promise<TResponse | ReadableStream<TResponse>> => {
  const baseUrl = new URL(process.env.PROXY ?? api.url);
  const apiPath = path.join(baseUrl.pathname, api.name ?? '/');
  const apiUrl = new URL(apiPath, baseUrl);

  const res = await fetch(apiUrl, {
    method: api.put ? 'PUT' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...api.headers
    },
    body: JSON.stringify(json)
  });

  if (res.status >= 400) {
    const body = JSON.stringify(await res.json(), null, 2);
    throw new Error(
      `API Error: ${apiUrl.href}, ${res.status}, ${res.statusText}\n${body}`
    );
  }

  if (!res.body) {
    throw new Error('Response body is null');
  }

  if (!api.stream) {
    return await res.json();
  }

  const st = res.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new JSONStringifyStream<TResponse>());

  return st;
};

// for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
//   console.log('CHUNK', decoder.decode(chunk));
// }

// const res = await axios.post(apiUrl, json, {
//   headers: api.headers,
//   responseType: 'stream'
//   // responseType: api.stream ? 'stream' : 'json'
// });

// const res = await request
//   .send(json as object)
//   .set(headers ?? {})
//   .type('json')
//   .accept('json')
//   .retry(3);
// return res.body;

// } catch (e) {
//   const err = e as SuperAgentError;
//   throw httpError(`apiCall:`, apiUrl, json, err);
// }

/*
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
*/

// export type SuperAgentError = {
//   response: superagent.Response;
//   code: unknown;
//   syscall: unknown;
//   address: unknown;
//   port: unknown;
//   request: unknown;
// };

// export const httpError = (
//   message: string,
//   apiUrl: string,
//   json: unknown,
//   { response, code, syscall, address, port }: Readonly<SuperAgentError>
// ) => {
//   const err = new Error(message) as Error & { data: unknown };

//   if (!response) {
//     err.data = {
//       apiUrl,
//       code,
//       syscall,
//       address,
//       port,
//       request: json
//     };
//     return err;
//   }

//   const { headers, status, body } = response;
//   err.data = {
//     apiUrl,
//     statusCode: status,
//     headers,
//     request: json,
//     response: body,
//     error: body.error
//   };
//   return err;
// };
