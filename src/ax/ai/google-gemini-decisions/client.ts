import { mergeAbortSignals } from '../../util/abort.js';
import { apiCall } from '../../util/apicall.js';
import { mergeHeaders } from '../../util/headers.js';
import type { AxAICredentialProvider, AxAIServiceOptions } from '../types.js';
import type {
  AxAIGoogleGeminiDecisionsQuestions,
  AxAIGoogleGeminiDecisionsRequest,
  AxAIGoogleGeminiDecisionsResponse,
} from './types.js';
import { AxAIGoogleGeminiDecisionsModel } from './types.js';
import {
  decodeDecisionsResponse,
  validateDecisionsRequest,
} from './validate.js';

export type AxAIGoogleGeminiDecisionsClientOptions = Pick<
  AxAIServiceOptions,
  | 'fetch'
  | 'timeout'
  | 'retry'
  | 'abortSignal'
  | 'corsProxy'
  | 'verbose'
  | 'includeRequestBodyInErrors'
>;

export type AxAIGoogleGeminiDecisionsClientArgs = {
  apiKey?: string;
  credentialProvider?: AxAICredentialProvider;
  /** Base URL including /v1beta. Defaults to https://generativelanguage.googleapis.com/v1beta. */
  apiURL?: string;
  model?: string;
  headers?: Readonly<Record<string, string>>;
  options?: Readonly<AxAIGoogleGeminiDecisionsClientOptions>;
};

/** Native Google Gemini Decisions API. Questions and application decision policies belong to the caller. */
export class AxAIGoogleGeminiDecisionsClient {
  private readonly args: Readonly<AxAIGoogleGeminiDecisionsClientArgs>;

  constructor(args: Readonly<AxAIGoogleGeminiDecisionsClientArgs>) {
    if (!args.apiKey?.trim() && !args.credentialProvider)
      throw new Error(
        'Google Gemini Decisions requires apiKey or credentialProvider'
      );
    this.args = {
      ...args,
      headers: { ...args.headers },
      options: { ...args.options },
    };
  }

  async create<const Q extends AxAIGoogleGeminiDecisionsQuestions>(
    request: AxAIGoogleGeminiDecisionsRequest<Q>,
    options?: Readonly<AxAIGoogleGeminiDecisionsClientOptions>
  ): Promise<AxAIGoogleGeminiDecisionsResponse<Q>> {
    const payload = {
      ...request,
      model:
        request.model ??
        this.args.model ??
        AxAIGoogleGeminiDecisionsModel.GeminiDecision1,
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
    options?: Readonly<AxAIGoogleGeminiDecisionsClientOptions>
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
        url:
          this.args.apiURL ??
          'https://generativelanguage.googleapis.com/v1beta',
        method,
        resolveHeaders: async ({ method, url }) =>
          mergeHeaders(
            this.args.apiKey
              ? { 'x-goog-api-key': this.args.apiKey }
              : undefined,
            this.args.headers,
            await this.args.credentialProvider?.({
              profile: 'google-gemini-decisions',
              operation: 'chat',
              method,
              url,
            })
          ),
      },
      body
    );
  }
}

/** Create a native Google Gemini Decisions client for named questions and their complete answers. */
export function googleGeminiDecisions(
  args: Readonly<AxAIGoogleGeminiDecisionsClientArgs>
): AxAIGoogleGeminiDecisionsClient {
  return new AxAIGoogleGeminiDecisionsClient(args);
}
