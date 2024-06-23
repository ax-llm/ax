import type { ReadableStream } from 'stream/web';

import { type AxSpan, axSpanAttributes, AxSpanKind } from '../trace/index.js';
import { type API, apiCall } from '../util/apicall.js';
import { ColorLog } from '../util/log.js';
import { RespTransformStream } from '../util/transform.js';

import type {
  AxAIPromptConfig,
  AxAIService,
  AxAIServiceActionOptions,
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
  AxEmbedRequest,
  AxEmbedResponse,
  AxModelConfig,
  AxModelInfo,
  AxModelInfoWithProvider,
  AxTokenUsage
} from './types.js';

const colorLog = new ColorLog();

export interface AxBaseAIArgs {
  name: string;
  apiURL: string;
  headers: Record<string, string>;
  modelInfo: Readonly<AxModelInfo[]>;
  models: Readonly<{ model: string; embedModel?: string }>;
  options?: Readonly<AxAIServiceOptions>;
  supportFor: { functions: boolean; streaming: boolean };
}

export const axBaseAIDefaultConfig = (): AxModelConfig =>
  structuredClone({
    maxTokens: 500,
    temperature: 0,
    topK: 40,
    frequencyPenalty: 0.2
  });

export const axBaseAIDefaultCreativeConfig = (): AxModelConfig =>
  structuredClone({
    maxTokens: 500,
    temperature: 0.4,
    topP: 0.7,
    frequencyPenalty: 0.2,
    presencePenalty: 0.2
  });

export class AxBaseAI<
  TChatRequest,
  TEmbedRequest,
  TChatResponse,
  TChatResponseDelta,
  TEmbedResponse
