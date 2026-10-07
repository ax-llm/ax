import { mergeAbortSignals } from '../../util/abort.js';
import { apiCall } from '../../util/apicall.js';
import type { AxAICredentialProvider, AxAIServiceOptions } from '../types.js';
import type {
  AxAIOpenAIDecisionQuestion,
  AxAIOpenAIDecisionsRequest,
  AxAIOpenAIDecisionsResponse,
} from './types.js';
import { AxAIOpenAIDecisionsModel } from './types.js';
import {
  decodeDecisionsResponse,
  validateDecisionsRequest,
} from './validate.js';

export type AxAIOpenAIDecisionsClientOptions = Pick<
  AxAIServiceOptions,
  | 'fetch'
  | 'timeout'
  | 'retry'
  | 'abortSignal'
  | 'corsProxy'
  | 'verbose'
  | 'includeRequestBodyInErrors'
>;

export type AxAIOpenAIDecisionsClientArgs = {
  apiKey?: string;
  credentialProvider?: AxAICredentialProvider;
  /** Base URL including /v1. Defaults to https://api.openai.com/v1. */
  apiURL?: string;
  model?: string;
  headers?: Readonly<Record<string, string>>;
  options?: Readonly<AxAIOpenAIDecisionsClientOptions>;
};

/** Native OpenAI Decisions API. Questions and application decision policies belong to the caller. */
export class AxAIOpenAIDecisionsClient {
  private readonly args: Readonly<AxAIOpenAIDecisionsClientArgs>;

  constructor(args: Readonly<AxAIOpenAIDecisionsClientArgs>) {
    if (!args.apiKey?.trim() && !args.credentialProvider)
      throw new Error('OpenAI Decisions requires apiKey or credentialProvider');
    this.args = {
      ...args,
      headers: { ...args.headers },
      options: { ...args.options },
    };
  }

  async create<const Q extends readonly AxAIOpenAIDecisionQuestion[]>(
    request: AxAIOpenAIDecisionsRequest<Q>,
    options?: Readonly<AxAIOpenAIDecisionsClientOptions>
  ): Promise<AxAIOpenAIDecisionsResponse<Q>> {
    const payload = {
      ...request,
      model:
        request.model ?? this.args.model ?? AxAIOpenAIDecisionsModel.GPT6Luna,
    };
    validateDecisionsRequest(payload);
    // Callers may reuse/mutate their request while a fetch is pending.
    const snapshot = structuredClone(payload);
    const response = await this.request(
      '/decisions',
      'POST',
      snapshot,
      options
    );
    return decodeDecisionsResponse(response, snapshot.questions);
  }

  private async request(
    path: string,
    method: 'POST',
    body: unknown,
    options?: Readonly<AxAIOpenAIDecisionsClientOptions>
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
        url: this.args.apiURL ?? 'https://api.openai.com/v1',
        method,
        resolveHeaders: async ({ method, url }) => ({
          ...(this.args.apiKey
            ? { Authorization: `Bearer ${this.args.apiKey}` }
            : {}),
          ...this.args.headers,
          ...(await this.args.credentialProvider?.({
            profile: 'openai-decisions',
            operation: 'chat',
            method,
            url,
          })),
        }),
      },
      body
    );
  }
}

/** Create a native OpenAI Decisions client for ordered questions and their complete answers. */
export function openaiDecisions(
  args: Readonly<AxAIOpenAIDecisionsClientArgs>
): AxAIOpenAIDecisionsClient {
  return new AxAIOpenAIDecisionsClient(args);
}
