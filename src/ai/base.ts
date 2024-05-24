import type { ReadableStream } from 'stream/web';

import type {
  AIPromptConfig,
  AIService,
  AIServiceActionOptions,
  AIServiceOptions
} from '../text/types.js';
import { SpanAttributes } from '../trace/index.js';
import type {
  AITextChatRequest,
  AITextEmbedRequest,
  TextModelInfoWithProvider
} from '../types/index.js';
import { type API, apiCall } from '../util/apicall.js';
import { ColorLog } from '../util/log.js';
import { RespTransformStream } from '../util/transform.js';

import type {
  EmbedResponse,
  TextModelConfig,
  TextModelInfo,
  TextResponse
} from './types.js';

const colorLog = new ColorLog();

interface BaseAIArgs {
  name: string;
  apiURL: string;
  headers: Record<string, string>;
  modelInfo: Readonly<TextModelInfo[]>;
  models: Readonly<{ model: string; embedModel?: string }>;
  options?: Readonly<AIServiceOptions>;
  supportFor: { functions: boolean };
}

export class BaseAI<
  TChatRequest,
  TEmbedRequest,
  TChatResponse,
  TChatResponseDelta,
  TEmbedResponse
> implements AIService
{
  generateChatReq?: (
    req: Readonly<AITextChatRequest>,
    config: Readonly<AIPromptConfig>
  ) => [API, TChatRequest];
  generateEmbedReq?: (
    req: Readonly<AITextEmbedRequest>
  ) => [API, TEmbedRequest];
  generateChatResp?: (resp: Readonly<TChatResponse>) => TextResponse;
  generateChatStreamResp?: (resp: Readonly<TChatResponseDelta>) => TextResponse;
  generateEmbedResp?: (resp: Readonly<TEmbedResponse>) => EmbedResponse;

  private debug = false;

  private rt?: AIServiceOptions['rateLimiter'];
  private fetch?: AIServiceOptions['fetch'];
  private tracer?: AIServiceOptions['tracer'];

  protected apiURL: string;
  protected name: string;
  protected headers: Record<string, string>;
  protected modelInfo: TextModelInfo;
  protected embedModelInfo?: TextModelInfo;
  protected supportFor: BaseAIArgs['supportFor'];

  constructor({
    name,
    apiURL,
    headers,
    modelInfo,
    models,
    options = {},
    supportFor
  }: Readonly<BaseAIArgs>) {
    this.name = name;
    this.apiURL = apiURL;
    this.headers = headers;
    this.supportFor = supportFor;

    if (models.model.length === 0) {
      throw new Error('No model defined');
    }

    this.modelInfo = modelInfo.filter((v) => v.name === models.model).at(0) ?? {
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

  setOptions(options: Readonly<AIServiceOptions>): void {
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

  getModelInfo(): Readonly<TextModelInfoWithProvider> {
    return { ...this.modelInfo, provider: this.name };
  }

  getEmbedModelInfo(): TextModelInfoWithProvider | undefined {
    return this.embedModelInfo
      ? { ...this.embedModelInfo, provider: this.name }
      : undefined;
  }

  getName(): string {
    return this.name;
  }

  getFeatures(): BaseAIArgs['supportFor'] {
    return this.supportFor;
  }

  getModelConfig(): TextModelConfig {
    throw new Error('getModelConfig not implemented');
  }

  async chat(
    _req: Readonly<AITextChatRequest>,
    options?: Readonly<AIPromptConfig & AIServiceActionOptions>
  ): Promise<TextResponse | ReadableStream<TextResponse>> {
    if (!this.generateChatReq) {
      throw new Error('generateChatReq not implemented');
    }

    const mc = this.getModelConfig();
    const stop = mc.stop && mc.stop.length > 0 ? JSON.stringify(mc.stop) : '';

    const reqFn = this.generateChatReq;
    const stream = options?.stream ?? _req.modelConfig?.stream;
    const functions =
      _req.functions && _req.functions.length > 0 ? _req.functions : undefined;
    const req = {
      ..._req,
      functions,
      modelConfig: { ..._req.modelConfig, stream }
    } as Readonly<AITextChatRequest>;

    const fn = async () => {
      const [apiConfig, reqValue] = reqFn(req, options as AIPromptConfig);

      const res = await apiCall(
        {
          name: apiConfig.name,
          url: this.apiURL,
          headers: this.buildHeaders(apiConfig.headers),
          stream,
          debug: this.debug,
          fetch: this.fetch
        },
        reqValue
      );
      return res;
    };

    if (this.debug) {
      logChatRequest(req);
    }

    const rv = this.rt ? await this.rt(fn) : await fn();

    if (stream) {
      if (!this.generateChatStreamResp) {
        throw new Error('generateChatResp not implemented');
      }

      const respFn = this.generateChatStreamResp;
      const wrappedRespFn = (resp: Readonly<TChatResponseDelta>) => {
        const res = respFn(resp);
        res.sessionId = options?.sessionId;
        return res;
      };

      //   const doneCb = async (values: readonly TextResponse[]) => {
      //     const res = mergeTextResponses(values);
      //   };

      const st = (rv as ReadableStream<TChatResponseDelta>).pipeThrough(
        new RespTransformStream<TChatResponseDelta, TextResponse>(
          wrappedRespFn
          //doneCb
        )
      );
      return st;
    }

    if (!this.generateChatResp) {
      throw new Error('generateChatResp not implemented');
    }
    const res = this.generateChatResp(rv as TChatResponse);
    res.sessionId = options?.sessionId;

    if (this.tracer) {
      let usageAttr;
      if (res.modelUsage) {
        usageAttr = {
          [SpanAttributes.LLM_USAGE_COMPLETION_TOKENS]:
            res.modelUsage.completionTokens ?? 0,
          [SpanAttributes.LLM_USAGE_PROMPT_TOKENS]: res.modelUsage.promptTokens,
          [SpanAttributes.LLM_USAGE_TOTAL_TOKENS]: res.modelUsage?.totalTokens
        };
      }

      this.tracer?.startSpan('chat', {
        attributes: {
          [SpanAttributes.LLM_SYSTEM]: this.name,
          [SpanAttributes.LLM_REQUEST_MODEL]: this.modelInfo.name,
          [SpanAttributes.LLM_REQUEST_MAX_TOKENS]: mc.maxTokens,
          [SpanAttributes.LLM_REQUEST_TEMPERATURE]: mc.temperature,
          [SpanAttributes.LLM_REQUEST_TOP_P]: mc.topP,
          [SpanAttributes.LLM_REQUEST_FREQUENCY_PENALTY]: mc.frequencyPenalty,
          [SpanAttributes.LLM_REQUEST_PRESENCE_PENALTY]: mc.presencePenalty,
          [SpanAttributes.LLM_REQUEST_STOP_SEQUENCES]: stop,
          [SpanAttributes.LLM_REQUEST_USER]: _req.identity?.user,
          ...(usageAttr ?? {})
          // [SpanAttributes.LLM_PROMPTS]: _req.chatPrompt
          //   ?.map((v) => v.content)
          //   .join('\n')
        }
      });
    }

    return res;
  }

  async embed(
    req: Readonly<AITextEmbedRequest>,
    options?: Readonly<AIServiceActionOptions>
  ): Promise<EmbedResponse> {
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
          fetch: this.fetch
        },
        reqValue
      );
      return res;
    };

    const resValue = this.rt ? await this.rt(async () => fn()) : await fn();
    const res = this.generateEmbedResp!(resValue as TEmbedResponse);

    res.sessionId = options?.sessionId;
    return res;
  }

  // async _transcribe(
  //   // eslint-disable-next-line @typescript-eslint/no-unused-vars
  //   _file: string,
  //   // eslint-disable-next-line @typescript-eslint/no-unused-vars
  //   _prompt?: string,
  //   // eslint-disable-next-line @typescript-eslint/no-unused-vars
  //   _options?: Readonly<AITranscribeConfig & AIServiceActionOptions>
  // ): Promise<TranscriptResponse> {
  //   throw new Error('_transcribe not implemented');
  // }

  // async transcribe(
  //   file: string,
  //   prompt?: string,
  //   options?: Readonly<AITranscribeConfig & AIServiceActionOptions>
  // ): Promise<TranscriptResponse> {
  //   const res = this.rt
  //     ? await this.rt<Promise<TranscriptResponse>>(
  //         async () => await this._transcribe(file, prompt, options)
  //       )
  //     : await this._transcribe(file, prompt, options);

  //   res.sessionId = options?.sessionId;
  //   return res;
  // }

  // async apiCallWithUpload<Request, Response, APIType extends API >(
  //   api: APIType,
  //   json: Request,
  //   file: string
  // ): Promise<Response> {
  // return apiCallWithUpload<Request, Response, APIType>(this.mergeAPIConfig<APIType>(api), json, file);
  // }

  private buildHeaders(
    headers: Record<string, string> = {}
  ): Record<string, string> {
    return { ...headers, ...this.headers };
  }
}

const logChatRequest = (req: Readonly<AITextChatRequest>) => {
  const items = req.chatPrompt?.map((v) => v.content).join('\n');
  if (items) {
    console.log(colorLog.whiteBright(items));
  }
};