> implements AxAIService
{
  generateChatReq?: (
    req: Readonly<AxChatRequest>,
    config: Readonly<AxAIPromptConfig>
  ) => [API, TChatRequest];
  generateEmbedReq?: (req: Readonly<AxEmbedRequest>) => [API, TEmbedRequest];
  generateChatResp?: (resp: Readonly<TChatResponse>) => AxChatResponse;
  generateChatStreamResp?: (
    resp: Readonly<TChatResponseDelta>,
    state: object
  ) => AxChatResponse;
  generateEmbedResp?: (resp: Readonly<TEmbedResponse>) => AxEmbedResponse;

  private debug = false;

  private rt?: AxAIServiceOptions['rateLimiter'];
  private fetch?: AxAIServiceOptions['fetch'];
  private tracer?: AxAIServiceOptions['tracer'];

  private modelUsage?: AxTokenUsage;
  private embedModelUsage?: AxTokenUsage;

  protected apiURL: string;
  protected name: string;
  protected headers: Record<string, string>;
  protected modelInfo: AxModelInfo;
  protected embedModelInfo?: AxModelInfo;
  protected supportFor: AxBaseAIArgs['supportFor'];

  constructor({
    name,
    apiURL,
    headers,
    modelInfo,
    models,
    options = {},
    supportFor
  }: Readonly<AxBaseAIArgs>) {
    this.name = name;
    this.apiURL = apiURL;
    this.headers = headers;
    this.supportFor = supportFor;
    this.tracer = options.tracer;

    if (models.model.length === 0) {
      throw new Error('No model defined');
    }

    const mname = models.model.replace(/-0\d+$|-\d{2,}$/, '');
    this.modelInfo = modelInfo.filter((v) => v.name === mname).at(0) ?? {
      name: models.model,
      currency: 'usd',
      promptTokenCostPer1M: 0,
      completionTokenCostPer1M: 0
    };

    this.embedModelInfo = modelInfo
      .filter((v) => v.name === models.embedModel)
      .at(0);

    this.setOptions(options);
  }

  public setName(name: string): void {
    this.name = name;
  }

  public setAPIURL(apiURL: string): void {
    this.apiURL = apiURL;
  }

  public setHeaders(headers: Record<string, string>): void {
    this.headers = headers;
  }

  setOptions(options: Readonly<AxAIServiceOptions>): void {
    if (options.debug) {
      this.debug = options.debug;
    }

    if (options.rateLimiter) {
      this.rt = options.rateLimiter;
    }

    if (options.fetch) {
      this.fetch = options.fetch;
    }

    if (options.tracer) {
      this.tracer = options.tracer;
    }
  }

  getModelInfo(): Readonly<AxModelInfoWithProvider> {
    return { ...this.modelInfo, provider: this.name };
  }

  getEmbedModelInfo(): AxModelInfoWithProvider | undefined {
    return this.embedModelInfo
      ? { ...this.embedModelInfo, provider: this.name }
      : undefined;
  }

  getName(): string {
    return this.name;
  }

  getFeatures(): AxBaseAIArgs['supportFor'] {
    return this.supportFor;
  }

  getModelConfig(): AxModelConfig {
    throw new Error('getModelConfig not implemented');
  }

  async chat(
    _req: Readonly<AxChatRequest>,
    options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions>
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    if (this.tracer) {
      const mc = this.getModelConfig();
      return await this.tracer?.startActiveSpan(
        'Chat Request',
        {
          kind: AxSpanKind.SERVER,
          attributes: {
            [axSpanAttributes.LLM_SYSTEM]: this.name,
            [axSpanAttributes.LLM_REQUEST_MODEL]: this.modelInfo.name,
            [axSpanAttributes.LLM_REQUEST_MAX_TOKENS]: mc.maxTokens,
            [axSpanAttributes.LLM_REQUEST_TEMPERATURE]: mc.temperature,
            [axSpanAttributes.LLM_REQUEST_TOP_P]: mc.topP,
            [axSpanAttributes.LLM_REQUEST_TOP_K]: mc.topK,
            [axSpanAttributes.LLM_REQUEST_FREQUENCY_PENALTY]:
              mc.frequencyPenalty,
            [axSpanAttributes.LLM_REQUEST_PRESENCE_PENALTY]: mc.presencePenalty,
            [axSpanAttributes.LLM_REQUEST_STOP_SEQUENCES]:
              mc.stopSequences?.join(', '),
            [axSpanAttributes.LLM_REQUEST_LLM_IS_STREAMING]: mc.stream
            // [AxSpanAttributes.LLM_PROMPTS]: _req.chatPrompt
            //   ?.map((v) => v.content)
            //   .join('\n')
          }
        },
        async (span) => {
          const res = await this._chat(_req, options, span);
          span.end();
          return res;
        }
      );
    }
    return await this._chat(_req, options);
  }

  async _chat(
    _req: Readonly<AxChatRequest>,
    options?: Readonly<AxAIPromptConfig & AxAIServiceActionOptions>,
    span?: AxSpan
  ): Promise<AxChatResponse | ReadableStream<AxChatResponse>> {
    if (!this.generateChatReq) {
      throw new Error('generateChatReq not implemented');
    }

    const reqFn = this.generateChatReq;
    const stream = options?.stream ?? _req.modelConfig?.stream;
    const functions =
      _req.functions && _req.functions.length > 0 ? _req.functions : undefined;

    const req = {
      ..._req,
      functions,
      modelConfig: { ..._req.modelConfig, stream }
    } as Readonly<AxChatRequest>;

    const fn = async () => {
      const [apiConfig, reqValue] = reqFn(req, options as AxAIPromptConfig);

      const res = await apiCall(
        {
          name: apiConfig.name,
          url: this.apiURL,
          headers: this.buildHeaders(apiConfig.headers),
          stream,
          debug: this.debug,
          fetch: this.fetch,
          span
        },
        reqValue
      );
      return res;
    };

    if (this.debug) {
      logChatRequest(req);
    }

    const rv = this.rt
      ? await this.rt(fn, { modelUsage: this.modelUsage })
      : await fn();

    if (stream) {
      if (!this.generateChatStreamResp) {
        throw new Error('generateChatResp not implemented');
      }

      const respFn = this.generateChatStreamResp;
      const wrappedRespFn =
        (state: object) => (resp: Readonly<TChatResponseDelta>) => {
          const res = respFn(resp, state);
          res.sessionId = options?.sessionId;

          if (res.modelUsage) {
            this.modelUsage = res.modelUsage;
          }

          if (span?.isRecording()) {
            setResponseAttr(res, span);
          }

          if (this.debug) {
            logStreamingResponse(res);
          }
          return res;
        };

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const doneCb = async (_values: readonly AxChatResponse[]) => {
        if (this.debug) {
          process.stdout.write('\n');
        }
      };

      const st = (rv as ReadableStream<TChatResponseDelta>).pipeThrough(
        new RespTransformStream<TChatResponseDelta, AxChatResponse>(
          wrappedRespFn({}),
          doneCb
        )
      );
      return st;
    }

    if (!this.generateChatResp) {
      throw new Error('generateChatResp not implemented');
    }
    const res = this.generateChatResp(rv as TChatResponse);
    res.sessionId = options?.sessionId;

    if (res.modelUsage) {
      this.modelUsage = res.modelUsage;
    }

    if (span?.isRecording()) {
      setResponseAttr(res, span);
    }

    if (this.debug) {
      logResponse(res);
    }

    span?.end();
    return res;
  }

  async embed(
    req: Readonly<AxEmbedRequest>,
    options?: Readonly<AxAIServiceActionOptions>
  ): Promise<AxEmbedResponse> {
    if (this.tracer) {
      return await this.tracer?.startActiveSpan(
        'Embed Request',
        {
          kind: AxSpanKind.SERVER,
          attributes: {
            [axSpanAttributes.LLM_SYSTEM]: this.name,
            [axSpanAttributes.LLM_REQUEST_MODEL]: this.modelInfo.name
          }
        },
        async (span) => {
          const res = await this._embed(req, options, span);
          span.end();
          return res;
        }
      );
    }
    return this._embed(req, options);
  }

  async _embed(
    req: Readonly<AxEmbedRequest>,
    options?: Readonly<AxAIServiceActionOptions>,
    span?: AxSpan
  ): Promise<AxEmbedResponse> {
    if (!this.generateEmbedReq) {
      throw new Error('generateEmbedReq not implemented');
    }
    if (!this.generateEmbedResp) {
      throw new Error('generateEmbedResp not implemented');
    }

    const fn = async () => {
      const [apiConfig, reqValue] = this.generateEmbedReq!(req);

      const res = await apiCall(
        {
          name: apiConfig.name,
          url: this.apiURL,
          headers: this.buildHeaders(apiConfig.headers),
          debug: this.debug,
          fetch: this.fetch,
          span
        },
        reqValue
      );

      return res;
    };

    const resValue = this.rt
      ? await this.rt(fn, { embedModelUsage: this.embedModelUsage })
      : await fn();
    const res = this.generateEmbedResp!(resValue as TEmbedResponse);

    res.sessionId = options?.sessionId;

    if (span?.isRecording()) {
      if (res.modelUsage) {
        this.embedModelUsage = res.modelUsage;
        span.setAttributes({
          [axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]:
            res.modelUsage.completionTokens ?? 0,
          [axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]:
            res.modelUsage.promptTokens
        });
      }
    }

    span?.end();
    return res;
  }

  private buildHeaders(
    headers: Record<string, string> = {}
  ): Record<string, string> {
    return { ...headers, ...this.headers };
  }
}

