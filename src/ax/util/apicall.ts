import path from 'path';
import {
  type ReadableStream,
  TextDecoderStream as TextDecoderStreamNative
} from 'stream/web';

import type { AxSpan } from '../trace/index.js';

import { SSEParser } from './sse.js';
import { TextDecoderStreamPolyfill } from './stream.js';

/**
 * Util: API details
 * @export
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
export type API = {
  name?: string;
  headers?: Record<string, string>;
  put?: boolean;
};

const textDecoderStream = TextDecoderStreamNative ?? TextDecoderStreamPolyfill;

// eslint-disable-next-line @typescript-eslint/naming-convention
export const apiCall = async <TRequest = unknown, TResponse = unknown>(
  api: Readonly<
    API & {
      url: string | URL;
      stream?: boolean;
      debug?: boolean;
      fetch?: typeof fetch;
      span?: AxSpan;
    }
  >,
  json: TRequest
): Promise<TResponse | ReadableStream<TResponse>> => {
  const baseUrl = new URL(process.env['PROXY'] ?? api.url);
  const apiPath = path.join(baseUrl.pathname, api.name ?? '/', baseUrl.search);
  const apiUrl = new URL(apiPath, baseUrl);

  if (api.span?.isRecording()) {
    api.span.setAttributes({
      'http.request.method': api.put ? 'PUT' : 'POST',
      'url.full': apiUrl.href
    });
  }

  let res: Response | ReadableStream<TResponse> | undefined;

  try {
    res = await (api.fetch ?? fetch)(apiUrl, {
      method: api.put ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...api.headers
      },
      body: JSON.stringify(json)
    });

    if (res.status >= 400) {
      const respBody = JSON.stringify(await res.json(), null, 2);
      throw new Error(
        `${res.status}, ${res.statusText}\n:Response Body: ${respBody}`
      );
    }

    if (!api.stream) {
      const resJson = await res.json();
      return resJson as TResponse;
    }

    if (!res.body) {
      throw new Error('Response body is null');
    }

    const st = res.body
      .pipeThrough(new textDecoderStream())
      .pipeThrough(new SSEParser<TResponse>());

    return st;
  } catch (e) {
    if (api.span?.isRecording()) {
      api.span.recordAxSpanException(e as Error);
    }
    const reqBody = JSON.stringify(json, null, 2);
    throw new Error(
      `API Error: ${apiUrl.href}, ${e}\nRequest Body: ${reqBody}`
    );
  }
};
