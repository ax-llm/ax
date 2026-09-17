// cspell:ignore jev systemone
import { mergeAbortSignals } from '../../util/abort.js';
import { apiCall } from '../../util/apicall.js';
import type { AxAICredentialProvider, AxAIServiceOptions } from '../types.js';
import type {
  AxAITypesafeModelCard,
  AxAITypesafeQuestions,
  AxAITypesafeRequest,
  AxAITypesafeResponse,
} from './types.js';
import {
  decodeTypesafeResponse,
  typesafeRecord,
  validateTypesafeRequest,
} from './validate.js';

export type AxAITypesafeClientOptions = Pick<
  AxAIServiceOptions,
  | 'fetch'
  | 'timeout'
  | 'retry'
  | 'abortSignal'
  | 'corsProxy'
  | 'verbose'
  | 'includeRequestBodyInErrors'
>;

export type AxAITypesafeClientArgs = {
  apiKey?: string;
  credentialProvider?: AxAICredentialProvider;
  apiURL?: string;
  model?: string;
  headers?: Readonly<Record<string, string>>;
  options?: Readonly<AxAITypesafeClientOptions>;
};

/** Native Typesafe API. Questions and application decision policies belong to the caller. */
export class AxAITypesafeClient {
  private readonly args: Readonly<AxAITypesafeClientArgs>;

  constructor(args: Readonly<AxAITypesafeClientArgs>) {
    if (!args.apiKey?.trim() && !args.credentialProvider)
      throw new Error('Typesafe requires apiKey or credentialProvider');
    this.args = {
      ...args,
      headers: { ...args.headers },
      options: { ...args.options },
    };
  }

  async systemOne<const Q extends AxAITypesafeQuestions>(
    request: AxAITypesafeRequest<Q>,
    options?: Readonly<AxAITypesafeClientOptions>
  ): Promise<AxAITypesafeResponse<Q>> {
    const payload = {
      ...request,
      model: request.model ?? this.args.model ?? 'jev-latest',
    };
    validateTypesafeRequest(payload);
    // Callers may reuse/mutate their request while a fetch is pending.
    const snapshot = structuredClone(payload);
    const response = await this.request(
      '/v1/systemone',
      'POST',
      snapshot,
      options
    );
    return decodeTypesafeResponse(response, snapshot.questions);
  }

  async listModels(
    options?: Readonly<AxAITypesafeClientOptions>
  ): Promise<readonly AxAITypesafeModelCard[]> {
    const wire = await this.request('/v1/models', 'GET', undefined, options);
    const response = typesafeRecord(wire, 'model catalog').models;
    if (!Array.isArray(response))
      throw new Error('Typesafe: model catalog must be an array');
    for (const raw of response) {
      const model = typesafeRecord(raw, 'model card');
      if (
        typeof model.name !== 'string' ||
        !model.name.trim() ||
        typeof model.description !== 'string' ||
        typeof model.release_date !== 'string'
      )
        throw new Error('Typesafe: invalid model card');
    }
    return response as AxAITypesafeModelCard[];
  }

  private async request(
    path: string,
    method: 'POST' | 'GET',
    body: unknown,
    options?: Readonly<AxAITypesafeClientOptions>
  ): Promise<unknown> {
    const definedOptions = Object.fromEntries(
      Object.entries(options ?? {}).filter(([, value]) => value !== undefined)
    );
    return await apiCall(
      {
        ...this.args.options,
        ...definedOptions,
        abortSignal: mergeAbortSignals(
          this.args.options?.abortSignal,
          options?.abortSignal
        ),
        name: path,
        url: this.args.apiURL ?? 'https://api.typesafe.ai',
        method,
        resolveHeaders: async ({ method, url }) => ({
          ...(this.args.apiKey
            ? { Authorization: `Bearer ${this.args.apiKey}` }
            : {}),
          ...this.args.headers,
          ...(await this.args.credentialProvider?.({
            profile: 'typesafe',
            operation: method === 'GET' ? 'models' : 'chat',
            method,
            url,
          })),
        }),
      },
      body
    );
  }
}

/** Create a native Typesafe client for structured questions and their complete answers. */
export function typesafe(
  args: Readonly<AxAITypesafeClientArgs>
): AxAITypesafeClient {
  return new AxAITypesafeClient(args);
}