const logChatRequest = (req: Readonly<AxChatRequest>) => {
  const items = req.chatPrompt?.map((msg) => {
    switch (msg.role) {
      case 'function':
        return `Function Result: ${colorLog.whiteBright(msg.result)}`;
      case 'user': {
        if (typeof msg.content === 'string') {
          return `User: ${colorLog.whiteBright(msg.content)}`;
        }
        const items = msg.content.map((v) => {
          switch (v.type) {
            case 'text':
              return `(Text) ${colorLog.whiteBright(v.text)}`;
            case 'image':
              return `(Image, ${v.mimeType}) ${colorLog.whiteBright(v.image.substring(0, 10))}`;
            default:
              throw new Error('Invalid content type');
          }
        });
        return `User:\n${items.join('\n')}`;
      }
      case 'assistant': {
        if (msg.functionCalls) {
          const fns = msg.functionCalls?.map(({ function: fn }) => {
            const args =
              typeof fn.arguments !== 'string'
                ? JSON.stringify(fn.arguments, null, 2)
                : fn.arguments;
            return `${fn.name}(${args})`;
          });
          return `Functions:\n${colorLog.whiteBright(fns.join('\n'))}`;
        }
        return `Assistant:\n${colorLog.whiteBright(msg.content ?? '<empty>')}`;
      }
      default:
        throw new Error('Invalid role');
    }
  });

  if (items) {
    console.log('\n==========');
    console.log(items.join('\n'));
  }
};

const logResponse = (resp: Readonly<AxChatResponse>) => {
  for (const r of resp.results) {
    if (r.content) {
      console.log(colorLog.greenBright(r.content));
    }
    if (r.functionCalls) {
      for (const f of r.functionCalls) {
        const args =
          typeof f.function.arguments !== 'string'
            ? JSON.stringify(f.function.arguments, null, 2)
            : f.function.arguments;
        console.log(colorLog.yellow(`${f.function.name}(${args})`));
      }
    }
  }
};

const logStreamingResponse = (resp: Readonly<AxChatResponse>) => {
  if (!resp.results) {
    return;
  }
  for (const r of resp.results) {
    if (r.content) {
      process.stdout.write(colorLog.greenBright(r.content));
    }
    if (r.functionCalls) {
      for (const f of r.functionCalls) {
        if (f.function.name) {
          process.stdout.write(colorLog.blueBright(f.function.name));
        }
        if (f.function.arguments) {
          process.stdout.write(colorLog.yellow(f.function.arguments as string));
        }
      }
    }
  }
};

const setResponseAttr = (res: Readonly<AxChatResponse>, span: AxSpan) => {
  if (res.modelUsage) {
    span.setAttributes({
      [axSpanAttributes.LLM_USAGE_COMPLETION_TOKENS]:
        res.modelUsage.completionTokens ?? 0,
      [axSpanAttributes.LLM_USAGE_PROMPT_TOKENS]: res.modelUsage.promptTokens
    });
  }
};
