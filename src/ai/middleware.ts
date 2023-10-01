import { ExtendedIncomingMessage } from '../proxy/types.js';
import { AIService } from '../text/types.js';
import { AITextTraceStepBuilder } from '../tracing/trace.js';
import { AITextTraceStep } from '../tracing/types.js';

export type Prompt = {
  role?: string;
  text: string;
};

export type PromptUpdaterArgs = {
  prompt?: string;
  user?: string;
};

export type PromptUpdater = ({
  prompt,
  user,
}: Readonly<PromptUpdaterArgs>) => Promise<Prompt[]>;

export class BaseAIMiddleware<AIRequest, AIResponse> {
  protected sb = new AITextTraceStepBuilder();
  protected req?: AIRequest;
  protected resp?: AIResponse;
  protected ai?: AIService;

  protected reqUpdated = false;
  protected exReq: Readonly<ExtendedIncomingMessage>;
  protected apiKey: string;

  constructor(exReq: Readonly<ExtendedIncomingMessage>) {
    this.exReq = exReq;

    this.apiKey =
      exReq.headers.authorization?.substring(7) ??
      (exReq.headers['api-key'] as string);

    if (!this.apiKey || this.apiKey.length === 0) {
      throw new Error('Missing API key for AI provider');
    }
  }

  protected addRequest(request: string) {
    if (!this.req) {
      this.req = JSON.parse(request);
    }
  }

  protected addResponse(response: string) {
    if (!this.resp) {
      this.resp = JSON.parse(response);
    }
  }

  public getTrace(): AITextTraceStep {
    const { error, traceId, sessionId, startTime } = this.exReq;
    return this.sb
      .setApiError(error)
      .setTraceId(traceId)
      .setSessionId(sessionId)
      .setModelResponseTime(Date.now() - startTime)
      .build();
  }

  public isRequestUpdated() {
    return this.reqUpdated;
  }

  public renderRequest() {
    return JSON.stringify(this.req);
  }

  public getAPIKey() {
    return this.apiKey;
  }
}
